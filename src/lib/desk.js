// Tearing engine: papers, pieces, the tear algorithm and the canvas renderer.
// A piece is never stored as a polygon. It is the source paper plus a list of
// "side of a tear line" constraints, drawn by stacking canvas clip() calls.

const G = 52;                // sample grid per paper (G x G points)
const PAPER_COLOR = '#fbf9f3'; // paper colour (white border and torn core)
const MAXS = 1100;           // longest side a paper is scaled down to

/** 机に置ける紙の最大枚数 */
export const MAX_PAPERS = 12;

/**
 * @typedef {object} Paper 机に置いた1枚の紙
 * @property {number} id
 * @property {HTMLCanvasElement} img 紙の画像
 * @property {number} W 幅
 * @property {number} H 高さ
 * @property {Float32Array} sx サンプル点のx座標（G×G個）。ピースにどの部分が含まれるかの判定に使う
 * @property {Float32Array} sy サンプル点のy座標
 * @property {number|null} hx 机の上での定位置（左上のx）。並べるまでは null
 * @property {number|null} hy 机の上での定位置（左上のy）
 * @property {number} rot0 置いたときの傾き（ラジアン）
 * @property {string} thumb サムネイルの data URL
 */

/**
 * 破り線の片側を表す領域。座標は紙のローカル座標で、[x0, y0, x1, y1, ...] の平らな配列。
 * @typedef {object} Constraint
 * @property {number[]} outer 紙のふちになるギザギザの輪郭
 * @property {number[]} inner 画像が残る範囲。破れ目の白い芯の分だけ outer より内側。芯が出ない側は outer と同じ配列
 */

/**
 * 紙の破片。多角形は持たず、元の紙と破り線の制約の組で表す。
 * @typedef {object} Piece
 * @property {number} id
 * @property {Paper} paper 元の紙
 * @property {Constraint[]} cons これまでの破り線。すべての制約の内側がこのピース
 * @property {number[]} idx このピースに含まれるサンプル点の番号
 * @property {number} rot 回転（ラジアン）
 * @property {number} tx 平行移動のx（机の座標）
 * @property {number} ty 平行移動のy（机の座標）
 * @property {number} px 回転の中心x（ローカル座標）
 * @property {number} py 回転の中心y（ローカル座標）
 * @property {HTMLCanvasElement|null} cache bake で描いたキャッシュ。未作成なら null
 * @property {number} bx キャッシュの左上x（ローカル座標）
 * @property {number} by キャッシュの左上y（ローカル座標）
 * @property {{f: number[], t: number[], st: number}|null} anim 動作中のアニメーション（開始値・目標値 [tx, ty, rot] と開始時刻）
 */

/** @typedef {{x0: number, y0: number, x1: number, y1: number}} Bounds 机の座標での矩形 */

let uid = 0;

/* ---------- source images ---------- */

/**
 * 画像を長辺 MAXS 以下に縮小し、必要なら白いふちを付けたキャンバスを作る。
 * @param {HTMLImageElement|HTMLCanvasElement} src 元の画像
 * @param {boolean} border true なら短辺の4%の白いふちを付ける
 * @returns {HTMLCanvasElement}
 */
export function framedCanvas(src, border) {
  const k = Math.min(1, MAXS / Math.max(src.width, src.height));
  const w = Math.round(src.width * k), h = Math.round(src.height * k);
  const b = border ? Math.round(Math.min(w, h) * 0.04) : 0;
  const c = document.createElement('canvas');
  c.width = w + b * 2; c.height = h + b * 2;
  const g = c.getContext('2d');
  g.fillStyle = PAPER_COLOR; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, b, b, w, h);
  if (b) { g.strokeStyle = '#0000000f'; g.strokeRect(b + 0.5, b + 0.5, w - 1, h - 1); }
  return c;
}

/**
 * 画像ファイルを読み込み、紙用のキャンバスにする。
 * @param {File} file 画像ファイル
 * @param {boolean} border 白いふちを付けるか
 * @returns {Promise<HTMLCanvasElement|null>} 読み込めなかったときは null
 */
