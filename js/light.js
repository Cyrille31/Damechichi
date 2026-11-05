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
 * Une quinzaine d'images sont analysées par seconde ; les capteurs
 * d'orientation suivent les mouvements du téléphone, la caméra ne fait que
 * corriger lentement (voir Tracker), et l'éclairage affiché glisse en douceur
 * vers le résultat (voir blend).
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
   * view : demi-largeur et demi-hauteur du champ de la caméra, en tangentes ;
   * mean : luminosité moyenne de l'image (pour repérer une lampe qu'on allume).
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
    if (max < 230) return { sources: [], ambient: 0.85, view, mean };
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
    return { sources, ambient, view, mean };
  }

  // Petits outils de géométrie 3D (vecteurs [x, y, z], matrices 3 × 3 en lignes).
  const norm = v => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
  const mul = (M, v) => [0, 1, 2].map(i => M[i][0] * v[0] + M[i][1] * v[1] + M[i][2] * v[2]);
  const mulT = (M, v) => [0, 1, 2].map(i => M[0][i] * v[0] + M[1][i] * v[1] + M[2][i] * v[2]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  /**
   * Orientation du téléphone (angles alpha, beta, gamma de deviceorientation,
   * en degrés) → matrice qui passe du repère du téléphone (x vers la droite de
   * l'écran, y vers le haut de l'écran, z sortant de l'écran) au repère de la pièce.
   */
  function orientationMatrix(alpha, beta, gamma) {
    const r = Math.PI / 180;
    const cA = Math.cos(alpha * r), sA = Math.sin(alpha * r);
    const cB = Math.cos(beta * r), sB = Math.sin(beta * r);
    const cG = Math.cos(gamma * r), sG = Math.sin(gamma * r);
    // R = Rz(alpha) · Rx(beta) · Ry(gamma)
    return [
      [cA * cG - sA * sB * sG, -sA * cB, cA * sG + sA * sB * cG],
      [sA * cG + cA * sB * sG, cA * cB, sA * sG - cA * sB * cG],
      [-cB * sG, sB, cB * cG]
    ];
  }

  /**
   * Suivi des sources dans le repère de la pièce.
   *
   * Les mouvements du téléphone sont donnés par ses capteurs (orientation
   * complète : rotation à plat et inclinaisons) : les ombres les suivent
   * aussitôt, en phase. La caméra ne fait que de lentes corrections quand le
   * téléphone est immobile, car la position d'une tache lumineuse varie d'une
   * image à l'autre avec l'exposition automatique et le bruit.
   *
   * Une lampe nouvelle n'est adoptée qu'après avoir été vue de façon stable ;
   * une lampe n'est oubliée que si elle manque sur toutes les images pendant
   * 0,7 s, téléphone immobile, alors qu'elle devrait être dans le champ. Un changement net de la luminosité générale
   * (lampe allumée ou éteinte) rend tout cela rapide pendant un court moment.
   *
   * Le sens de l'image (miroir ou non) dépend du téléphone : on le déduit en
   * comparant les lampes vues par la caméra à la rotation des capteurs.
   */
  class Tracker {
    constructor(mirror = false) {
      this.mirror = mirror;     // vrai si la droite de l'image est la droite de l'écran
      this.R = null;            // orientation du téléphone (null sans capteurs)
      this.turn = 0;            // rotation de l'affichage (portrait / paysage), en radians
      this.tracks = [];         // sources suivies : direction u dans la pièce (vecteur unitaire)
      this.candidates = [];     // taches vues récemment, pas encore adoptées
      this.ambient = DEFAULT_LIGHTS.ambient;
      this.level = null;        // luminosité moyenne lissée de l'image
      this.levelJump = 0;       // nombre d'images consécutives nettement plus claires ou sombres
      this.fastUntil = 0;       // fin de la période de recalage rapide
      this.lastMotion = -1e9;   // dernier mouvement net du téléphone
      this.history = [];        // pour la calibration du sens de l'image
    }

    /** Nouvelle orientation des capteurs ; renvoie vrai si elle a changé de façon visible. */
    setOrientation(alpha, beta, gamma, turnDeg, now) {
      const R = orientationMatrix(alpha, beta || 0, gamma || 0);
      const turn = (turnDeg || 0) * Math.PI / 180;
      let change = 1;
      if (this.R) {
        // Angle de la rotation entre l'ancienne et la nouvelle orientation.
        let tr = 0;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += this.R[i][j] * R[i][j];
        change = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
      }
      if (change > 0.01) this.lastMotion = now;
      this.R = R;
      this.turn = turn;
      return change > 0.002;
    }

    /** Point de l'écran (tangentes, x à droite, y en bas) → direction dans la pièce. */
    toWorld(sx, sy) {
      const c = Math.cos(this.turn), n = Math.sin(this.turn);
      const x = sx * c - sy * n, y = sx * n + sy * c;   // de l'affichage vers le téléphone
      const d = norm([x, -y, 1]);
      return this.R ? norm(mul(this.R, d)) : d;
    }

    /** Direction dans la pièce → direction de l'ombre à l'écran : {dx, dy, tan, z}. */
    toScreen(u) {
      const d = this.R ? mulT(this.R, u) : u;
      const z = Math.max(d[2], 0.05);
      let x = d[0] / z, y = -d[1] / z;
      const c = Math.cos(-this.turn), n = Math.sin(-this.turn);
      [x, y] = [x * c - y * n, x * n + y * c];       // du téléphone vers l'affichage
      const tan = Math.hypot(x, y);
      return { dx: tan > 1e-6 ? x / tan : -0.6, dy: tan > 1e-6 ? y / tan : -0.8, tan: Math.min(tan, 2), z: d[2] };
    }

    /** Une tache de l'image → point de l'écran, selon le sens supposé de l'image. */
    sourcePoint(s, mirror = this.mirror) {
      return [mirror ? s.x : -s.x, s.y];
    }

    measure(m, now = performance.now()) {
      if (!m) return;
      // Changement net de luminosité (lampe allumée ou éteinte) : recalage rapide.
      if (this.level === null) this.level = m.mean;
      const jump = Math.abs(m.mean - this.level) / Math.max(this.level, 20);
      this.levelJump = jump > 0.3 ? this.levelJump + 1 : 0;
      if (this.levelJump >= 3) {
        this.fastUntil = now + 1000;
        this.level = m.mean;
        this.candidates = [];
      }
      this.level += (m.mean - this.level) * 0.03;

      const fast = now < this.fastUntil || !this.tracks.length;
      const moving = now - this.lastMotion < 400;
      const gain = fast ? 0.4 : moving ? 0 : 0.03;
      this.ambient += (m.ambient - this.ambient) * (fast ? 0.3 : 0.03);
      if (this.R && m.sources.length) this.calibrate(m.sources[0]);

      const seen = new Set();
      for (const s of m.sources) {
        const u = this.toWorld(...this.sourcePoint(s));
        const near = list => {
          let best = null, bd = Math.cos(0.3);
          for (const t of list) { const c = dot(t.u, u); if (c > bd && !seen.has(t)) { bd = c; best = t; } }
          return best;
        };
        const t = near(this.tracks);
        if (t) {
          seen.add(t);
          if (gain) {
            t.u = norm(t.u.map((v, i) => v + (u[i] - v) * gain));
            t.soft += (s.soft - t.soft) * gain;
            t.strength += (s.strength - t.strength) * gain;
          }
          t.missingSince = null;
          continue;
        }
        // Tache nouvelle : candidate, adoptée si elle est revue assez longtemps.
        let c = near(this.candidates);
        if (c) {
          c.u = norm(c.u.map((v, i) => v + (u[i] - v) * 0.3));
          c.soft = s.soft;
          c.strength = s.strength;
          c.count++;
        } else {
          c = { u, soft: s.soft, strength: s.strength, count: 1 };
          this.candidates.push(c);
        }
        seen.add(c);
        if (c.count >= (fast ? 2 : 10)) {
          this.candidates.splice(this.candidates.indexOf(c), 1);
          this.tracks.push({ u: c.u, soft: c.soft, strength: c.strength, missingSince: null });
          seen.add(this.tracks[this.tracks.length - 1]);
        }
      }
      this.candidates = this.candidates.filter(c => seen.has(c) || (c.count -= 2) > 0);

      // Source absente : oubliée seulement après une absence prolongée alors qu'elle devrait être visible.
      for (const t of this.tracks) {
        if (seen.has(t)) continue;
        const p = this.toScreen(t.u);
        const sx = p.dx * p.tan, sy = p.dy * p.tan;
        const inView = p.z > 0.2 && Math.abs(sx) < m.view.hw * 0.85 && Math.abs(sy) < m.view.hh * 0.85;
        // Pendant un mouvement, l'image peut être floue : l'absence ne compte pas.
        if (!inView || moving) { t.missingSince = null; continue; }
        if (t.missingSince === null) t.missingSince = now;
      }
      this.tracks = this.tracks
        .filter(t => t.missingSince === null || now - t.missingSince < (fast ? 300 : 700))
        .sort((a, b) => b.strength - a.strength).slice(0, 4);
    }

    /**
     * Compare deux hypothèses (image en miroir ou non) sur la source la plus
     * forte : avec la bonne, sa direction dans la pièce reste fixe pendant que
     * le téléphone tourne ; avec la mauvaise, elle bouge.
     */
    calibrate(s) {
      this.history.push({ a: this.toWorld(...this.sourcePoint(s, false)), b: this.toWorld(...this.sourcePoint(s, true)), R: this.R });
      if (this.history.length > 90) this.history.shift();
      const R0 = this.history[0].R;
      let tr = 0;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += R0[i][j] * this.R[i][j];
      if (Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) < 1.2) return;
      const spread = key => {
        const m = [0, 0, 0];
        for (const e of this.history) for (let i = 0; i < 3; i++) m[i] += e[key][i];
        return 1 - Math.hypot(...m) / this.history.length;
      };
      const now = spread(this.mirror ? 'b' : 'a'), other = spread(this.mirror ? 'a' : 'b');
      if (now > 0.02 && other < now * 0.4) {
        this.mirror = !this.mirror;
        this.tracks = [];
        this.candidates = [];
      }
      this.history = [];
    }

    /** Éclairage à l'écran pour l'orientation actuelle du téléphone. */
    screenModel() {
      if (!this.tracks.length) return DIFFUSE;
      const lights = [];
      let total = 0;
      for (const t of this.tracks) {
        const p = this.toScreen(t.u);
        // Une lampe passée sous le plan de l'écran n'éclaire plus le plateau.
        const w = t.strength * Math.max(0, Math.min(1, p.z / 0.15));
        if (w <= 0) continue;
        total += w;
        lights.push({ dx: p.dx, dy: p.dy, tan: p.tan, soft: t.soft, weight: w, kind: t.soft > POINT_MAX ? 'étendue' : 'ponctuelle' });
      }
      if (!lights.length) return DIFFUSE;
      lights.forEach(l => { l.weight /= total; });
      return { ambient: this.ambient, lights };
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

  const RoomLight = { analyze, blend, Tracker, orientationMatrix, Camera, DEFAULT_LIGHTS };
  root.CCLight = RoomLight;
  if (typeof module !== 'undefined' && module.exports) module.exports = RoomLight;
})(typeof window !== 'undefined' ? window : globalThis);
