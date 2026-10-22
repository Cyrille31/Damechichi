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
  const renderer = new Renderer(canvas);
  let config = store.get('cc-settings') || defaultConfig(2);
  let game = null;
  let colors = [];
  let selected = -1, targets = null, targetMoves = null;
  let drag = null, hoverCell = -1;
  let job = null;          // animation en cours
  let displayOcc = null;   // occupation affichée pendant une animation
  let aiTimer = null;
  let lastMove = null;
  let raf = 0;

  function defaultConfig(n) {
    const players = [];
    for (let i = 0; i < n; i++) {
      players.push(i === 0
        ? { name: 'Joueur 1', type: 'human', level: 'medium' }
        : { name: 'Ordinateur ' + i, type: 'ai', level: 'medium' });
    }
    return { players, speed: 1, showMoves: true };
  }

  const isHumanTurn = () => game && !game.over && !job && game.players[game.current].type === 'human';
  const playerLabel = pi => `${game.players[pi].name} (${PIECE_COLORS[colors[pi]].name})`;

  // ---------- Démarrage ----------
  function start(cfg, replay) {
    clearTimeout(aiTimer);
    job = null;
    displayOcc = null;
    config = cfg;
    store.set('cc-settings', cfg);
    game = new Game({ players: cfg.players });
    colors = game.players.map((p, i) => i);
    lastMove = null;
    clearSelection();
    if (replay) {
      for (const m of replay) {
        if (m.pass) game.pass();
        else game.play(m);
      }
      const last = game.history[game.history.length - 1];
      if (last && !last.pass) lastMove = last;
    }
    const firstHuman = game.players.findIndex(p => p.type === 'human');
    const armColors = [null, null, null, null, null, null];
    game.players.forEach((p, i) => { armColors[p.arm] = colors[i]; });
    renderer.setView(firstHuman >= 0 ? game.players[firstHuman].arm : 0, armColors);
    save();
    requestDraw();
    if (game.over) showEnd(); else nextTurn();
  }

  function save() {
    if (!game) return;
    store.set('cc-game', {
      config,
      moves: game.history.map(h => (h.pass ? { pass: true } : { from: h.from, to: h.to, path: h.path }))
    });
  }

  function resume() {
    const saved = store.get('cc-game');
    if (!saved || !saved.config) return false;
    try {
      start(saved.config, saved.moves || []);
      return true;
    } catch (e) {
      store.remove('cc-game');
      return false;
    }
  }

  // ---------- Tours ----------
  function nextTurn() {
    updateHud();
    if (game.over) { showEnd(); return; }
    const pi = game.current, p = game.players[pi];
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
      }, 380 / config.speed);
    }
  }

  function doMove(move) {
    const pi = game.current;
    clearSelection();
    const res = game.play(move);
    lastMove = game.history[game.history.length - 1];
    save();
    displayOcc = game.occ.slice();
    if (res.swaps) for (const s of res.swaps) { displayOcc[s.a] = s.owner; displayOcc[s.b] = pi; }
    animateMove(move, pi, () => {
      if (res.swaps) {
        toast('Anti-blocage : échange des pions coincés.');
        animateSwaps(res.swaps, pi, () => afterMove(res));
      } else {
        afterMove(res);
      }
    });
  }

  function afterMove(res) {
    displayOcc = null;
    if (res.finished !== null && !res.over) {
      const rank = game.players[res.finished].finished;
      toast(`🏆 ${playerLabel(res.finished)} termine ${rank === 1 ? '1er' : rank + 'e'} !`);
    }
    requestDraw();
    nextTurn();
  }

  function undo() {
    if (!game || job || !game.history.length) return;
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

  // ---------- Animation ----------
  function animateMove(move, pi, onDone) {
    const sp = renderer.spacing;
    const segs = [];
    let t = 0;
    for (let k = 1; k < move.path.length; k++) {
      const a = move.path[k - 1], b = move.path[k];
      const len = window.CC.dist(a, b);
      const jump = len > 1 || move.jump;
      const dur = (jump ? 200 + 55 * len : 230) / config.speed;
      segs.push({ a, b, start: t, dur, height: jump ? Math.min(sp * 2.2, sp * (0.45 + 0.22 * len)) : sp * 0.12 });
      t += dur + 40 / config.speed;
    }
    runJob([{ color: colors[pi], segs }], [move.to], t, onDone, pi);
  }

  function animateSwaps(swaps, pi, onDone) {
    const dur = 750 / config.speed, sp = renderer.spacing;
    const movers = [], hidden = [];
    for (const s of swaps) {
      movers.push({ color: colors[pi], segs: [{ a: s.b, b: s.a, start: 0, dur, height: sp * 2 }] });
      movers.push({ color: colors[s.owner], segs: [{ a: s.a, b: s.b, start: 0, dur, height: sp * 2.6 }] });
      hidden.push(s.a, s.b);
    }
    displayOcc = null;
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
      out.push({ color: m.color, x: A.x + (B.x - A.x) * e, y: A.y + (B.y - A.y) * e, lift: seg.height * Math.sin(Math.PI * local) });
    });
    if (t >= job.total) {
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
    let movers = job ? jobFrame(now) : null;
    const hidden = job ? new Set(job.hidden) : new Set();
    if (drag && drag.moved) {
      hidden.add(drag.cell);
      movers = [{ color: colors[game.current], x: drag.x, y: drag.y, lift: renderer.spacing * 0.25 }];
    }
    let hoverPath = null;
    if (targetMoves && hoverCell >= 0) {
      const m = targetMoves.find(mv => mv.to === hoverCell);
      if (m && m.path.length > 2) hoverPath = m.path;
    }
    renderer.draw({
      occ: job && displayOcc ? displayOcc : game.occ,
      colors,
      hidden,
      movers,
      selected,
      targets: config.showMoves || drag ? targets : null,
      hoverPath,
      hoverPi: game.current,
      lastMove: job ? null : lastMove,
      time: now
    });
    if (job || selected >= 0) requestDraw();
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

  function localPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', e => {
    Sound.unlock();
    if (!isHumanTurn()) return;
    const p = localPoint(e), c = renderer.hitTest(p.x, p.y);
    if (c >= 0 && game.occ[c] === game.current) {
      const again = c === selected;
      select(c);
      drag = { cell: c, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false, again };
      canvas.setPointerCapture(e.pointerId);
    } else if (selected >= 0 && c >= 0 && targets.includes(c)) {
      doMove(targetMoves.find(m => m.to === c));
    } else {
      clearSelection();
    }
    requestDraw();
  });

  canvas.addEventListener('pointermove', e => {
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
    } else if (!d.moved && d.again) {
      clearSelection();
    }
    requestDraw();
  }
  canvas.addEventListener('pointerup', e => endDrag(e, false));
  canvas.addEventListener('pointercancel', e => endDrag(e, true));
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
      $('turnName').textContent = p.type === 'ai'
        ? `${p.name} réfléchit…`
        : `À ${p.name} de jouer`;
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
      list.append(li);
    });
    $('endTitle').textContent = `${game.players[game.ranking[0]].name} gagne !`;
    $('endgame').hidden = false;
  }

  // ---------- Écran de configuration ----------
  let draft = null;

  function openSetup() {
    draft = JSON.parse(JSON.stringify(config));
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
    $('showMoves').checked = draft.showMoves;
  }

  document.querySelectorAll('#countBtns button').forEach(b => b.addEventListener('click', () => {
    const n = +b.dataset.n;
    const fresh = defaultConfig(n).players;
    draft.players = fresh.map((p, i) => draft.players[i] || p);
    renderSetup();
  }));

  $('btnStart').addEventListener('click', () => {
    Sound.unlock();
    draft.speed = parseFloat($('speed').value) || 1;
    draft.showMoves = $('showMoves').checked;
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
  $('btnSound').addEventListener('click', () => {
    Sound.on = !Sound.on;
    store.set('cc-sound', Sound.on);
    $('btnSound').textContent = Sound.on ? '🔊' : '🔇';
    if (Sound.on) { Sound.unlock(); Sound.toc(); }
  });
  $('btnSound').textContent = Sound.on ? '🔊' : '🔇';
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
    b.closest('.modal').hidden = true;
  }));
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'Escape') { clearSelection(); requestDraw(); }
  });

  new ResizeObserver(() => { renderer.resize(); requestDraw(); }).observe($('stage'));

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (!resume()) {
    start(config);
    openSetup();
  }

  // Accès pour les tests automatisés.
  window.__cc = { get game() { return game; }, renderer, start, BOARD };
})();
