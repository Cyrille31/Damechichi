/*
 * Dames chinoises — règles du jeu.
 * CGExcel — Cyrille Gindre — © 2026
 * Licence MIT + BAL 1.0 — Bonne Action License
 * En échange, une seule chose vous est demandée, sur l'honneur : faire une bonne action chaque jour. Aider un voisin, sourire à un inconnu, ramasser un papier… c'est vous qui voyez.
 * Voir le fichier LICENSE.
 *
 * Plateau en étoile de 121 trous, repéré en coordonnées cubiques (q, r, s)
 * avec q + r + s = 0. Mode « Bonne-Maman » (saut long) : un pion aligné avec
 * un autre, séparé par n cases vides, peut sauter par-dessus et retomber de
 * l'autre côté en laissant n cases vides. Sans ce mode, seul le saut classique
 * par-dessus un pion voisin est permis. Les sauts s'enchaînent.
 */
(function (root) {
  'use strict';

  const SQRT3 = Math.sqrt(3);
  // Six directions (dq, dr) dans le sens horaire à l'écran.
  const DIRS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];

  function buildBoard() {
    const cells = [];
    const index = new Map();
    for (let r = -8; r <= 8; r++) {
      for (let q = -8; q <= 8; q++) {
        const s = -q - r;
        const inA = q >= -4 && r >= -4 && s >= -4;
        const inB = q <= 4 && r <= 4 && s <= 4;
        if (!inA && !inB) continue;
        index.set(q + ',' + r, cells.length);
        cells.push({ q, r, s, x: SQRT3 * (q + r / 2), y: 1.5 * r, arm: -1 });
      }
    }
    const nb = cells.map(c => DIRS.map(([dq, dr]) => {
      const k = index.get((c.q + dq) + ',' + (c.r + dr));
      return k === undefined ? -1 : k;
    }));

    // Les six branches de l'étoile, triées dans le sens horaire depuis le bas.
    const armTests = [c => c.r > 4, c => c.r < -4, c => c.q > 4, c => c.q < -4, c => c.s > 4, c => c.s < -4];
    const arms = armTests.map(test => {
      const list = [];
      cells.forEach((c, i) => { if (test(c)) list.push(i); });
      let tip = list[0], best = -1;
      for (const i of list) {
        const c = cells[i];
        const m = Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.s));
        if (m > best) { best = m; tip = i; }
      }
      const t = cells[tip];
      const angle = ((Math.atan2(t.y, t.x) * 180 / Math.PI - 90) % 360 + 360) % 360;
      return { cells: list, tip, angle };
    });
    arms.sort((a, b) => a.angle - b.angle);
    arms.forEach((a, k) => a.cells.forEach(i => { cells[i].arm = k; }));
    return { cells, nb, arms, index };
  }

  const BOARD = buildBoard();
  const N = BOARD.cells.length;

  const DIST = new Uint8Array(N * N);
  for (let a = 0; a < N; a++) {
    const A = BOARD.cells[a];
    for (let b = 0; b < N; b++) {
      const B = BOARD.cells[b];
      DIST[a * N + b] = (Math.abs(A.q - B.q) + Math.abs(A.r - B.r) + Math.abs(A.s - B.s)) / 2;
    }
  }
  const dist = (a, b) => DIST[a * N + b];

  // Branches occupées selon le nombre de joueurs (0 = en bas, sens horaire).
  const SEATS = {
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5]
  };

  const opposite = arm => (arm + 3) % 6;

  /**
   * Tous les déplacements d'un pion : un pas vers une case voisine libre,
   * ou une suite de sauts longs. Chaque coup porte son chemin complet
   * (liste des cases traversées) pour l'animation.
   * `canStop(cell)` dit si le pion peut s'arrêter sur une case ; il peut
   * toujours la traverser au cours d'une suite de sauts.
   * `longJumps` (mode Bonne-Maman) autorise les sauts par-dessus des cases vides.
   */
  function movesFrom(occ, from, canStop = () => true, longJumps = true) {
    const nb = BOARD.nb;
    const res = [];
    for (let d = 0; d < 6; d++) {
      const n = nb[from][d];
      if (n >= 0 && occ[n] < 0 && canStop(n)) res.push({ from, to: n, path: [from, n], jump: false });
    }

    // Le pion qui bouge libère sa case de départ pendant la recherche.
    const saved = occ[from];
    occ[from] = -1;
    const parent = new Map([[from, -1]]);
    const queue = [from];
    for (let qi = 0; qi < queue.length; qi++) {
      const c = queue[qi];
      for (let d = 0; d < 6; d++) {
        // Cherche le premier pion dans cette direction (k = distance).
        let cur = c, k = 0;
        for (;;) {
          cur = nb[cur][d];
          if (cur < 0) break;
          k++;
          if (occ[cur] >= 0) break;
        }
        if (cur < 0 || (k > 1 && !longJumps)) continue;
        // Il faut k - 1 cases vides derrière le pion, puis la case d'arrivée libre.
        let land = cur, ok = true;
        for (let j = 0; j < k; j++) {
          land = nb[land][d];
          if (land < 0 || occ[land] >= 0) { ok = false; break; }
        }
        if (!ok || parent.has(land)) continue;
        parent.set(land, c);
        queue.push(land);
      }
    }
    occ[from] = saved;

    for (const [cell, par] of parent) {
      if (cell === from || !canStop(cell)) continue;
      const path = [cell];
      for (let p = par; p !== -1; p = parent.get(p)) path.push(p);
      path.reverse();
      res.push({ from, to: cell, path, jump: true });
    }
    return res;
  }

  class Game {
    /**
     * @param {{players: {name: string, type: 'human'|'ai', level?: string, color?: number}[]}} config
     */
    constructor(config) {
      const n = config.players.length;
      const seats = SEATS[n];
      if (!seats) throw new Error('Nombre de joueurs invalide : ' + n);
      this.config = config;
      this.longJumps = config.longJumps !== false;
      this.players = config.players.map((p, i) => Object.assign({}, p, {
        arm: seats[i], target: opposite(seats[i]), finished: 0
      }));
      this.occ = new Int8Array(N).fill(-1);
      this.players.forEach((p, i) => BOARD.arms[p.arm].cells.forEach(c => { this.occ[c] = i; }));
      this.current = 0;
      this.ranking = [];
      this.history = [];
      this.over = false;
      this.solo = -1;       // joueur qui finit seul après la fin de la partie
      this.soloStart = -1;  // longueur de l'historique au début de ce « finir seul »
    }

    /** Nombre de tours joués par un joueur. */
    turnsOf(pi) {
      let n = 0;
      for (const h of this.history) if (h.pi === pi) n++;
      return n;
    }

    /** Après la fin, le dernier joueur peut-il encore ranger ses pions tout seul ? */
    canFinishSolo() {
      if (!this.over || this.solo >= 0) return false;
      const last = this.ranking[this.ranking.length - 1];
      return last !== undefined && !this.hasWon(last) && this.legalMoves(last).length > 0;
    }

    finishSolo() {
      if (!this.canFinishSolo()) return false;
      this.solo = this.ranking.pop();
      this.soloStart = this.history.length;
      this._syncFinished();
      this.current = this.solo;
      this.over = false;
      return true;
    }

    piecesOf(pi) {
      const list = [];
      for (let i = 0; i < N; i++) if (this.occ[i] === pi) list.push(i);
      return list;
    }

    /** Un pion ne peut s'arrêter ni dans les triangles des autres : seulement au centre, chez soi ou à l'arrivée. */
    canStop(pi, cell) {
      const arm = BOARD.cells[cell].arm;
      const p = this.players[pi];
      return arm < 0 || arm === p.arm || arm === p.target;
    }

    movesFor(cell) {
      const pi = this.occ[cell];
      return movesFrom(this.occ, cell, c => this.canStop(pi, c), this.longJumps);
    }

    legalMoves(pi = this.current) {
      const moves = [];
      for (const c of this.piecesOf(pi)) moves.push(...this.movesFor(c));
      return moves;
    }

    /**
     * Gagné : les 10 pions sont arrivés dans la branche opposée.
     * Anti-blocage : la branche est pleine et les pions adverses qui y restent
     * (3 au plus) sont totalement immobilisés ; ils seront alors échangés avec
     * les pions égarés du gagnant (voir _resolveBlock).
     */
    hasWon(pi) {
      const target = BOARD.arms[this.players[pi].target].cells;
      const foreign = [];
      for (const c of target) {
        if (this.occ[c] < 0) return false;
        if (this.occ[c] !== pi) foreign.push(c);
      }
      if (!foreign.length) return true;
      return foreign.length <= 3 && foreign.every(c => this.movesFor(c).length === 0);
    }

    activeCount() {
      return this.players.filter(p => !p.finished).length;
    }

    advance() {
      const n = this.players.length;
      do { this.current = (this.current + 1) % n; } while (this.players[this.current].finished);
    }

    _syncFinished() {
      this.players.forEach(p => { p.finished = 0; });
      this.ranking.forEach((pi, k) => { this.players[pi].finished = k + 1; });
    }

    /** Échange les pions adverses bloqués dans la branche visée avec les pions égarés du gagnant. */
    _resolveBlock(pi) {
      const target = this.players[pi].target;
      const foreign = BOARD.arms[target].cells.filter(c => this.occ[c] !== pi);
      if (!foreign.length) return null;
      const outside = this.piecesOf(pi).filter(c => BOARD.cells[c].arm !== target);
      return foreign.map((a, k) => {
        const b = outside[k], owner = this.occ[a];
        this.occ[a] = pi;
        this.occ[b] = owner;
        return { a, b, owner };
      });
    }

    _endTurn(pi, h) {
      let finished = null;
      if (!this.players[pi].finished && this.hasWon(pi)) {
        h.swaps = this._resolveBlock(pi);
        this.ranking.push(pi);
        finished = pi;
      }
      this._syncFinished();
      if (this.solo >= 0) {
        // Seul en jeu : on continue jusqu'à l'arrivée (ou jusqu'au blocage complet).
        if (finished === null && !this.legalMoves(pi).length) {
          this.ranking.push(pi);
          this._syncFinished();
        }
        this.over = this.players[pi].finished > 0;
      } else if (this.activeCount() <= 1) {
        const last = this.players.findIndex(p => !p.finished);
        if (last >= 0) this.ranking.push(last);
        this._syncFinished();
        this.over = true;
      } else {
        this.advance();
      }
      return { finished, over: this.over, swaps: h.swaps || null };
    }

    play(move) {
      const pi = this.current;
      if (this.occ[move.from] !== pi || this.occ[move.to] >= 0 || !this.canStop(pi, move.to)) throw new Error('Coup illégal');
      const h = { pi, from: move.from, to: move.to, path: move.path, rankingLen: this.ranking.length };
      this.history.push(h);
      this.occ[move.to] = pi;
      this.occ[move.from] = -1;
      return this._endTurn(pi, h);
    }

    pass() {
      const pi = this.current;
      const h = { pi, pass: true, rankingLen: this.ranking.length };
      this.history.push(h);
      return this._endTurn(pi, h);
    }

    undo() {
      const h = this.history.pop();
      if (!h) return null;
      if (h.swaps) {
        for (const { a, b, owner } of h.swaps) {
          this.occ[a] = owner;
          this.occ[b] = h.pi;
        }
      }
      if (!h.pass) {
        this.occ[h.from] = h.pi;
        this.occ[h.to] = -1;
      }
      if (this.solo >= 0 && this.history.length < this.soloStart) {
        this.solo = -1;
        this.soloStart = -1;
      }
      this.ranking.length = h.rankingLen;
      this._syncFinished();
      this.current = h.pi;
      this.over = false;
      return h;
    }
  }

  const CC = { SQRT3, DIRS, BOARD, N, SEATS, dist, opposite, movesFrom, Game };
  root.CC = CC;
  if (typeof module !== 'undefined' && module.exports) module.exports = CC;
})(typeof window !== 'undefined' ? window : globalThis);
