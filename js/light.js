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
 * Une quinzaine d'images sont analysées par seconde, et l'éclairage affiché
 * glisse en douceur vers la dernière mesure (voir blend).
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

  /**
   * Analyse une image ({data, width, height} au format RGBA).
   * Renvoie { lights: [{dx, dy, tan, soft, weight, kind}], ambient } ou null
   * si l'image est trop sombre pour conclure.
   * (dx, dy) : direction de la lumière à l'écran (vers la source) ;
   * tan : tangente de l'angle avec la verticale (longueur de l'ombre) ;
   * soft : rayon apparent de la source (radians), qui règle le flou.
   */
  function analyze(img) {
    const { data, width: W, height: H } = img;
    const L = new Float32Array(W * H);
    let sum = 0, sum2 = 0, max = 0;
    for (let i = 0; i < W * H; i++) {
      const l = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
      L[i] = l;
      sum += l;
      sum2 += l * l;
      if (l > max) max = l;
    }
    const mean = sum / (W * H), std = Math.sqrt(Math.max(0, sum2 / (W * H) - mean * mean));
    if (max < 60) return null;
    const T = Math.max(0.85 * max, mean + 2 * std, 120);

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
      blobs.push({ n, e, cx: sx / e, cy: sy / e });
    }
    // Aucune tache ne ressort : lumière diffuse (ciel couvert, plafond éclairé…).
    if (!blobs.length) {
      return { lights: [{ dx: -0.6, dy: -0.8, tan: 0.1, soft: 0.6, weight: 1, kind: 'diffuse' }], ambient: 0.85 };
    }
    blobs.sort((a, b) => b.e - a.e);
    // Une ampoule sature la caméra : sa vraie force est sous-estimée par rapport à
    // une fenêtre. On compare donc les sources par la racine de leur énergie.
    const strength = b => Math.sqrt(b.e);
    const kept = blobs.filter(b => b.n >= 2 && strength(b) >= strength(blobs[0]) * 0.08).slice(0, 3);
    if (!kept.length) kept.push(blobs[0]);

    const scale = Math.tan(HALF_FOV) / (W / 2);   // tangente d'angle par pixel
    let total = 0;
    const lights = kept.map(b => {
      // Image de la caméra frontale : la droite de l'image est la gauche de l'écran.
      const tx = -(b.cx + 0.5 - W / 2) * scale, ty = (b.cy + 0.5 - H / 2) * scale;
      const tan = Math.hypot(tx, ty);
      const radius = Math.atan(Math.sqrt(b.n / Math.PI) * scale);
      total += strength(b);
      return {
        dx: tan > 1e-6 ? tx / tan : 0,
        dy: tan > 1e-6 ? ty / tan : -1,
        tan: Math.min(tan, 2),
        soft: radius,
        weight: strength(b),
        kind: radius > POINT_MAX ? 'étendue' : 'ponctuelle'
      };
    });
    lights.forEach(l => { l.weight /= total; });

    // Part de lumière diffuse : plus les sources ressortent peu du fond, plus l'éclairage est diffus.
    const contrast = Math.min(1, (max - mean) / 160);
    return { lights, ambient: Math.max(0.15, Math.min(0.85, 1 - contrast)) };
  }

  /** Décrit les sources pour l'utilisateur (« 1 ponctuelle en haut à gauche… »). */
  function describe(model) {
    if (!model) return 'trop sombre pour repérer une lumière';
    if (model.lights.length === 1 && model.lights[0].kind === 'diffuse') return 'lumière diffuse, sans source marquée';
    const where = l => {
      if (l.tan < 0.15) return 'juste au-dessus';
      const v = l.dy < -0.38 ? 'en haut' : l.dy > 0.38 ? 'en bas' : '';
      const h = l.dx < -0.38 ? 'à gauche' : l.dx > 0.38 ? 'à droite' : '';
      return [v, h].filter(Boolean).join(' ') || 'au centre';
    };
    const parts = model.lights.map(l => `${l.kind} ${where(l)}`);
    return `${parts.length} source${parts.length > 1 ? 's' : ''} : ${parts.join(', ')}`;
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
    async start(onModel) {
      if (this.stream) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Caméra indisponible : ouvrez le jeu depuis une adresse https://.');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }, audio: false
      });
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
    },
    stop() {
      clearTimeout(this.timer);
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  };

  const RoomLight = { analyze, describe, blend, Camera, DEFAULT_LIGHTS };
  root.CCLight = RoomLight;
  if (typeof module !== 'undefined' && module.exports) module.exports = RoomLight;
})(typeof window !== 'undefined' ? window : globalThis);
