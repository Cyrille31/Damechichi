/*
 * Dames chinoises — joueur ordinateur.
 * Copyright (c) 2026 cgexcel. Voir le fichier LICENSE.
 */
(function (root) {
  'use strict';

  const CC = root.CC || require('./game.js');
  const { BOARD, N, SQRT3, dist } = CC;

  const LEVELS = {
    easy:   { noise: 1.6, follow: 0,    top: 0,  randomMove: 0.15 },
    medium: { noise: 0.35, follow: 0.35, top: 8,  randomMove: 0 },
    hard:   { noise: 0.05, follow: 0.7,  top: 24, randomMove: 0, opp: 0.6 }
  };

  /**
   * Coût de chaque case pour un joueur : distance à la pointe visée, retard,
   * écart à l'axe, et distance au trou libre le plus proche de la branche visée.
   */
  function costTable(game, pi) {
    const player = game.players[pi];
    const tip = BOARD.arms[player.target].tip;
    const home = BOARD.cells[BOARD.arms[player.arm].tip];
    const t = BOARD.cells[tip];
    const vx = t.x - home.x, vy = t.y - home.y, len = Math.hypot(vx, vy);
    const cost = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const c = BOARD.cells[i];
      const d = dist(i, tip);
      const lateral = Math.abs((c.x - home.x) * vy - (c.y - home.y) * vx) / len / SQRT3;
      cost[i] = d + 0.04 * d * d + 0.2 * Math.max(0, lateral - 1);
    }
    const holes = BOARD.arms[player.target].cells.filter(c => game.occ[c] !== pi);
    for (let i = 0; i < N; i++) {
      if (BOARD.cells[i].arm === player.target) continue;
      let m = Infinity;
      for (const h of holes) m = Math.min(m, dist(i, h));
      if (m < Infinity) cost[i] += 0.6 * m;
    }
    return cost;
  }

  function bestGain(game, pi, cost) {
    let best = -Infinity;
    for (const m of game.legalMoves(pi)) {
      const g = cost[m.from] - cost[m.to];
      if (g > best) best = g;
    }
    return best === -Infinity ? 0 : best;
  }

  /** Derniers coups de ce joueur (pour éviter les allers-retours d'un même pion). */
  function recentMoves(game, pi, count) {
    const list = [];
    for (let k = game.history.length - 1; k >= 0 && list.length < count; k--) {
      const h = game.history[k];
      if (h.pi === pi && !h.pass) list.push(h);
    }
    return list;
  }

  function nextOpponent(game, pi) {
    const n = game.players.length;
    for (let k = 1; k < n; k++) {
      const j = (pi + k) % n;
      if (!game.players[j].finished) return j;
    }
    return -1;
  }

  function chooseMove(game, pi, level = 'medium', rand = Math.random) {
    const opts = LEVELS[level] || LEVELS.medium;
    const moves = game.legalMoves(pi);
    if (!moves.length) return null;
    if (opts.randomMove && rand() < opts.randomMove) {
      const forward = moves.filter(m => dist(m.to, BOARD.arms[game.players[pi].target].tip) <
                                        dist(m.from, BOARD.arms[game.players[pi].target].tip));
      const pool = forward.length ? forward : moves;
      return pool[Math.floor(rand() * pool.length)];
    }

    const cost = costTable(game, pi);
    const target = game.players[pi].target;
    const inTarget = c => BOARD.cells[c].arm === target;
    const outside = game.piecesOf(pi).filter(c => !inTarget(c)).length;
    const recent = recentMoves(game, pi, 4);
    const scored = moves.map(m => {
      let s = cost[m.from] - cost[m.to];
      // Entrer dans la branche visée tout de suite plutôt que de remanier l'intérieur.
      if (inTarget(m.to) && !inTarget(m.from)) s += 1;
      else if (inTarget(m.to) && inTarget(m.from) && s < 0.5) s -= 0.5;
      recent.forEach((h, age) => {
        if (h.to === m.from && h.from === m.to) s -= 2 / (age + 1);
      });
      return { m, s, base: s };
    });
    scored.sort((a, b) => b.s - a.s);

    if (opts.follow > 0 && outside > 2) {
      const occ = game.occ;
      // Adversaire suivant : éviter de lui offrir une belle échelle de sauts.
      const opp = opts.opp ? nextOpponent(game, pi) : -1;
      const oppCost = opp >= 0 ? costTable(game, opp) : null;
      const oppBase = opp >= 0 ? bestGain(game, opp, oppCost) : 0;
      for (const e of scored.slice(0, opts.top)) {
        occ[e.m.from] = -1;
        occ[e.m.to] = pi;
        e.s = e.base + opts.follow * bestGain(game, pi, cost);
        if (opp >= 0) e.s -= opts.opp * Math.max(0, bestGain(game, opp, oppCost) - oppBase);
        occ[e.m.to] = -1;
        occ[e.m.from] = pi;
      }
    }

    let best = null, bestScore = -Infinity;
    for (const e of scored) {
      const s = e.s + (rand() - 0.5) * opts.noise;
      if (s > bestScore) { bestScore = s; best = e.m; }
    }
    return best;
  }

  const AI = { chooseMove, LEVELS };
  root.CCAI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);
