/*
 * Dames chinoises — interface et déroulement de la partie.
 * CGExcel — Cyrille Gindre — © 2026
 * Licence MIT + BAL 1.0 — Bonne Action License
 * En échange, une seule chose vous est demandée, sur l'honneur : faire une bonne action chaque jour. Aider un voisin, sourire à un inconnu, ramasser un papier… c'est vous qui voyez.
 * Voir le fichier LICENSE.
 */
(function () {
  'use strict';

  const { Game, BOARD } = window.CC;
  const AI = window.CCAI;
  const { Renderer, PIECE_COLORS } = window.CCRender;
  const RoomLight = window.CCLight;

  const $ = id => document.getElementById(id);
  const LEVEL_NAMES = { easy: 'facile', medium: 'moyen', hard: 'difficile' };

  // ---------- Stockage local (facultatif) ----------
  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* stockage indisponible */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* stockage indisponible */ }
    }
  };

  // ---------- Son : petit « toc » de bois ----------
  const Sound = {
    ctx: null,
    on: store.get('cc-sound') !== false,
    unlock() {
      if (!this.on) return;
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { this.ctx = null; }
    },
    toc(strength = 1) {
      if (!this.on || !this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620 + Math.random() * 80, t);
      osc.frequency.exponentialRampToValueAtTime(240, t + 0.07);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3 * strength, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.12);
      const len = Math.floor(ctx.sampleRate * 0.03);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
      const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g2 = ctx.createGain();
      src.buffer = buf;
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 1.2;
      g2.gain.value = 0.35 * strength;
      src.connect(bp).connect(g2).connect(ctx.destination);
      src.start(t);
    }
  };

  // ---------- État ----------
  const canvas = $('board');
  const renderer = new Renderer(canvas, $('balls'));
  let config = store.get('cc-settings') || defaultConfig(2);
  let game = null;
  let colors = [];
  let selected = -1, targets = null, targetMoves = null;
  let drag = null, hoverCell = -1;
  let job = null;          // animation en cours
  let displayOcc = null;   // occupation affichée pendant une animation
  let displayIds = null;   // numéros des billes affichés pendant une animation
  let watch = null;        // « revoir la partie » en cours
  // Orientation de chaque bille : elle pivote un peu à chaque déplacement.
  const spins = new Float64Array(60).map(() => Math.random() * Math.PI * 2);
  const animSpeed = () => config.speed * (watch ? watch.speed : 1);
  let aiTimer = null;
  let lastMove = null;
  let raf = 0;
  let spin = null;         // rotation douce du plateau vers le joueur humain
  let tilt = +store.get('cc-tilt') || 0;  // inclinaison en degrés
  const pointers = new Map();
  let gesture = null;      // geste à deux doigts en cours

  function defaultConfig(n) {
    const players = [];
    for (let i = 0; i < n; i++) {
      players.push(i === 0
        ? { name: 'Joueur 1', type: 'human', level: 'medium' }
        : { name: 'Ordinateur ' + i, type: 'ai', level: 'medium' });
    }
    return { players, speed: 1, showMoves: 'always', showTurns: true, longJumps: true, autoRotate: true, cameraLight: false };
  }

  /** Cases d'arrivée affichées : 'always', 'drag' (seulement en faisant glisser) ou 'never'. */
  const movesMode = (cfg = config) => (cfg.showMoves === true || cfg.showMoves === undefined ? 'always'
    : cfg.showMoves === false ? 'drag' : cfg.showMoves);

  const isHumanTurn = () => game && !watch && !game.over && !job && !spin && game.players[game.current].type === 'human';
  const playerLabel = pi => `${game.players[pi].name} (${PIECE_COLORS[colors[pi]].name})`;

  // ---------- Démarrage ----------
  function start(cfg, replay) {
    clearTimeout(aiTimer);
    if (watch) {
      clearTimeout(watch.timer);
      watch = null;
      $('replayBar').hidden = true;
    }
    job = null;
    displayOcc = null;
    displayIds = null;
    config = cfg;
    store.set('cc-settings', cfg);
    game = new Game({ players: cfg.players, longJumps: cfg.longJumps !== false });
    colors = game.players.map((p, i) => i);
    lastMove = null;
    clearSelection();
    if (replay) {
      replay.moves.forEach((m, i) => {
        if (i === replay.soloAt) game.finishSolo();
        if (m.pass) game.pass();
        else game.play(m);
      });
      if (replay.soloAt === replay.moves.length) game.finishSolo();
      const last = game.history[game.history.length - 1];
      if (last && !last.pass) lastMove = last;
    }
    let viewer = game.players.findIndex(p => p.type === 'human');
    if (cfg.autoRotate !== false && !game.over && game.players[game.current].type === 'human') viewer = game.current;
    const armColors = [null, null, null, null, null, null];
    game.players.forEach((p, i) => { armColors[p.arm] = colors[i]; });
    spin = null;
    applyCamera();
    renderer.setView(viewer >= 0 ? game.players[viewer].arm : 0, armColors);
    save();
    requestDraw();
    if (game.over) showEnd(); else nextTurn();
  }

  function save() {
    if (!game || watch) return;
    store.set('cc-game', {
      config,
      moves: game.history.map(h => (h.pass ? { pass: true } : { from: h.from, to: h.to, path: h.path })),
      soloAt: game.soloStart >= 0 ? game.soloStart : null
    });
  }

  function resume() {
    const saved = store.get('cc-game');
    if (!saved || !saved.config) return false;
    try {
      start(saved.config, { moves: saved.moves || [], soloAt: saved.soloAt });
      return true;
    } catch (e) {
      store.remove('cc-game');
      return false;
    }
  }

  // ---------- Tours ----------
  function nextTurn() {
    if (watch) return;
    updateHud();
    if (game.over) { showEnd(); return; }
    const pi = game.current, p = game.players[pi];
    if (p.type === 'human' && config.autoRotate !== false) rotateTo(p.arm);
    if (!game.legalMoves(pi).length) {
      toast(`${playerLabel(pi)} ne peut pas bouger et passe son tour.`);
      aiTimer = setTimeout(() => { game.pass(); save(); nextTurn(); }, 900);
      return;
    }
    if (p.type === 'ai') {
      aiTimer = setTimeout(() => {
        if (!$('setup').hidden) { nextTurn(); return; }
        const m = AI.chooseMove(game, pi, p.level);
        if (m) doMove(m); else { game.pass(); nextTurn(); }
      }, 380 / animSpeed());
    }
  }

  /** Joue un coup et l'anime ; `after(res)` est appelé à la fin de l'animation. */
  function playAnimated(move, after) {
    const pi = game.current;
    clearSelection();
    const res = game.play(move);
    lastMove = game.history[game.history.length - 1];
    displayOcc = game.occ.slice();
    displayIds = game.ids.slice();
    if (res.swaps) {
      for (const s of res.swaps) {
        displayOcc[s.a] = s.owner;
        displayOcc[s.b] = pi;
        [displayIds[s.a], displayIds[s.b]] = [displayIds[s.b], displayIds[s.a]];
      }
    }
    animateMove(move, pi, () => {
      if (res.swaps) {
        if (!watch) toast('Anti-blocage : échange des pions coincés.');
        animateSwaps(res.swaps, pi, () => after(res));
      } else {
        after(res);
      }
    });
  }

  function doMove(move) {
    playAnimated(move, afterMove);
    save();
  }

  function afterMove(res) {
    displayOcc = null;
    displayIds = null;
    if (res.finished !== null && !res.over) {
      const rank = game.players[res.finished].finished;
      toast(`🏆 ${playerLabel(res.finished)} termine ${rank === 1 ? '1er' : rank + 'e'} !`);
    }
    requestDraw();
    nextTurn();
  }

  function undo() {
    if (!game || watch || job || !game.history.length) return;
    if (!game.history.some(h => game.players[h.pi].type === 'human')) return;
    clearTimeout(aiTimer);
    $('endgame').hidden = true;
    while (game.history.length) {
      const h = game.undo();
      if (game.players[h.pi].type === 'human' && !h.pass) break;
    }
    const last = game.history[game.history.length - 1];
    lastMove = last && !last.pass ? last : null;
    clearSelection();
    save();
    requestDraw();
    nextTurn();
  }

  // ---------- Lumière de la pièce (caméra) ----------
  let lightShown = RoomLight.DEFAULT_LIGHTS;   // éclairage affiché
  let lightTarget = null;                       // éclairage vers lequel on glisse
  let lightClock = 0;
  let cameraOn = false;
  const tracker = new RoomLight.Tracker(store.get('cc-mirror') === true);

  /** Nouvelle image de la caméra : on met à jour les sources suivies. */
  function onLightMeasure(m) {
    tracker.measure(m);
    if (tracker.mirror !== (store.get('cc-mirror') === true)) store.set('cc-mirror', tracker.mirror);
    requestDraw();
  }

  /** Mouvements du téléphone (rotation, inclinaisons) : les ombres les suivent aussitôt, comme dans la pièce. */
  function onOrientation(e) {
    if (e.alpha === null || e.alpha === undefined) return;
    const screenTurn = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    if (tracker.setOrientation(e.alpha, e.beta, e.gamma, screenTurn, performance.now())) requestDraw();
  }

  /** À chaque image affichée, l'éclairage se rapproche de la cible (constante de temps ≈ 40 ms). */
  function lightFrame(now) {
    if (cameraOn) lightTarget = tracker.screenModel();
    if (!lightTarget) return;
    const dt = lightClock ? Math.min(100, now - lightClock) : 16;
    lightClock = now;
    const { model, moving } = RoomLight.blend(lightShown, lightTarget, 1 - Math.exp(-dt / 40));
    lightShown = model;
    renderer.setLights(model);
    if (!moving) {
      lightShown = lightTarget;
      renderer.setLights(lightTarget);
      lightTarget = null;
      lightClock = 0;
    }
  }

  function applyCamera() {
    if (config.cameraLight) {
      // iPhone : le gyroscope demande une autorisation, pendant le geste de l'utilisateur.
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().catch(() => {});
      }
      window.addEventListener('deviceorientation', onOrientation);
      RoomLight.Camera.start(onLightMeasure).then(started => { if (started && config.cameraLight) cameraOn = true; }).catch(err => {
        RoomLight.Camera.stop();
        config.cameraLight = false;
        store.set('cc-settings', config);
        $('cameraLight').checked = false;
        toast(err && err.name === 'NotAllowedError'
          ? 'Caméra refusée : les ombres gardent la lumière par défaut.'
          : (err && err.message) || 'Caméra indisponible.');
      });
    } else {
      RoomLight.Camera.stop();
      window.removeEventListener('deviceorientation', onOrientation);
      cameraOn = false;
      tracker.tracks = [];
      tracker.candidates = [];
      if (lightShown !== RoomLight.DEFAULT_LIGHTS) lightTarget = RoomLight.DEFAULT_LIGHTS;
    }
  }

  // ---------- Revoir la partie en accéléré ----------
  function startWatch() {
    if (!game || watch || job || spin || !game.history.length) return;
    clearTimeout(aiTimer);
    $('endgame').hidden = true;
    $('setup').hidden = true;
    watch = {
      real: game,
      realLast: lastMove,
      moves: game.history.map(h => (h.pass ? { pass: true } : { from: h.from, to: h.to, path: h.path })),
      soloAt: game.soloStart,
      i: 0,
      speed: 4,
      timer: 0
    };
    game = new Game({ players: config.players, longJumps: config.longJumps !== false });
    lastMove = null;
    clearSelection();
    $('replayBar').hidden = false;
    $('btnReplaySpeed').textContent = '×' + watch.speed;
    updateWatchBar();
    updateHud();
    requestDraw();
    watch.timer = setTimeout(watchStep, 600);
  }

  function updateWatchBar() {
    $('replayInfo').textContent = `Film : coup ${watch.i} / ${watch.moves.length}`;
  }

  function watchStep() {
    if (!watch) return;
    if (watch.i === watch.soloAt) game.finishSolo();
    if (watch.i >= watch.moves.length) {
      watch.timer = setTimeout(stopWatch, 1500);
      return;
    }
    const m = watch.moves[watch.i++];
    updateWatchBar();
    if (m.pass) {
      game.pass();
      watch.timer = setTimeout(watchStep, 150 / animSpeed());
      return;
    }
    playAnimated(m, () => {
      displayOcc = null;
      displayIds = null;
      if (watch) watch.timer = setTimeout(watchStep, 120 / animSpeed());
    });
  }

  function stopWatch() {
    if (!watch) return;
    clearTimeout(watch.timer);
    const w = watch;
    watch = null;
    job = null;
    displayOcc = null;
    displayIds = null;
    game = w.real;
    lastMove = w.realLast;
    $('replayBar').hidden = true;
    clearSelection();
    requestDraw();
    if (game.over) showEnd(); else nextTurn();
  }

  // ---------- Animation ----------
  /** Fait pivoter doucement le plateau pour amener la branche `arm` en bas. */
  function rotateTo(arm) {
    const from = renderer.angle;
    let delta = Renderer.armAngle(arm) - from;
    delta = ((delta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    if (Math.abs(delta) < 1e-3) return;
    spin = { from, delta, t0: performance.now(), dur: (700 + 300 * Math.abs(delta) / (Math.PI / 3)) / Math.sqrt(config.speed) };
    clearSelection();
    requestDraw();
  }

  function spinFrame(now) {
    const t = Math.min(1, (now - spin.t0) / spin.dur);
    renderer.setAngle(spin.from + spin.delta * ease(t));
    if (t >= 1) {
      spin = null;
      updateHud();
    }
  }

  function applyTilt() {
    tilt = Math.max(0, Math.min(50, tilt));
    renderer.setTilt(tilt * Math.PI / 180);
    const { P, k } = renderer;
    canvas.style.transform = tilt ? `perspective(${P}px) scale(${k}) rotateX(${tilt}deg)` : '';
    store.set('cc-tilt', Math.round(tilt));
    requestDraw();
  }
  function animateMove(move, pi, onDone) {
    const sp = renderer.spacing;
    const segs = [];
    let t = 0;
    for (let k = 1; k < move.path.length; k++) {
      const a = move.path[k - 1], b = move.path[k];
      const len = window.CC.dist(a, b);
      const jump = len > 1 || move.jump;
      const dur = (jump ? 200 + 55 * len : 230) / animSpeed();
      segs.push({ a, b, start: t, dur, height: jump ? Math.min(sp * 2.2, sp * (0.45 + 0.22 * len)) : sp * 0.12 });
      t += dur + 40 / animSpeed();
    }
    runJob([mover(game.ids[move.to], segs)], [move.to], t, onDone, pi);
  }

  /** Bille en mouvement : elle pivote un peu à chaque saut et retombe un peu tournée. */
  function mover(id, segs) {
    let turn = 0;
    for (let k = 0; k < segs.length; k++) turn += (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.6);
    return { id, segs, a0: spins[id], a1: spins[id] + turn };
  }

  function animateSwaps(swaps, pi, onDone) {
    const dur = 750 / animSpeed(), sp = renderer.spacing;
    const movers = [], hidden = [];
    for (const s of swaps) {
      movers.push(mover(game.ids[s.a], [{ a: s.b, b: s.a, start: 0, dur, height: sp * 2 }]));
      movers.push(mover(game.ids[s.b], [{ a: s.a, b: s.b, start: 0, dur, height: sp * 2.6 }]));
      hidden.push(s.a, s.b);
    }
    displayOcc = null;
    displayIds = null;
    runJob(movers, hidden, dur, onDone, pi);
  }

  function runJob(movers, hidden, total, onDone, pi) {
    job = { movers, hidden: new Set(hidden), t0: performance.now(), total, onDone, landed: new Set(), pi };
    updateHud();
    requestDraw();
  }

  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function jobFrame(now) {
    const t = now - job.t0;
    const out = [];
    job.movers.forEach((m, mi) => {
      let seg = m.segs[m.segs.length - 1], local = 1;
      for (const s of m.segs) {
        if (t < s.start + s.dur) { seg = s; local = Math.max(0, (t - s.start) / s.dur); break; }
      }
      m.segs.forEach((s, si) => {
        const key = mi + ':' + si;
        if (t >= s.start + s.dur && !job.landed.has(key)) {
          job.landed.add(key);
          Sound.toc(si === m.segs.length - 1 ? 1 : 0.7);
        }
      });
      const A = renderer.pos[seg.a], B = renderer.pos[seg.b], e = ease(local);
      const spin = m.a0 + (m.a1 - m.a0) * ease(Math.min(1, t / job.total));
      out.push({ id: m.id, spin, x: A.x + (B.x - A.x) * e, y: A.y + (B.y - A.y) * e, lift: seg.height * Math.sin(Math.PI * local) });
    });
    if (t >= job.total) {
      for (const m of job.movers) spins[m.id] = m.a1;
      const done = job.onDone;
      job = null;
      done();
      return null;
    }
    return out;
  }

  // ---------- Dessin ----------
  function requestDraw() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (!game) return;
    if (spin) spinFrame(now);
    lightFrame(now);
    let movers = job ? jobFrame(now) : null;
    const hidden = job ? new Set(job.hidden) : new Set();
    if (drag && drag.moved) {
      hidden.add(drag.cell);
      const id = game.ids[drag.cell];
      movers = [{ id, spin: spins[id], x: drag.x, y: drag.y, lift: renderer.spacing * 0.25 }];
    }
    const mode = movesMode();
    let hoverPath = null;
    if (mode === 'always' && targetMoves && hoverCell >= 0) {
      const m = targetMoves.find(mv => mv.to === hoverCell);
      if (m && m.path.length > 2) hoverPath = m.path;
    }
    renderer.draw({
      occ: job && displayOcc ? displayOcc : game.occ,
      ids: job && displayIds ? displayIds : game.ids,
      spins,
      colors,
      hidden,
      movers,
      selected,
      targets: mode === 'always' || (mode === 'drag' && drag) ? targets : null,
      hoverPath,
      hoverPi: game.current,
      lastMove: job ? null : lastMove,
      time: now
    });
    if (job || spin || selected >= 0 || lightTarget) requestDraw();
  }

  // ---------- Saisie ----------
  function clearSelection() {
    selected = -1;
    targets = null;
    targetMoves = null;
    drag = null;
  }

  function select(cell) {
    selected = cell;
    targetMoves = game.movesFor(cell);
    targets = targetMoves.map(m => m.to);
  }

  /** Point du plateau sous le doigt, en tenant compte de l'inclinaison (CSS 3D). */
  /** Point de l'écran (dans la zone de jeu) sous le doigt. */
  function screenPoint(e) {
    const r = $('stage').getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Point du plateau sous le doigt, en tenant compte de l'inclinaison (CSS 3D). */
  function localPoint(e) {
    const sp = screenPoint(e);
    return renderer.unproject(sp.x, sp.y);
  }

  const midY = () => {
    let sum = 0;
    for (const p of pointers.values()) sum += p.y;
    return sum / pointers.size;
  };

  canvas.addEventListener('pointerdown', e => {
    Sound.unlock();
    pointers.set(e.pointerId, { y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
    if (pointers.size >= 2) {
      // Deux doigts : on incline le plateau au lieu de jouer.
      gesture = { tilt0: tilt, y0: midY() };
      drag = null;
      requestDraw();
      return;
    }
    if (game && game.over && !watch && !gesture && $('endgame').hidden) { showEnd(); return; }
    if (gesture || !isHumanTurn()) return;
    const p = localPoint(e), sp = screenPoint(e);
    const ball = renderer.ballAt(sp.x, sp.y, game.occ), c = renderer.hitTest(p.x, p.y);
    if (ball >= 0 && game.occ[ball] === game.current) {
      const again = ball === selected;
      select(ball);
      drag = { cell: ball, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, again };
    } else if (c >= 0 && game.occ[c] === game.current) {
      const again = c === selected;
      select(c);
      drag = { cell: c, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, again };
      canvas.setPointerCapture(e.pointerId);
    } else if (selected >= 0 && c >= 0 && targets.includes(c)) {
      doMove(targetMoves.find(m => m.to === c));
    } else if (selected >= 0 && c >= 0 && game.occ[c] < 0) {
      toast('Ce pion ne peut pas aller là.');
    } else {
      clearSelection();
    }
    requestDraw();
  });

  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.get(e.pointerId).y = e.clientY;
    if (gesture) {
      if (pointers.size >= 2) {
        tilt = gesture.tilt0 - (midY() - gesture.y0) * 0.25;
        applyTilt();
      }
      return;
    }
    const p = localPoint(e);
    const c = renderer.hitTest(p.x, p.y);
    if (c !== hoverCell) { hoverCell = c; requestDraw(); }
    if (!drag) return;
    drag.x = p.x;
    drag.y = p.y;
    if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 8) drag.moved = true;
    requestDraw();
  });

  function endDrag(e, cancelled) {
    if (!drag) return;
    const d = drag;
    drag = null;
    const p = localPoint(e), c = renderer.hitTest(p.x, p.y);
    if (!cancelled && d.moved && c >= 0 && targets && targets.includes(c)) {
      doMove(targetMoves.find(m => m.to === c));
    } else if (!cancelled && d.moved && c >= 0 && c !== d.cell && game.occ[c] < 0) {
      toast('Ce pion ne peut pas aller là.');
    } else if (!d.moved && d.again) {
      clearSelection();
    }
    requestDraw();
  }
  function releasePointer(e, cancelled) {
    pointers.delete(e.pointerId);
    if (gesture) {
      if (!pointers.size) gesture = null;
      return;
    }
    endDrag(e, cancelled);
  }
  canvas.addEventListener('pointerup', e => releasePointer(e, false));
  canvas.addEventListener('pointercancel', e => releasePointer(e, true));
  // Sur PC : la molette incline le plateau.
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    tilt -= e.deltaY * 0.04;
    applyTilt();
  }, { passive: false });
  canvas.addEventListener('pointerleave', () => { if (!drag && hoverCell >= 0) { hoverCell = -1; requestDraw(); } });

  // ---------- Affichage ----------
  function updateHud() {
    if (!game) return;
    const dot = $('turn').querySelector('.dot');
    if (game.over) {
      dot.style.background = PIECE_COLORS[colors[game.ranking[0]]].base;
      $('turnName').textContent = `${game.players[game.ranking[0]].name} a gagné`;
    } else if (job) {
      dot.style.background = PIECE_COLORS[colors[job.pi]].base;
      $('turnName').textContent = `${game.players[job.pi].name} joue…`;
    } else {
      const p = game.players[game.current];
      dot.style.background = PIECE_COLORS[colors[game.current]].base;
      const turn = config.showTurns !== false ? ` · tour ${game.turnsOf(game.current) + 1}` : '';
      const solo = game.solo >= 0 ? ' (seul)' : '';
      $('turnName').textContent = (p.type === 'ai'
        ? `${p.name} réfléchit…`
        : `À ${p.name} de jouer`) + solo + turn;
    }
    $('btnUndo').disabled = !game.history.some(h => game.players[h.pi].type === 'human');
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function showEnd() {
    updateHud();
    const list = $('ranking');
    list.innerHTML = '';
    game.ranking.forEach(pi => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = PIECE_COLORS[colors[pi]].base;
      li.append(dot, document.createTextNode(playerLabel(pi)));
      const notes = [];
      if (config.showTurns !== false) notes.push(`${game.turnsOf(pi)} tours`);
      if (pi === game.solo) notes.push('fini seul');
      else if (!game.hasWon(pi)) notes.push('pas fini');
      if (notes.length) {
        const span = document.createElement('span');
        span.className = 'turns';
        span.textContent = ' — ' + notes.join(', ');
        li.append(span);
      }
      list.append(li);
    });
    $('endTitle').textContent = `${game.players[game.ranking[0]].name} gagne !`;
    const solo = game.canFinishSolo();
    $('btnSolo').hidden = !solo;
    $('soloHint').hidden = !solo;
    if (solo) {
      const last = game.ranking[game.ranking.length - 1];
      $('btnSolo').textContent = game.players[last].type === 'human'
        ? `Finir seul (${game.players[last].name})`
        : `Laisser ${game.players[last].name} finir`;
      $('soloHint').textContent = `${game.players[last].name} peut finir de ranger ses pions tout seul.`;
    }
    $('endgame').hidden = false;
  }

  // ---------- Écran de configuration ----------
  let draft = null;

  function openSetup() {
    draft = JSON.parse(JSON.stringify(config));
    $('btnWatchSetup').hidden = !game || !game.history.length || !!watch;
    renderSetup();
    $('setup').hidden = false;
  }

  function renderSetup() {
    document.querySelectorAll('#countBtns button').forEach(b => {
      b.classList.toggle('on', +b.dataset.n === draft.players.length);
    });
    const seats = $('seats');
    seats.innerHTML = '';
    draft.players.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'seat';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = PIECE_COLORS[i].base;
      dot.title = PIECE_COLORS[i].name;
      const name = document.createElement('input');
      name.type = 'text';
      name.value = p.name;
      name.maxLength = 20;
      name.setAttribute('aria-label', 'Nom du joueur ' + (i + 1));
      name.addEventListener('input', () => { p.name = name.value; });
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Type du joueur ' + (i + 1));
      [['human', 'Humain'], ['ai:easy', 'Ordi facile'], ['ai:medium', 'Ordi moyen'], ['ai:hard', 'Ordi difficile']]
        .forEach(([v, label]) => sel.add(new Option(label, v)));
      sel.value = p.type === 'human' ? 'human' : 'ai:' + p.level;
      sel.addEventListener('change', () => {
        const wasAuto = /^(Joueur|Ordinateur) \d+$/.test(p.name);
        if (sel.value === 'human') p.type = 'human';
        else { p.type = 'ai'; p.level = sel.value.slice(3); }
        if (wasAuto) {
          p.name = (p.type === 'human' ? 'Joueur ' : 'Ordinateur ') + (i + 1);
          name.value = p.name;
        }
      });
      row.append(dot, name, sel);
      seats.append(row);
    });
    $('speed').value = String(draft.speed);
    $('showMoves').value = movesMode(draft);
    $('showTurns').checked = draft.showTurns !== false;
    $('longJumps').checked = draft.longJumps !== false;
    $('autoRotate').checked = draft.autoRotate !== false;
    $('cameraLight').checked = !!draft.cameraLight;
  }

  document.querySelectorAll('#countBtns button').forEach(b => b.addEventListener('click', () => {
    const n = +b.dataset.n;
    const fresh = defaultConfig(n).players;
    draft.players = fresh.map((p, i) => draft.players[i] || p);
    renderSetup();
  }));

  /**
   * Réglages d'affichage : ils s'appliquent tout de suite, sans recommencer la
   * partie (les joueurs et le mode Bonne-Maman, eux, attendent « Commencer »).
   */
  function liveSetting(id, read, apply) {
    $(id).addEventListener('change', () => {
      const v = read($(id));
      draft[id] = v;
      config[id] = v;
      store.set('cc-settings', config);
      if (apply) apply();
      updateHud();
      requestDraw();
    });
  }
  liveSetting('speed', el => parseFloat(el.value) || 1);
  liveSetting('showMoves', el => el.value);
  liveSetting('showTurns', el => el.checked);
  liveSetting('autoRotate', el => el.checked, () => {
    if (config.autoRotate && isHumanTurn()) rotateTo(game.players[game.current].arm);
  });
  liveSetting('cameraLight', el => el.checked, applyCamera);

  $('btnStart').addEventListener('click', () => {
    Sound.unlock();
    draft.speed = parseFloat($('speed').value) || 1;
    draft.showMoves = $('showMoves').value;
    draft.showTurns = $('showTurns').checked;
    draft.longJumps = $('longJumps').checked;
    draft.autoRotate = $('autoRotate').checked;
    draft.cameraLight = $('cameraLight').checked;
    draft.players.forEach((p, i) => {
      p.name = (p.name || '').trim() || (p.type === 'human' ? 'Joueur ' : 'Ordinateur ') + (i + 1);
    });
    $('setup').hidden = true;
    $('endgame').hidden = true;
    start(draft);
  });

  $('btnCancelSetup').addEventListener('click', () => {
    $('setup').hidden = true;
    if (!game) start(config);
  });

  $('btnMenu').addEventListener('click', openSetup);
  $('btnUndo').addEventListener('click', undo);
  $('btnRules').addEventListener('click', () => { $('rules').hidden = false; });
  $('btnReplay').addEventListener('click', () => { $('endgame').hidden = true; start(config); });
  $('btnWatch').addEventListener('click', startWatch);
  $('btnWatchSetup').addEventListener('click', startWatch);
  $('btnReplayStop').addEventListener('click', stopWatch);
  $('btnReplaySpeed').addEventListener('click', () => {
    if (!watch) return;
    watch.speed = watch.speed >= 16 ? 2 : watch.speed * 2;
    $('btnReplaySpeed').textContent = '×' + watch.speed;
  });
  $('btnSolo').addEventListener('click', () => {
    if (!game.finishSolo()) return;
    $('endgame').hidden = true;
    save();
    clearSelection();
    requestDraw();
    nextTurn();
  });

  // ---------- Installation sur l'appareil (PWA) ----------
  let installEvent = null;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('btnInstall').hidden = standalone;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvent = e;
    $('btnInstall').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    $('btnInstall').hidden = true;
    toast('Le jeu est installé !');
  });
  $('btnInstall').addEventListener('click', () => {
    if (installEvent) {
      installEvent.prompt();
      installEvent.userChoice.finally(() => { installEvent = null; });
      return;
    }
    $('installIos').hidden = !isIOS;
    $('installOther').hidden = isIOS;
    $('install').hidden = false;
  });
  $('btnSound').addEventListener('click', () => {
    Sound.on = !Sound.on;
    store.set('cc-sound', Sound.on);
    $('btnSound').textContent = Sound.on ? '🔊' : '🔇';
    if (Sound.on) { Sound.unlock(); Sound.toc(); }
  });
  $('btnSound').textContent = Sound.on ? '🔊' : '🔇';
  // ---------- Quitter ----------
  /** Plein écran du navigateur (F11). */
  const browserFullscreen = () => window.matchMedia('(display-mode: fullscreen)').matches ||
    (window.innerHeight >= screen.height - 2 && window.innerWidth >= screen.width - 2);

  /**
   * Une page web ne peut pas toujours se fermer elle-même, ni sortir du plein
   * écran F11 du navigateur : on sauvegarde, on fait ce qui est permis, puis
   * on explique la suite si la fenêtre est toujours là.
   */
  async function quitApp() {
    clearTimeout(aiTimer);
    save();
    if (config.cameraLight) RoomLight.Camera.stop();
    $('setup').hidden = true;
    $('endgame').hidden = true;
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (e) { /* déjà sorti */ }
    }
    window.close();
    setTimeout(() => {
      if (window.closed) return;
      const f11 = browserFullscreen();
      $('quitFull').hidden = !f11;
      $('quitFullHow').hidden = !f11;
      $('quit').hidden = false;
    }, 300);
  }
  $('btnQuitSetup').addEventListener('click', quitApp);
  // En fermant la fenêtre d'explication, le jeu reprend (caméra comprise).
  $('quit').querySelector('[data-close]').addEventListener('click', () => {
    if (config.cameraLight) applyCamera();
    nextTurn();
  });

  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
    b.closest('.modal').hidden = true;
  }));
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'Escape') { clearSelection(); requestDraw(); }
  });

  new ResizeObserver(() => { renderer.resize(); applyTilt(); }).observe($('stage'));
  applyTilt();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (!resume()) {
    start(config);
    openSetup();
  }

  // Accès pour les tests automatisés.
  window.__cc = { get game() { return game; }, get selected() { return selected; }, get tilt() { return tilt; }, renderer, start, BOARD };
})();
