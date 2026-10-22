/*
 * Dames chinoises — rendu du plateau et des pions en bois (canvas 2D).
 * CGExcel — Cyrille Gindre — © 2026
 * Licence MIT + BAL 1.0 — Bonne Action License
 * En échange, une seule chose vous est demandée, sur l'honneur : faire une bonne action chaque jour. Aider un voisin, sourire à un inconnu, ramasser un papier… c'est vous qui voyez.
 * Voir le fichier LICENSE.
 */
(function (root) {
  'use strict';

  const { BOARD, N, SQRT3 } = root.CC;

  // Pions en bois teinté.
  const PIECE_COLORS = [
    { name: 'Rouge',  base: '#b5342b', grain: 'rgba(60,10,5,' },
    { name: 'Bleu',   base: '#2b5fa6', grain: 'rgba(5,20,50,' },
    { name: 'Vert',   base: '#3d8a3f', grain: 'rgba(10,40,10,' },
    { name: 'Jaune',  base: '#e2ad35', grain: 'rgba(110,60,0,' },
    { name: 'Ébène',  base: '#3b2a22', grain: 'rgba(0,0,0,' },
    { name: 'Ivoire', base: '#efe0c2', grain: 'rgba(140,100,50,' }
  ];

  const FRAME_R = 15, SURFACE_R = 14, STAR_R = 13.4;

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = n >> 8 & 255, b = n & 255;
    if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  /**
   * Veinage du bois : des fibres ondulées quasi parallèles, déviées autour
   * de quelques nœuds. Dessiné en vectoriel pour rester net à toute taille.
   */
  function drawGrain(ctx, cx, cy, size, o) {
    const rng = mulberry32(o.seed);
    const D = size * 1.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(o.angle || 0);
    if (o.base) {
      const g = ctx.createLinearGradient(0, -D / 2, 0, D / 2);
      o.base.forEach((c, i) => g.addColorStop(i / (o.base.length - 1), c));
      ctx.fillStyle = g;
      ctx.fillRect(-D / 2, -D / 2, D, D);
    }
    const knots = [];
    for (let k = 0; k < (o.knots || 0); k++) {
      knots.push({ x: (rng() - 0.5) * D * 0.7, y: (rng() - 0.5) * D * 0.7, r: o.spacing * (2 + rng() * 3), s: 0.8 + rng() });
    }
    const warpA = o.spacing * 3, warpF = 2 * Math.PI / (D * (0.6 + rng() * 0.6)), warpP = rng() * 6.3;
    const step = Math.max(2, D / 160);
    ctx.lineCap = 'round';
    for (let y = -D / 2; y < D / 2; y += o.spacing * (0.35 + rng() * 1.3)) {
      const a1 = o.spacing * rng() * 0.6, f1 = (1 + rng() * 3) * 2 * Math.PI / D, p1 = rng() * 6.3;
      const a2 = o.spacing * rng() * 0.25, f2 = (6 + rng() * 10) * 2 * Math.PI / D, p2 = rng() * 6.3;
      ctx.beginPath();
      for (let x = -D / 2; x <= D / 2; x += step) {
        let yy = y + warpA * Math.sin(x * warpF + y * warpF * 0.3 + warpP) + a1 * Math.sin(x * f1 + p1) + a2 * Math.sin(x * f2 + p2);
        for (const k of knots) {
          const dx = x - k.x, dy = y - k.y;
          yy += k.s * k.r * Math.sign(dy || 1) * Math.exp(-(dx * dx) / (k.r * k.r * 3) - (dy * dy) / (k.r * k.r * 4));
        }
        if (x === -D / 2) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      const dark = rng() < 0.18;
      ctx.lineWidth = (dark ? 1.2 + rng() * 1.6 : 0.4 + rng() * 0.9) * o.lineScale;
      ctx.strokeStyle = o.line + (dark ? 0.18 + rng() * 0.2 : 0.05 + rng() * 0.12) + ')';
      ctx.stroke();
    }
    for (const k of knots) {
      for (let j = 4; j >= 1; j--) {
        ctx.beginPath();
        ctx.ellipse(k.x, k.y, k.r * 0.22 * j, k.r * 0.12 * j, 0, 0, Math.PI * 2);
        ctx.strokeStyle = o.line + (0.12 + 0.05 * (4 - j)) + ')';
        ctx.lineWidth = o.lineScale;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(k.x, k.y, k.r * 0.15, k.r * 0.08, 0, 0, Math.PI * 2);
      ctx.fillStyle = o.line + '0.35)';
      ctx.fill();
    }
    ctx.restore();
  }

  function hexPath(ctx, cx, cy, R, round, rot = 0, append = false) {
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 2 + k * Math.PI / 3 + rot;
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    if (!append) ctx.beginPath();
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const start = mid(pts[5], pts[0]);
    ctx.moveTo(start[0], start[1]);
    for (let k = 0; k < 6; k++) {
      const p = pts[k], q = pts[(k + 1) % 6];
      const m = mid(p, q);
      ctx.arcTo(p[0], p[1], m[0], m[1], round);
    }
    ctx.closePath();
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.angle = 0;   // rotation du plateau (radians, sens de canvas.rotate)
      this.tilt = 0;    // inclinaison du plateau (radians), appliquée en CSS 3D
      this.armColors = [null, null, null, null, null, null];
      this.pos = BOARD.cells.map(() => ({ x: 0, y: 0 }));
      this.resize();
    }

    /** Angle qui amène la branche `arm` en bas de l'écran. */
    static armAngle(arm) {
      return -arm * Math.PI / 3;
    }

    setView(arm, armColors) {
      this.armColors = armColors;
      this.buildBoard();
      this.setAngle(Renderer.armAngle(arm));
    }

    setAngle(angle) {
      this.angle = angle;
      const cs = Math.cos(angle), sn = Math.sin(angle);
      BOARD.cells.forEach((c, i) => {
        this.pos[i] = {
          x: this.cx + (c.x * cs - c.y * sn) * this.u,
          y: this.cy + (c.x * sn + c.y * cs) * this.u
        };
      });
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 3);
      this.w = Math.max(1, rect.width);
      this.h = Math.max(1, rect.height);
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
      this.layout();
    }

    layout() {
      this.u = Math.min(this.w / 2 / (FRAME_R * 0.866 + 0.4), this.h / 2 / (FRAME_R + 0.4));
      this.cx = this.w / 2;
      this.cy = this.h / 2;
      this.spacing = SQRT3 * this.u;
      this.holeR = 0.3 * this.spacing;
      this.pieceR = 0.43 * this.spacing;
      this.buildBoard();
      this.buildHole();
      this.buildSprites();
      this.setAngle(this.angle);
    }

    /** Calque carré dessiné dans le repère du plateau (centre au milieu), qui tourne avec lui. */
    makeLayer() {
      const L = (FRAME_R + 1.5) * 2 * this.u;
      const c = document.createElement('canvas');
      c.width = c.height = Math.ceil(L * this.dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.translate(L / 2, L / 2);
      return [c, ctx, L];
    }

    /** Le bois, l'étoile et les teintes : tout ce qui tourne avec le plateau. */
    buildBoard() {
      const u = this.u, size = FRAME_R * 2 * u;

      const [shadow, sctx, L] = this.makeLayer();
      sctx.filter = `blur(${u * 0.8}px)`;
      hexPath(sctx, 0, 0, FRAME_R * u, u * 1.4);
      sctx.fillStyle = 'rgba(0,0,0,0.6)';
      sctx.fill();
      this.shadowLayer = shadow;
      this.layerSize = L;

      const [layer, ctx] = this.makeLayer();
      // Cadre en noyer.
      ctx.save();
      hexPath(ctx, 0, 0, FRAME_R * u, u * 1.4);
      ctx.clip();
      drawGrain(ctx, 0, 0, size, {
        seed: 7, angle: Math.PI / 2, spacing: u * 0.32, lineScale: Math.max(0.6, u / 22),
        base: ['#8d5a32', '#6d4122', '#875430'], line: 'rgba(35,15,5,', knots: 2
      });
      ctx.restore();

      // Rainure entre cadre et plateau.
      hexPath(ctx, 0, 0, SURFACE_R * u + u * 0.18, u * 1.1);
      ctx.fillStyle = 'rgba(25,10,3,0.75)';
      ctx.fill();

      // Plateau en hêtre clair.
      ctx.save();
      hexPath(ctx, 0, 0, SURFACE_R * u, u * 1.0);
      ctx.clip();
      drawGrain(ctx, 0, 0, size, {
        seed: 31, angle: 0.08, spacing: u * 0.26, lineScale: Math.max(0.6, u / 22),
        base: ['#e6b882', '#d39d63', '#e0ae74', '#cf955a'], line: 'rgba(120,65,25,', knots: 3
      });
      ctx.restore();

      // Étoile gravée et branches teintées aux couleurs des joueurs.
      const starPts = [];
      for (let k = 0; k < 12; k++) {
        const a = Math.PI / 2 + k * Math.PI / 6;
        const r = (k % 2 === 0 ? STAR_R : STAR_R / SQRT3) * u;
        starPts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      for (let arm = 0; arm < 6; arm++) {
        const col = this.armColors[arm];
        if (col === null || col === undefined) continue;
        const t = BOARD.cells[BOARD.arms[arm].tip];
        const k = Math.round(((Math.atan2(t.y, t.x) - Math.PI / 2) / (Math.PI / 6) + 24)) % 12;
        ctx.beginPath();
        ctx.moveTo(...starPts[(k + 11) % 12]);
        ctx.lineTo(...starPts[k]);
        ctx.lineTo(...starPts[(k + 1) % 12]);
        ctx.closePath();
        ctx.fillStyle = PIECE_COLORS[col].base;
        ctx.globalAlpha = 0.22;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      starPts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.strokeStyle = 'rgba(70,35,10,0.55)';
      ctx.lineWidth = Math.max(1, u * 0.08);
      ctx.stroke();
      // Rosace centrale gravée.
      for (const rr of [2.2, 2.45]) {
        ctx.beginPath();
        ctx.arc(0, 0, rr * u * SQRT3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(80,40,12,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      this.boardLayer = layer;
    }

    /** Un trou, éclairé d'en haut à gauche quelle que soit la rotation du plateau. */
    buildHole() {
      const hr = this.holeR, m = hr * 1.4;
      const c = document.createElement('canvas');
      c.width = c.height = Math.ceil(m * 2 * this.dpr);
      const ctx = c.getContext('2d');
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.beginPath();
      ctx.arc(m + hr * 0.12, m + hr * 0.12, hr * 1.12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,235,200,0.35)';
      ctx.fill();
      const g = ctx.createRadialGradient(m - hr * 0.3, m - hr * 0.3, hr * 0.1, m, m, hr);
      g.addColorStop(0, '#120802');
      g.addColorStop(0.65, '#2a1507');
      g.addColorStop(1, '#5a3315');
      ctx.beginPath();
      ctx.arc(m, m, hr, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(m, m, hr, Math.PI * 0.95, Math.PI * 1.75);
      ctx.strokeStyle = 'rgba(30,12,2,0.6)';
      ctx.lineWidth = Math.max(1, hr * 0.15);
      ctx.stroke();
      this.holeSprite = c;
      this.holeSize = m * 2;
    }

    /** Plateau à l'angle courant ; la lumière, elle, reste fixe (venant d'en haut à gauche). */
    drawBoard(ctx) {
      const { cx, cy, u, angle, layerSize: L } = this;
      const size = FRAME_R * 2 * u;
      ctx.save();
      ctx.translate(cx, cy + u * 0.6);
      ctx.rotate(angle);
      ctx.drawImage(this.shadowLayer, -L / 2, -L / 2, L, L);
      ctx.restore();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.drawImage(this.boardLayer, -L / 2, -L / 2, L, L);
      ctx.restore();

      ctx.save();
      hexPath(ctx, cx, cy, FRAME_R * u, u * 1.4, angle);
      ctx.clip();
      const bevel = ctx.createLinearGradient(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);
      bevel.addColorStop(0, 'rgba(255,230,190,0.28)');
      bevel.addColorStop(0.5, 'rgba(255,255,255,0)');
      bevel.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = bevel;
      hexPath(ctx, cx, cy, FRAME_R * u, u * 1.4, angle);
      hexPath(ctx, cx, cy, SURFACE_R * u + u * 0.18, u * 1.1, angle, true);
      ctx.fill('evenodd');
      hexPath(ctx, cx, cy, SURFACE_R * u, u * 1.0, angle);
      const light = ctx.createRadialGradient(cx - size * 0.2, cy - size * 0.25, size * 0.05, cx, cy, size * 0.65);
      light.addColorStop(0, 'rgba(255,245,220,0.22)');
      light.addColorStop(1, 'rgba(60,25,5,0.28)');
      ctx.fillStyle = light;
      ctx.fill();
      ctx.restore();
      hexPath(ctx, cx, cy, FRAME_R * u - 0.5, u * 1.4, angle);
      ctx.strokeStyle = 'rgba(255,220,170,0.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      hexPath(ctx, cx, cy, SURFACE_R * u, u * 1.0, angle);
      ctx.strokeStyle = 'rgba(255,235,200,0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const hs = this.holeSize;
      for (let i = 0; i < N; i++) {
        ctx.drawImage(this.holeSprite, this.pos[i].x - hs / 2, this.pos[i].y - hs / 2, hs, hs);
      }
    }

    buildSprites() {
      const r = this.pieceR, pad = Math.ceil(r * 0.15) + 2;
      const S = Math.ceil((r * 2 + pad * 2) * this.dpr);
      this.spriteSize = S / this.dpr;
      this.sprites = PIECE_COLORS.map((pc, ci) => {
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const ctx = c.getContext('2d');
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const m = S / this.dpr / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(m, m, r, 0, Math.PI * 2);
        ctx.clip();
        const g = ctx.createRadialGradient(m - r * 0.35, m - r * 0.4, r * 0.1, m, m, r * 1.05);
        g.addColorStop(0, shade(pc.base, 0.35));
        g.addColorStop(0.55, pc.base);
        g.addColorStop(1, shade(pc.base, -0.5));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, m * 2, m * 2);
        drawGrain(ctx, m, m, r * 2.2, {
          seed: 100 + ci * 17, angle: 0.6 + ci, spacing: r * 0.16, lineScale: Math.max(0.5, r / 16),
          base: null, line: pc.grain, knots: 0
        });
        const hl = ctx.createRadialGradient(m - r * 0.38, m - r * 0.45, 0, m - r * 0.3, m - r * 0.35, r * 0.75);
        hl.addColorStop(0, 'rgba(255,255,255,0.55)');
        hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = hl;
        ctx.fillRect(0, 0, m * 2, m * 2);
        const sh = ctx.createRadialGradient(m - r * 0.2, m - r * 0.25, r * 0.6, m, m, r * 1.05);
        sh.addColorStop(0, 'rgba(0,0,0,0)');
        sh.addColorStop(1, 'rgba(0,0,0,0.38)');
        ctx.fillStyle = sh;
        ctx.fillRect(0, 0, m * 2, m * 2);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(m, m, r - 0.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        return c;
      });
    }

    hitTest(px, py) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < N; i++) {
        const dx = this.pos[i].x - px, dy = this.pos[i].y - py, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return bd <= (this.spacing * 0.55) ** 2 ? best : -1;
    }

    drawShadow(ctx, x, y, lift) {
      const r = this.pieceR;
      const off = r * 0.12 + lift * 0.35;
      const g = ctx.createRadialGradient(x + off, y + off * 1.3, r * 0.2, x + off, y + off * 1.3, r * (1.1 + lift / r * 0.3));
      g.addColorStop(0, `rgba(0,0,0,${0.5 - Math.min(0.3, lift / r * 0.15)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x + off, y + off * 1.3, r * (1.15 + lift / r * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }

    /**
     * Pion posé sur le plateau. Quand le plateau est incliné, on l'étire
     * verticalement et on le remonte un peu pour qu'il reste bien rond à l'écran.
     */
    drawPiece(ctx, color, x, y, scale = 1) {
      const s = this.spriteSize * scale;
      const stretch = 1 / Math.cos(this.tilt);
      const up = this.pieceR * scale * Math.tan(this.tilt) * 0.8;
      ctx.drawImage(this.sprites[color], x - s / 2, y - up - s * stretch / 2, s, s * stretch);
    }

    drawPath(ctx, path, color, alpha, dash) {
      if (!path || path.length < 2) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = PIECE_COLORS[color].base;
      ctx.lineWidth = Math.max(2, this.u * 0.22);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (dash) ctx.setLineDash([this.u * 0.4, this.u * 0.45]);
      ctx.beginPath();
      path.forEach((c, i) => {
        const p = this.pos[c];
        if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = PIECE_COLORS[color].base;
      for (const c of path.slice(1)) {
        ctx.beginPath();
        ctx.arc(this.pos[c].x, this.pos[c].y, this.u * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /**
     * @param {object} v vue : occ, colors (couleur par joueur), hidden (Set de cases),
     *   movers [{color, x, y, lift}], selected, targets, hoverPath, lastMove, time
     */
    draw(v) {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawBoard(ctx);

      if (v.lastMove) this.drawPath(ctx, v.lastMove.path, v.colors[v.lastMove.pi], 0.35, false);
      if (v.hoverPath) this.drawPath(ctx, v.hoverPath, v.colors[v.hoverPi], 0.7, true);

      const pulse = 0.65 + 0.35 * Math.sin((v.time || 0) / 220);
      if (v.targets) {
        for (const c of v.targets) {
          const p = this.pos[c];
          ctx.beginPath();
          ctx.arc(p.x, p.y, this.holeR * 1.15, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,214,110,${0.55 + 0.4 * pulse})`;
          ctx.lineWidth = Math.max(1.5, this.u * 0.16);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, this.holeR * 0.45, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,214,110,${0.35 + 0.3 * pulse})`;
          ctx.fill();
        }
      }

      const pieces = [];
      for (let i = 0; i < N; i++) {
        if (v.occ[i] >= 0 && !(v.hidden && v.hidden.has(i))) pieces.push(i);
      }
      // Plateau incliné : on dessine du fond vers l'avant pour que les pions se recouvrent bien.
      pieces.sort((a, b) => this.pos[a].y - this.pos[b].y);
      for (const i of pieces) this.drawShadow(ctx, this.pos[i].x, this.pos[i].y, 0);
      for (const i of pieces) this.drawPiece(ctx, v.colors[v.occ[i]], this.pos[i].x, this.pos[i].y);

      if (v.selected >= 0 && v.selected !== undefined && !(v.hidden && v.hidden.has(v.selected))) {
        const p = this.pos[v.selected];
        const up = this.pieceR * Math.tan(this.tilt) * 0.8;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - up, this.pieceR * 1.12, this.pieceR * 1.12 / Math.cos(this.tilt), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,220,120,${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = Math.max(2, this.u * 0.2);
        ctx.stroke();
      }

      if (v.movers) {
        for (const m of v.movers) this.drawShadow(ctx, m.x, m.y, m.lift);
        for (const m of v.movers) this.drawPiece(ctx, m.color, m.x, m.y - m.lift, 1 + m.lift / (this.spacing * 4));
      }
    }
  }

  root.CCRender = { Renderer, PIECE_COLORS };
})(window);