export function loadFile(file, border) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(framedCanvas(im, border)); };
    im.onerror = () => { URL.revokeObjectURL(url); res(null); };
    im.src = url;
  });
}

/**
 * キャンバスから紙のデータを作る。判定用の G×G のサンプル点と、一覧用のサムネイルも用意する。
 * @param {HTMLCanvasElement} c 紙の画像
 * @returns {Paper}
 */
function makePaper(c) {
  const W = c.width, H = c.height, sx = new Float32Array(G * G), sy = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    sx[j * G + i] = ((i + 0.5) * W) / G; sy[j * G + i] = ((j + 0.5) * H) / G;
  }
  const th = 96, tw = Math.round((W * th) / H), t = document.createElement('canvas');
  t.width = tw; t.height = th; t.getContext('2d').drawImage(c, 0, 0, tw, th);
  return { id: ++uid, img: c, W, H, sx, sy, hx: null, hy: null, rot0: 0, thumb: t.toDataURL('image/jpeg', 0.8) };
}

/**
 * ピースを作る。
 * @param {Paper} paper 元の紙
 * @param {Constraint[]} cons 破り線の制約
 * @param {number[]} idx 含まれるサンプル点の番号
 * @param {number} rot 回転（ラジアン）
 * @param {number} tx 平行移動のx
 * @param {number} ty 平行移動のy
 * @param {number} px 回転の中心x（ローカル座標）
 * @param {number} py 回転の中心y（ローカル座標）
 * @returns {Piece}
 */
function mk(paper, cons, idx, rot, tx, ty, px, py) {
  return { id: ++uid, paper, cons, idx, rot, tx, ty, px, py, cache: null, bx: 0, by: 0, anim: null };
}
/**
 * まだ破っていない、紙1枚まるごとのピースを作る。紙の定位置に置き、紙の中心で回転させる。
 * @param {Paper} paper
 * @returns {Piece}
 */
function whole(paper) {
  const all = []; for (let i = 0; i < G * G; i++) all.push(i);
  return mk(paper, [], all, paper.rot0, paper.hx, paper.hy, paper.W / 2, paper.H / 2);
}

/* ---------- geometry ---------- */

/**
 * 点が多角形の内側にあるかを偶奇判定で調べる。
 * @param {number} x
 * @param {number} y
 * @param {number[]} p 多角形の頂点（[x0, y0, x1, y1, ...] の平らな配列）
 * @returns {boolean}
 */
function inPoly(x, y, p) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const yi = p[i + 1], yj = p[j + 1];
    if (yi > y !== yj > y && x < ((p[j] - p[i]) * (y - yi)) / (yj - yi) + p[i]) c = !c;
  }
  return c;
}
/**
 * ローカル座標の点がピースの内側にあるか。紙の範囲内で、すべての破り線の outer の内側なら true。
 * @param {Piece} p
 * @param {number} x ローカル座標のx
 * @param {number} y ローカル座標のy
 * @returns {boolean}
 */
function insideLocal(p, x, y) {
  if (x < 0 || y < 0 || x > p.paper.W || y > p.paper.H) return false;
  for (const c of p.cons) if (!inPoly(x, y, c.outer)) return false;
  return true;
}
/**
 * 机の座標を、ピースのローカル座標（元の紙の上の座標）に変換する。toWorld の逆。
 * @param {Piece} p
 * @param {number} wx 机の座標のx
 * @param {number} wy 机の座標のy
 * @returns {[number, number]}
 */
function toLocal(p, wx, wy) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = wx - p.px - p.tx, dy = wy - p.py - p.ty;
  return [c * dx + s * dy + p.px, -s * dx + c * dy + p.py];
}
/**
 * ピースのローカル座標を机の座標に変換する。
 * @param {Piece} p
 * @param {number} lx ローカル座標のx
 * @param {number} ly ローカル座標のy
 * @returns {[number, number]}
 */
export function toWorld(p, lx, ly) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = lx - p.px, dy = ly - p.py;
  return [c * dx - s * dy + p.px + p.tx, s * dx + c * dy + p.py + p.ty];
}
/**
 * 折れ線の点を、ほぼ step 間隔に取り直す。
 * @param {number[][]} pts 折れ線の点 [[x, y], ...]
 * @param {number} step 点の間隔
 * @returns {number[][]}
 */
