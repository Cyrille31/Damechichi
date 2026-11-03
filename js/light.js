/*
 * Dames chinoises — lumière de la pièce vue par la caméra.
 * CGExcel — Cyrille Gindre — © 2026
 * Licence MIT + BAL 1.0 — Bonne Action License
 * En échange, une seule chose vous est demandée, sur l'honneur : faire une bonne action chaque jour. Aider un voisin, sourire à un inconnu, ramasser un papier… c'est vous qui voyez.
 * Voir le fichier LICENSE.
 *
 * La caméra frontale regarde vers le plafond quand on tient le téléphone
 * au-dessus du plateau. On repère les taches les plus lumineuses de l'image :
 * leur position donne la direction de chaque lampe ou fenêtre, leur taille
 * dit si la source est ponctuelle (ombre nette) ou étendue (ombre floue).
 * Une quinzaine d'images sont analysées par seconde ; le gyroscope suit la
 * rotation du téléphone entre deux images (voir Tracker), et l'éclairage
 * affiché glisse en douceur vers le résultat (voir blend).
 * Les images sont analysées sur l'appareil, en petit, et ne sont ni gardées
 * ni envoyées nulle part.
 */
(function (root) {
  'use strict';

  const HALF_FOV = 35 * Math.PI / 180;   // demi-champ horizontal typique d'une caméra frontale
  const POINT_MAX = 4 * Math.PI / 180;   // au-delà de ce rayon apparent, la source est « étendue »

  /** Lumière par défaut (sans caméra) : une lampe un peu étendue, en haut à gauche. */
  const DEFAULT_LIGHTS = {
    lights: [{ dx: -0.6, dy: -0.8, tan: 0.33, soft: 0.12, weight: 1, kind: 'étendue' }],
    ambient: 0.35
  };

  /** Aucune source visible ni mémorisée : lumière diffuse venant d'en haut. */
  const DIFFUSE = {
    lights: [{ dx: -0.6, dy: -0.8, tan: 0.1, soft: 0.6, weight: 1, kind: 'diffuse' }],
    ambient: 0.85
  };

  /**
   * Analyse une image de la caméra ({data, width, height} au format RGBA).
   * Renvoie { sources, ambient, view } ou null si l'image est trop sombre.
   * Chaque source : position dans l'image en tangentes d'angle (x vers la
   * droite de l'image, y vers le bas), tan (écart à la verticale), soft
   * (rayon apparent en radians) et strength (force relative).
   * view : demi-largeur et demi-hauteur du champ de la caméra, en tangentes.
   * Seules les taches presque saturées comptent : une lampe ou une fenêtre
   * éblouit la caméra, un mur clair non.
   */
  function analyze(img) {
    const { data, width: W, height: H } = img;
    const L = new Float32Array(W * H);
    let sum = 0, max = 0;
    for (let i = 0; i < W * H; i++) {
      const l = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
      L[i] = l;
      sum += l;
      if (l > max) max = l;
    }
    if (max < 60) return null;
    const mean = sum / (W * H);
    const scale = Math.tan(HALF_FOV) / (W / 2);   // tangente d'angle par pixel
    const view = { hw: Math.tan(HALF_FOV), hh: Math.tan(HALF_FOV) * H / W };
    // Part de lumière diffuse : plus les sources ressortent peu du fond, plus l'éclairage est diffus.
    const ambient = Math.max(0.15, Math.min(0.85, 1 - Math.min(1, (max - mean) / 160)));
    if (max < 230) return { sources: [], ambient: 0.85, view };
    const T = Math.max(0.85 * max, 215);

    // Taches lumineuses : composantes connexes des pixels au-dessus du seuil.
    const seen = new Uint8Array(W * H);
    const blobs = [];
    for (let start = 0; start < W * H; start++) {
      if (seen[start] || L[start] < T) continue;
      const stack = [start];
      seen[start] = 1;
      let n = 0, e = 0, sx = 0, sy = 0;
      while (stack.length) {
        const i = stack.pop(), x = i % W, y = (i / W) | 0;
        n++;
        e += L[i];
        sx += x * L[i];
        sy += y * L[i];
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
          if (j >= 0 && !seen[j] && L[j] >= T) { seen[j] = 1; stack.push(j); }
        }
      }
      if (n >= 2) blobs.push({ n, e, cx: sx / e, cy: sy / e });
    }
    // Une ampoule sature la caméra : sa vraie force est sous-estimée par rapport à
    // une fenêtre. On compare donc les sources par la racine de leur énergie.
    blobs.sort((a, b) => b.e - a.e);
    const kept = blobs.filter(b => Math.sqrt(b.e) >= Math.sqrt(blobs[0].e) * 0.08).slice(0, 3);
    const sources = kept.map(b => {
      const x = (b.cx + 0.5 - W / 2) * scale, y = (b.cy + 0.5 - H / 2) * scale;
      return { x, y, tan: Math.min(Math.hypot(x, y), 2), soft: Math.atan(Math.sqrt(b.n / Math.PI) * scale), strength: Math.sqrt(b.e) };
    });
    return { sources, ambient, view };
  }

  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  /**
   * Suivi des sources dans le repère de la pièce. La caméra voit peu de
   * choses à la fois (son champ est étroit et rectangulaire) ; le gyroscope
   * donne l'orientation du téléphone à plat (heading, en radians). Chaque
   * source repérée est donc rangée par sa direction dans la pièce : quand le
   * téléphone tourne, l'ombre tourne avec lui, même si la lampe sort du champ
   * de la caméra. Elle n'est oubliée que si elle devrait être visible et ne
   * l'est plus (lampe éteinte, main devant).
   *
   * Le sens de l'image (miroir ou non) dépend du téléphone : on le déduit
   * en comparant le mouvement des lampes dans l'image à la rotation donnée
   * par le gyroscope.
   */
  class Tracker {
    constructor(mirror = false) {
      this.mirror = mirror;     // vrai si la droite de l'image est la droite de l'écran
      this.heading = null;      // orientation du téléphone (radians), null sans gyroscope
      this.tracks = [];         // sources : vecteur (vx, vy) dans la pièce, longueur = tan
      this.ambient = DEFAULT_LIGHTS.ambient;
      this.history = [];        // pour la calibration du sens de l'image
    }

    /** Direction à l'écran (angle) d'un point de l'image. */
    screenAngle(s, mirror = this.mirror) {
      return Math.atan2(s.y, mirror ? s.x : -s.x);
    }

    measure(m) {
      if (!m) return;
      const h = this.heading || 0;
      this.ambient += (m.ambient - this.ambient) * 0.3;
      if (this.heading !== null && m.sources.length) this.calibrate(m.sources[0], h);

      const used = new Set();
      for (const s of m.sources) {
        const az = this.screenAngle(s) - h;
        const vx = s.tan * Math.cos(az), vy = s.tan * Math.sin(az);
        let best = -1, bd = 0.45;
        this.tracks.forEach((t, i) => {
          const d = Math.hypot(t.vx - vx, t.vy - vy);
          if (!used.has(i) && d < bd) { bd = d; best = i; }
        });
        if (best < 0) {
          this.tracks.push({ vx, vy, soft: s.soft, strength: s.strength, missing: 0 });
          used.add(this.tracks.length - 1);
        } else {
          const t = this.tracks[best];
          t.vx += (vx - t.vx) * 0.35;
          t.vy += (vy - t.vy) * 0.35;
          t.soft += (s.soft - t.soft) * 0.35;
          t.strength += (s.strength - t.strength) * 0.35;
          t.missing = 0;
          used.add(best);
        }
      }
      // Source non revue : oubliée seulement si elle devrait être dans le champ.
      this.tracks.forEach((t, i) => {
        if (used.has(i)) return;
        const az = Math.atan2(t.vy, t.vx) + h, tan = Math.hypot(t.vx, t.vy);
        const sx = tan * Math.cos(az), sy = tan * Math.sin(az);
        const inView = Math.abs(sx) < m.view.hw * 0.85 && Math.abs(sy) < m.view.hh * 0.85;
        if (inView) t.missing++;
      });
      this.tracks = this.tracks.filter(t => t.missing < 4)
        .sort((a, b) => b.strength - a.strength).slice(0, 4);
    }

    /**
     * Compare deux hypothèses (image en miroir ou non) sur la source la plus
     * forte : avec la bonne, sa direction dans la pièce reste fixe pendant que
     * le téléphone tourne ; avec la mauvaise, elle tourne deux fois plus vite.
     */
    calibrate(s, h) {
      this.history.push({ a: this.screenAngle(s, false), h });
      if (this.history.length > 60) this.history.shift();
      const h0 = this.history[0].h;
      const span = Math.max(...this.history.map(e => Math.abs(wrap(e.h - h0))));
      if (span < 1.2) return;
      const spread = mirror => {
        let cx = 0, cy = 0;
        for (const e of this.history) {
          const w = (mirror ? Math.PI - e.a : e.a) - e.h;
          cx += Math.cos(w);
          cy += Math.sin(w);
        }
        return 1 - Math.hypot(cx, cy) / this.history.length;
      };
      const now = spread(this.mirror), other = spread(!this.mirror);
      if (now > 0.15 && other < now * 0.4) {
        this.mirror = !this.mirror;
        this.tracks = [];
      }
      this.history = [];
    }

    /** Éclairage à l'écran pour l'orientation actuelle du téléphone. */
    screenModel() {
      if (!this.tracks.length) return DIFFUSE;
      const h = this.heading || 0;
      const total = this.tracks.reduce((a, t) => a + t.strength, 0);
      return {
        ambient: this.ambient,
        lights: this.tracks.map(t => {
          const tan = Math.hypot(t.vx, t.vy), az = Math.atan2(t.vy, t.vx) + h;
          return {
            dx: Math.cos(az), dy: Math.sin(az), tan, soft: t.soft, weight: t.strength / total,
            kind: t.soft > POINT_MAX ? 'étendue' : 'ponctuelle'
          };
        })
      };
    }
  }

  /**
   * Rapproche l'éclairage affiché `cur` de la mesure `tgt` d'une fraction `a`
   * (0 à 1). Chaque source mesurée est appariée à la source affichée la plus
   * proche ; une nouvelle source apparaît en fondu, une source disparue
   * s'estompe. On interpole le vecteur d'ombre (direction × longueur), ce qui
   * reste doux même quand la lumière passe au-dessus du plateau.
   * Renvoie { model, moving } ; moving est faux une fois l'écart négligeable.
   */
  function blend(cur, tgt, a) {
    const lerp = (x, y) => x + (y - x) * a;
    if (!cur) cur = { lights: [], ambient: tgt.ambient };
    const used = new Set(), lights = [];
    let moving = Math.abs(cur.ambient - tgt.ambient) > 0.003;
    for (const t of tgt.lights) {
      let best = -1, bd = Infinity;
      cur.lights.forEach((c, i) => {
        if (used.has(i)) return;
        const d = Math.hypot(c.dx * c.tan - t.dx * t.tan, c.dy * c.tan - t.dy * t.tan) + Math.abs(c.soft - t.soft);
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0 || bd > 0.8) {
        lights.push(Object.assign({}, t, { weight: t.weight * a }));
        moving = true;
        continue;
      }
      used.add(best);
      const c = cur.lights[best];
      const vx = lerp(c.dx * c.tan, t.dx * t.tan), vy = lerp(c.dy * c.tan, t.dy * t.tan), tan = Math.hypot(vx, vy);
      const l = Object.assign({}, t, {
        dx: tan > 1e-4 ? vx / tan : c.dx,
        dy: tan > 1e-4 ? vy / tan : c.dy,
        tan,
        soft: lerp(c.soft, t.soft),
        weight: lerp(c.weight, t.weight)
      });
      if (bd > 0.002 || Math.abs(c.weight - t.weight) > 0.003) moving = true;
      lights.push(l);
    }
    cur.lights.forEach((c, i) => {
      if (used.has(i)) return;
      const weight = c.weight * (1 - a);
      if (weight > 0.01) { lights.push(Object.assign({}, c, { weight })); moving = true; }
    });
    return { model: { lights, ambient: lerp(cur.ambient, tgt.ambient) }, moving };
  }

  /** Caméra : une quinzaine de petites images analysées par seconde, tant que le mode est actif. */
  const Camera = {
    stream: null,
    timer: 0,
    run: 0,       // numéro du démarrage en cours : un arrêt pendant le démarrage l'annule
    async start(onModel) {
      if (this.stream) return true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Caméra indisponible : ouvrez le jeu depuis une adresse https://.');
      }
      const run = ++this.run;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }, audio: false
      });
      if (run !== this.run) {
        stream.getTracks().forEach(t => t.stop());
        return false;
      }
      this.stream = stream;
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = this.stream;
      await video.play();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (!this.stream) return;
        if (!document.hidden && video.videoWidth) {
          canvas.width = 128;
          canvas.height = Math.max(1, Math.round(128 * video.videoHeight / video.videoWidth));
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          onModel(analyze(ctx.getImageData(0, 0, canvas.width, canvas.height)));
        }
        this.timer = setTimeout(tick, 66);
      };
      tick();
      return true;
    },
    stop() {
      this.run++;
      clearTimeout(this.timer);
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  };

  const RoomLight = { analyze, blend, Tracker, Camera, DEFAULT_LIGHTS };
  root.CCLight = RoomLight;
  if (typeof module !== 'undefined' && module.exports) module.exports = RoomLight;
})(typeof window !== 'undefined' ? window : globalThis);