function resample(pts, step) {
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1]; const b = pts[i];
    let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc + d >= step) {
      const t = (step - acc) / d;
      a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(a); d = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0;
    }
    acc += d;
  }
  const l = pts[pts.length - 1], o = out[out.length - 1];
  if (Math.hypot(l[0] - o[0], l[1] - o[1]) > step * 0.3) out.push(l);
  return out;
}
/**
 * 端点以外の各点を、両隣と 1:2:1 で平均して折れ線をなめらかにする。
 * @param {number[][]} p 折れ線の点
 * @param {number} n 繰り返す回数
 * @returns {number[][]}
 */
function smooth(p, n) {
  for (let k = 0; k < n; k++)
    p = p.map((q, i) => (i === 0 || i === p.length - 1 ? q
      : [(p[i - 1][0] + q[0] * 2 + p[i + 1][0]) / 4, (p[i - 1][1] + q[1] * 2 + p[i + 1][1]) / 4]));
  return p;
}
/**
 * ベクトルを長さ1にする。長さ0のときは [0, 0] を返す。
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]}
 */
function unit(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

/**
 * なぞった線を、破り線の両側を表す2つの制約に変える。
 * 線の両端を紙の外まで延ばしてからギザギザに揺らし、片側にだけ白い芯が見えるよう inner をずらす。
 * 各領域は、その線と半径 R の大きな円弧で閉じて作る。
 * @param {number[][]} local なぞった点（ピースのローカル座標）
 * @param {Paper} paper 元の紙
 * @returns {{pos: Constraint, neg: Constraint}|null} 点が少なすぎるときは null
 */
function buildCut(local, paper) {
  let p = smooth(resample(local, 10), 3);
  if (p.length < 2) return null;
  const ext = Math.hypot(paper.W, paper.H) * 2, k = Math.min(3, p.length - 1);
  const ts = unit(p[0][0] - p[k][0], p[0][1] - p[k][1]);
  const te = unit(p[p.length - 1][0] - p[p.length - 1 - k][0], p[p.length - 1][1] - p[p.length - 1 - k][1]);
  p = [[p[0][0] + ts[0] * ext, p[0][1] + ts[1] * ext], ...p,
       [p[p.length - 1][0] + te[0] * ext, p[p.length - 1][1] + te[1] * ext]];
  const base = resample(p, 5), n = base.length, r = Math.random;
  const outer = [], inner = [], sgn = r() < 0.5 ? 1 : -1;
  let walk = 0, wv = 0, mid = null;
  for (let i = 0; i < n; i++) {
    const a = base[Math.max(0, i - 1)], b = base[Math.min(n - 1, i + 1)];
    const [nx, ny] = unit(-(b[1] - a[1]), b[0] - a[0]);
    if (i === n >> 1) mid = [nx, ny];
    walk += (r() - 0.5) * 3.2; walk *= 0.9;
    wv += (r() - 0.5) * 1.6; wv *= 0.85;
    const off = walk + (r() - 0.5) * 2.6, w = 2 + Math.abs(wv) * 3 + r() * 1.5;
    outer.push(base[i][0] + nx * off, base[i][1] + ny * off);
    inner.push(base[i][0] + nx * (off + sgn * w), base[i][1] + ny * (off + sgn * w));
  }
  const cx = local[local.length >> 1][0], cy = local[local.length >> 1][1], R = 1e5;
  const aS = Math.atan2(base[0][1] - cy, base[0][0] - cx), aE = Math.atan2(base[n - 1][1] - cy, base[n - 1][0] - cx);
  const d1 = (((aS - aE) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), d2 = d1 - 2 * Math.PI;
  const arc = (d) => { const a = []; for (let i = 0; i <= 24; i++) { const t = aE + (d * i) / 24; a.push(cx + Math.cos(t) * R, cy + Math.sin(t) * R); } return a; };
  const m1 = aE + d1 / 2, pos = Math.cos(m1) * mid[0] + Math.sin(m1) * mid[1] > 0;
  const arcPos = arc(pos ? d1 : d2), arcNeg = arc(pos ? d2 : d1);
  const P = outer.concat(arcPos), N = outer.concat(arcNeg), core = inner.concat(sgn > 0 ? arcPos : arcNeg);
  return { pos: { outer: P, inner: sgn > 0 ? core : P }, neg: { outer: N, inner: sgn < 0 ? core : N } };
}

/* ---------- piece rendering ---------- */

/**
 * ピースの見た目をキャッシュ用のキャンバスに描き、p.cache / p.bx / p.by に入れる。
 * 紙の色で塗ってから inner の内側にだけ画像を描き、破れ目に薄い線を引く。
 * @param {Piece} p
 */
function bake(p) {
  const { W, H, sx, sy, img } = p.paper;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const i of p.idx) { x0 = Math.min(x0, sx[i]); y0 = Math.min(y0, sy[i]); x1 = Math.max(x1, sx[i]); y1 = Math.max(y1, sy[i]); }
  const pad = Math.max(W, H) / G + 24;
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(W, Math.ceil(x1 + pad)); y1 = Math.min(H, Math.ceil(y1 + pad));
  const c = document.createElement('canvas');
  c.width = Math.max(1, x1 - x0); c.height = Math.max(1, y1 - y0);
  const g = c.getContext('2d');
  g.translate(-x0, -y0); g.beginPath(); g.rect(0, 0, W, H); g.clip();
  const path = (a) => { g.beginPath(); g.moveTo(a[0], a[1]); for (let i = 2; i < a.length; i += 2) g.lineTo(a[i], a[i + 1]); g.closePath(); };
  for (const k of p.cons) { path(k.outer); g.clip(); }
  g.fillStyle = PAPER_COLOR; g.fillRect(0, 0, W, H);
  g.save();
  for (const k of p.cons) if (k.inner !== k.outer) { path(k.inner); g.clip(); }
  g.drawImage(img, 0, 0); g.restore();
  g.lineWidth = 1.2; g.strokeStyle = 'rgba(110,96,70,.28)';
  for (const k of p.cons) if (k.inner !== k.outer) { path(k.inner); g.stroke(); }
  g.lineWidth = 1.4; g.strokeStyle = 'rgba(0,0,0,.14)';
  for (const k of p.cons) { path(k.outer); g.stroke(); }
  p.cache = c; p.bx = x0; p.by = y0;
}

/**
 * ピースを1つ描く。キャッシュがなければ先に作る。
 * @param {CanvasRenderingContext2D} ctx 変換が机の座標に合わせてあるコンテキスト
 * @param {Piece} p
 */
export function drawPiece(ctx, p) {
  if (!p.cache) bake(p);
  ctx.save();
  ctx.translate(p.px + p.tx, p.py + p.ty); ctx.rotate(p.rot); ctx.translate(-p.px, -p.py);
  ctx.drawImage(p.cache, p.bx, p.by);
  ctx.restore();
}
/**
 * ピースの外接矩形を机の座標で求める。サンプル点から計算し、点の間隔分の余白を足す。
 * @param {Piece} p
 * @returns {Bounds}
 */
export function pieceBounds(p) {
  const { sx, sy, W, H } = p.paper, pad = (Math.max(W, H) / G) * 0.8 + 4;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const i of p.idx) {
    const [x, y] = toWorld(p, sx[i], sy[i]);
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/* ---------- the desk ---------- */

/**
 * CSS 変数の値を読む。
 * @param {string} name 変数名（例: '--danger'）
 * @returns {string}
 */
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** 机。紙とピースを持ち、破る・消す・元に戻す・描くを受け持つ。 */
export class Desk {
  /**
   * @param {HTMLCanvasElement} canvas 描画先
   * @param {() => void} onChange 紙やピースが変わったときに呼ばれる
   */
  constructor(canvas, onChange) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.onChange = onChange;
    this.papers = []; this.pieces = []; this.history = [];
    this.view = { s: 1, ox: 0, oy: 0 }; this.box = { x0: 0, y0: 0, x1: 1, y1: 1 };
    this.cw = 0; this.ch = 0; this.dpr = 1; this.animating = false;
    this.overlay = { stroke: null, hover: null };
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  /** 変更を onChange に知らせる。 */
  emit() { this.onChange && this.onChange(); }

  /* history: every undoable change saves the paper list, home positions and pieces */
  /**
   * 元に戻すための今の状態を作る。
   * @returns {{papers: Paper[], homes: (number|null)[][], pieces: Piece[], box: Bounds}}
   */
  snapshot() {
    return {
      papers: this.papers.slice(), homes: this.papers.map((p) => [p.hx, p.hy]),
      pieces: this.pieces.map((p) => ({ ...p, anim: null })), box: { ...this.box },
    };
  }
  /** 今の状態を履歴に積む。履歴は最大40件。 */
  save() { this.history.push(this.snapshot()); if (this.history.length > 40) this.history.shift(); }
  /** 元に戻せる履歴があるか。 */
  get canUndo() { return this.history.length > 0; }
  /** 直前の状態に戻す。 */
  undo() {
    const s = this.history.pop(); if (!s) return;
    this.papers = s.papers; s.papers.forEach((p, i) => { p.hx = s.homes[i][0]; p.hy = s.homes[i][1]; });
    this.pieces = s.pieces; this.box = s.box;
    this.fit(); this.draw(); this.emit();
  }

  /**
   * 紙を机に追加して並べ直す。MAX_PAPERS を超える分は無視する。
   * @param {HTMLCanvasElement[]} canvases 紙の画像
   * @param {{record?: boolean}} [opts] record が false なら履歴に残さない
   * @returns {number} 追加した枚数
   */
  add(canvases, { record = true } = {}) {
    const list = canvases.slice(0, MAX_PAPERS - this.papers.length);
    if (!list.length) return 0;
    if (record) this.save();
    for (const c of list) {
      const paper = makePaper(c);
      paper.rot0 = this.papers.length ? (Math.random() - 0.5) * 0.06 : 0;
      this.papers.push(paper);
    }
    this.arrange();
    for (const paper of this.papers) if (!this.pieces.some((p) => p.paper === paper)) this.pieces.push(whole(paper));
    this.fit(); this.draw(); this.emit();
    return list.length;
  }
  /**
   * 紙を、そこから出たピースごと机から取り除く。
   * @param {number} paperId 紙の id
   */
  remove(paperId) {
    if (!this.papers.some((p) => p.id === paperId)) return;
    this.save();
    this.papers = this.papers.filter((p) => p.id !== paperId);
    this.pieces = this.pieces.filter((p) => p.paper.id !== paperId);
    this.arrange(); this.fit(); this.draw(); this.emit();
  }

  /**
   * ピースを1つ消す。最後のピースが消えた紙は机からも取り除く。
   * @param {number} pieceId ピースの id
   */
  removePiece(pieceId) {
    const p = this.pieces.find((q) => q.id === pieceId);
    if (!p) return;
    this.save();
    this.pieces = this.pieces.filter((q) => q !== p);
    if (!this.pieces.some((q) => q.paper === p.paper)) {
      this.papers = this.papers.filter((paper) => paper !== p.paper);
      this.arrange(); this.fit();
    }
    if (this.overlay.hover === pieceId) this.overlay.hover = null;
    this.draw(); this.emit();
  }

  /**
   * 紙を机の縦横比に合わせて格子状に並べ直し、机の範囲 box を更新する。
   * ピースは元の紙が動いた分だけ一緒に動く。
   */
  arrange() {
    const n = this.papers.length;
    if (!n) { this.box = { x0: 0, y0: 0, x1: 1, y1: 1 }; return; }
    const cellW = Math.max(...this.papers.map((p) => p.W)) * 1.14;
    const cellH = Math.max(...this.papers.map((p) => p.H)) * 1.14;
    const aspect = this.cw && this.ch ? this.cw / this.ch : 1.5;
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * aspect * cellH) / cellW))));
    const rows = Math.ceil(n / cols);
    this.papers.forEach((paper, i) => {
      const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols), off = ((cols - inRow) * cellW) / 2;
      const hx = off + ((i % cols) + 0.5) * cellW - paper.W / 2, hy = (r + 0.5) * cellH - paper.H / 2;
      if (paper.hx !== null) {
        const dx = hx - paper.hx, dy = hy - paper.hy;
        for (const p of this.pieces) if (p.paper === paper) {
          p.tx += dx; p.ty += dy;
          if (p.anim) { p.anim.f[0] += dx; p.anim.f[1] += dy; p.anim.t[0] += dx; p.anim.t[1] += dy; }
        }
      }
      paper.hx = hx; paper.hy = hy;
    });
    this.box = { x0: 0, y0: 0, x1: cols * cellW, y1: rows * cellH };
  }

  /* view */
  /**
   * 表示サイズに合わせてキャンバスの解像度を変え、描き直す。
   * @param {number} w 幅（CSS ピクセル）
   * @param {number} h 高さ（CSS ピクセル）
   */
  measure(w, h) {
    this.cw = w; this.ch = h; this.dpr = Math.min(2, devicePixelRatio || 1);
    this.cv.width = Math.round(w * this.dpr); this.cv.height = Math.round(h * this.dpr);
    this.fit(); this.draw();
  }
  /** 机の範囲 box が画面に収まるよう、表示の倍率と位置（view）を決める。 */
  fit() {
    if (!this.cw || !this.ch) return;
    const m = this.cw < 500 ? 20 : 48, bw = this.box.x1 - this.box.x0, bh = this.box.y1 - this.box.y0;
    const s = Math.max(0.01, Math.min((this.cw - m * 2) / bw, (this.ch - m * 2) / bh));
    this.view = { s, ox: (this.cw - bw * s) / 2 - this.box.x0 * s, oy: (this.ch - bh * s) / 2 - this.box.y0 * s };
  }
  /**
   * 画面の座標（キャンバス左上が原点の CSS ピクセル）を机の座標に変換する。
   * @param {number} x
   * @param {number} y
   * @returns {[number, number]}
   */
  screenToWorld(x, y) { return [(x - this.view.ox) / this.view.s, (y - this.view.oy) / this.view.s]; }
  /**
   * 指定した点にある一番上のピースを返す。
   * @param {number[]} w 机の座標 [x, y]
   * @returns {Piece|null}
   */
  pieceAt(w) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i], l = toLocal(p, w[0], w[1]);
      if (insideLocal(p, l[0], l[1])) return p;
    }
    return null;
  }

  /* tearing */
  /**
   * なぞった線でピースを破る。線が通ったピースをすべて2つに分け、少し離して傾ける。
   * 線が短すぎるときや、分けた片方が小さすぎるときは破らない。
   * @param {number[][]} world なぞった点（机の座標）
   */
  tear(world) {
    let len = 0;
    for (let i = 1; i < world.length; i++) len += Math.hypot(world[i][0] - world[i - 1][0], world[i][1] - world[i - 1][1]);
    if (len * this.view.s < 24) return;
    const snap = this.snapshot(), out = []; let changed = false;
    for (const p of this.pieces) {
      let hit = false;
      for (let i = 0; i < world.length && !hit; i += 2) { const l = toLocal(p, ...world[i]); hit = insideLocal(p, l[0], l[1]); }
      if (!hit) { out.push(p); continue; }
      const cut = buildCut(world.map((q) => toLocal(p, q[0], q[1])), p.paper);
      if (!cut) { out.push(p); continue; }
      const A = [], B = [];
      for (const i of p.idx) (inPoly(p.paper.sx[i], p.paper.sy[i], cut.pos.outer) ? A : B).push(i);
      const min = Math.max(4, p.idx.length * 0.015);
      if (A.length < min || B.length < min) { out.push(p); continue; }
      const a = this.child(p, cut.pos, A), b = this.child(p, cut.neg, B);
      const ca = toWorld(a, a.px, a.py), cb = toWorld(b, b.px, b.py);
      const [ux, uy] = unit(ca[0] - cb[0], ca[1] - cb[1]), gap = 9 / this.view.s;
      const tilt = ((0.6 + Math.random() * 1.8) * Math.PI) / 180;
      this.animate(a, a.tx + ux * gap, a.ty + uy * gap, a.rot + tilt);
      this.animate(b, b.tx - ux * gap, b.ty - uy * gap, b.rot - tilt * 0.7);
      out.push(b, a); changed = true;
    }
    if (changed) {
      this.pieces = out; this.history.push(snap);
      if (this.history.length > 40) this.history.shift();
      this.emit();
    }
  }
  /**
   * 破ったピースの片側から新しいピースを作る。
   * 回転の中心を新しいピースの重心に移し、見た目の位置が変わらないよう平行移動を補正する。
   * @param {Piece} p 元のピース
   * @param {Constraint} con 追加する破り線の制約
   * @param {number[]} idx 新しいピースに含まれるサンプル点の番号
   * @returns {Piece}
   */
  child(p, con, idx) {
    let qx = 0, qy = 0;
    for (const i of idx) { qx += p.paper.sx[i]; qy += p.paper.sy[i]; }
    qx /= idx.length; qy /= idx.length;
    const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = qx - p.px, dy = qy - p.py;
    return mk(p.paper, p.cons.concat([con]), idx, p.rot, p.tx + (c * dx - s * dy) - dx, p.ty + (s * dx + c * dy) - dy, qx, qy);
  }
  /**
   * ピースを目標の位置と角度まで動かす。OS で動きを減らす設定（prefers-reduced-motion）のときはすぐに移す。
   * @param {Piece} p
   * @param {number} tx 目標の平行移動x
   * @param {number} ty 目標の平行移動y
   * @param {number} rot 目標の回転
   */
  animate(p, tx, ty, rot) {
    if (this.reduce) { p.tx = tx; p.ty = ty; p.rot = rot; return; }
    p.anim = { f: [p.tx, p.ty, p.rot], t: [tx, ty, rot], st: performance.now() };
    if (!this.animating) { this.animating = true; requestAnimationFrame((t) => this.tick(t)); }
  }
  /**
   * アニメーションを1フレーム進めて描く。動いているピースがある間は次のフレームを予約する。
   * @param {number} now requestAnimationFrame から渡される時刻
   */
  tick(now) {
    let live = false;
    for (const p of this.pieces) if (p.anim) {
      const k = Math.min(1, (now - p.anim.st) / 380), e = 1 - Math.pow(1 - k, 3), { f, t } = p.anim;
      p.tx = f[0] + (t[0] - f[0]) * e; p.ty = f[1] + (t[1] - f[1]) * e; p.rot = f[2] + (t[2] - f[2]) * e;
      if (k < 1) live = true; else p.anim = null;
    }
    this.draw();
    if (live) requestAnimationFrame((t) => this.tick(t)); else this.animating = false;
  }

  /* drawing */
  /** すべてのピースと、なぞっている途中の線を描く。消すモードで選んだピースは赤く光らせる。 */
  draw() {
    const { ctx, dpr, view } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    ctx.shadowColor = 'rgba(0,0,0,.32)'; ctx.shadowBlur = 12 * dpr; ctx.shadowOffsetY = 4 * dpr;
    const hover = this.overlay.hover, danger = css('--danger') || '#d23b2a';
    for (const p of this.pieces) {
      ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.ox, dpr * view.oy);
      if (p.id === hover) { ctx.shadowColor = danger; ctx.shadowBlur = 18 * dpr; ctx.shadowOffsetY = 0; }
      drawPiece(ctx, p);
      if (p.id === hover) { ctx.shadowColor = 'rgba(0,0,0,.32)'; ctx.shadowBlur = 12 * dpr; ctx.shadowOffsetY = 4 * dpr; }
    }
    ctx.shadowColor = 'transparent';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const st = this.overlay.stroke;
    if (st && st.length > 1) {
      ctx.beginPath();
      st.forEach((q, i) => { const x = q[0] * view.s + view.ox, y = q[1] * view.s + view.oy; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = css('--stroke') || '#e8571f'; ctx.lineWidth = 2.5; ctx.setLineDash([3, 5]); ctx.lineCap = 'round';
      ctx.stroke(); ctx.setLineDash([]);
    }
  }
}
