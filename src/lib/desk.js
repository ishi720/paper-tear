// Tearing engine: photos, pieces, the tear algorithm and the canvas renderer.
// A piece is never stored as a polygon. It is the source photo plus a list of
// "side of a tear line" constraints, drawn by stacking canvas clip() calls.

const G = 52;                // sample grid per photo (G x G points)
const PAPER = '#fbf9f3';     // photo paper colour (white border and torn core)
const MAXS = 1100;           // longest side a photo is scaled down to
export const MAX_PHOTOS = 12;

let uid = 0;

/* ---------- source images ---------- */

/** Scale an image down and optionally give it a white print border. */
export function framedCanvas(src, border) {
  const k = Math.min(1, MAXS / Math.max(src.width, src.height));
  const w = Math.round(src.width * k), h = Math.round(src.height * k);
  const b = border ? Math.round(Math.min(w, h) * 0.04) : 0;
  const c = document.createElement('canvas');
  c.width = w + b * 2; c.height = h + b * 2;
  const g = c.getContext('2d');
  g.fillStyle = PAPER; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, b, b, w, h);
  if (b) { g.strokeStyle = '#0000000f'; g.strokeRect(b + 0.5, b + 0.5, w - 1, h - 1); }
  return c;
}

export function loadFile(file, border) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(framedCanvas(im, border)); };
    im.onerror = () => { URL.revokeObjectURL(url); res(null); };
    im.src = url;
  });
}

function makePhoto(c) {
  const W = c.width, H = c.height, sx = new Float32Array(G * G), sy = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    sx[j * G + i] = ((i + 0.5) * W) / G; sy[j * G + i] = ((j + 0.5) * H) / G;
  }
  const th = 96, tw = Math.round((W * th) / H), t = document.createElement('canvas');
  t.width = tw; t.height = th; t.getContext('2d').drawImage(c, 0, 0, tw, th);
  return { id: ++uid, img: c, W, H, sx, sy, hx: null, hy: null, rot0: 0, thumb: t.toDataURL('image/jpeg', 0.8) };
}

function mk(ph, cons, idx, rot, tx, ty, px, py) {
  return { id: ++uid, ph, cons, idx, rot, tx, ty, px, py, cache: null, bx: 0, by: 0, anim: null };
}
function whole(ph) {
  const all = []; for (let i = 0; i < G * G; i++) all.push(i);
  return mk(ph, [], all, ph.rot0, ph.hx, ph.hy, ph.W / 2, ph.H / 2);
}

/* ---------- geometry ---------- */

function inPoly(x, y, p) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const yi = p[i + 1], yj = p[j + 1];
    if (yi > y !== yj > y && x < ((p[j] - p[i]) * (y - yi)) / (yj - yi) + p[i]) c = !c;
  }
  return c;
}
function insideLocal(p, x, y) {
  if (x < 0 || y < 0 || x > p.ph.W || y > p.ph.H) return false;
  for (const c of p.cons) if (!inPoly(x, y, c.paper)) return false;
  return true;
}
function toLocal(p, wx, wy) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = wx - p.px - p.tx, dy = wy - p.py - p.ty;
  return [c * dx + s * dy + p.px, -s * dx + c * dy + p.py];
}
export function toWorld(p, lx, ly) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = lx - p.px, dy = ly - p.py;
  return [c * dx - s * dy + p.px + p.tx, s * dx + c * dy + p.py + p.ty];
}
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
function smooth(p, n) {
  for (let k = 0; k < n; k++)
    p = p.map((q, i) => (i === 0 || i === p.length - 1 ? q
      : [(p[i - 1][0] + q[0] * 2 + p[i + 1][0]) / 4, (p[i - 1][1] + q[1] * 2 + p[i + 1][1]) / 4]));
  return p;
}
function unit(x, y) { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }

/** Turn a stroke (in the piece's local coords) into two half-plane-like regions with a ragged edge. */
function buildCut(local, ph) {
  let p = smooth(resample(local, 10), 3);
  if (p.length < 2) return null;
  const ext = Math.hypot(ph.W, ph.H) * 2, k = Math.min(3, p.length - 1);
  const ts = unit(p[0][0] - p[k][0], p[0][1] - p[k][1]);
  const te = unit(p[p.length - 1][0] - p[p.length - 1 - k][0], p[p.length - 1][1] - p[p.length - 1 - k][1]);
  p = [[p[0][0] + ts[0] * ext, p[0][1] + ts[1] * ext], ...p,
       [p[p.length - 1][0] + te[0] * ext, p[p.length - 1][1] + te[1] * ext]];
  const base = resample(p, 5), n = base.length, r = Math.random;
  const paper = [], photo = [], sgn = r() < 0.5 ? 1 : -1;
  let walk = 0, wv = 0, mid = null;
  for (let i = 0; i < n; i++) {
    const a = base[Math.max(0, i - 1)], b = base[Math.min(n - 1, i + 1)];
    const [nx, ny] = unit(-(b[1] - a[1]), b[0] - a[0]);
    if (i === n >> 1) mid = [nx, ny];
    walk += (r() - 0.5) * 3.2; walk *= 0.9;
    wv += (r() - 0.5) * 1.6; wv *= 0.85;
    const off = walk + (r() - 0.5) * 2.6, w = 2 + Math.abs(wv) * 3 + r() * 1.5;
    paper.push(base[i][0] + nx * off, base[i][1] + ny * off);
    photo.push(base[i][0] + nx * (off + sgn * w), base[i][1] + ny * (off + sgn * w));
  }
  const cx = local[local.length >> 1][0], cy = local[local.length >> 1][1], R = 1e5;
  const aS = Math.atan2(base[0][1] - cy, base[0][0] - cx), aE = Math.atan2(base[n - 1][1] - cy, base[n - 1][0] - cx);
  const d1 = (((aS - aE) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), d2 = d1 - 2 * Math.PI;
  const arc = (d) => { const a = []; for (let i = 0; i <= 24; i++) { const t = aE + (d * i) / 24; a.push(cx + Math.cos(t) * R, cy + Math.sin(t) * R); } return a; };
  const m1 = aE + d1 / 2, pos = Math.cos(m1) * mid[0] + Math.sin(m1) * mid[1] > 0;
  const arcPos = arc(pos ? d1 : d2), arcNeg = arc(pos ? d2 : d1);
  const P = paper.concat(arcPos), N = paper.concat(arcNeg), core = photo.concat(sgn > 0 ? arcPos : arcNeg);
  return { pos: { paper: P, photo: sgn > 0 ? core : P }, neg: { paper: N, photo: sgn < 0 ? core : N } };
}

/* ---------- piece rendering ---------- */

function bake(p) {
  const { W, H, sx, sy, img } = p.ph;
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
  for (const k of p.cons) { path(k.paper); g.clip(); }
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  g.save();
  for (const k of p.cons) if (k.photo !== k.paper) { path(k.photo); g.clip(); }
  g.drawImage(img, 0, 0); g.restore();
  g.lineWidth = 1.2; g.strokeStyle = 'rgba(110,96,70,.28)';
  for (const k of p.cons) if (k.photo !== k.paper) { path(k.photo); g.stroke(); }
  g.lineWidth = 1.4; g.strokeStyle = 'rgba(0,0,0,.14)';
  for (const k of p.cons) { path(k.paper); g.stroke(); }
  p.cache = c; p.bx = x0; p.by = y0;
}

/** Draw one piece into a context whose transform is already in world units. */
export function drawPiece(ctx, p) {
  if (!p.cache) bake(p);
  ctx.save();
  ctx.translate(p.px + p.tx, p.py + p.ty); ctx.rotate(p.rot); ctx.translate(-p.px, -p.py);
  ctx.drawImage(p.cache, p.bx, p.by);
  ctx.restore();
}
export function pieceBounds(p) {
  const { sx, sy, W, H } = p.ph, pad = (Math.max(W, H) / G) * 0.8 + 4;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const i of p.idx) {
    const [x, y] = toWorld(p, sx[i], sy[i]);
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/* ---------- the desk ---------- */

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Desk {
  constructor(canvas, onChange) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.onChange = onChange;
    this.photos = []; this.pieces = []; this.history = [];
    this.view = { s: 1, ox: 0, oy: 0 }; this.box = { x0: 0, y0: 0, x1: 1, y1: 1 };
    this.cw = 0; this.ch = 0; this.dpr = 1; this.animating = false;
    this.overlay = { stroke: null, hover: null };
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  emit() { this.onChange && this.onChange(); }

  /* history: every undoable change saves the photo list, home positions and pieces */
  snapshot() {
    return {
      photos: this.photos.slice(), homes: this.photos.map((p) => [p.hx, p.hy]),
      pieces: this.pieces.map((p) => ({ ...p, anim: null })), box: { ...this.box },
    };
  }
  save() { this.history.push(this.snapshot()); if (this.history.length > 40) this.history.shift(); }
  get canUndo() { return this.history.length > 0; }
  undo() {
    const s = this.history.pop(); if (!s) return;
    this.photos = s.photos; s.photos.forEach((p, i) => { p.hx = s.homes[i][0]; p.hy = s.homes[i][1]; });
    this.pieces = s.pieces; this.box = s.box;
    this.fit(); this.draw(); this.emit();
  }

  /** Add photos (canvases). Returns how many were added. */
  add(canvases, { record = true } = {}) {
    const list = canvases.slice(0, MAX_PHOTOS - this.photos.length);
    if (!list.length) return 0;
    if (record) this.save();
    for (const c of list) {
      const ph = makePhoto(c);
      ph.rot0 = this.photos.length ? (Math.random() - 0.5) * 0.06 : 0;
      this.photos.push(ph);
    }
    this.arrange();
    for (const ph of this.photos) if (!this.pieces.some((p) => p.ph === ph)) this.pieces.push(whole(ph));
    this.fit(); this.draw(); this.emit();
    return list.length;
  }
  remove(photoId) {
    if (!this.photos.some((p) => p.id === photoId)) return;
    this.save();
    this.photos = this.photos.filter((p) => p.id !== photoId);
    this.pieces = this.pieces.filter((p) => p.ph.id !== photoId);
    this.arrange(); this.fit(); this.draw(); this.emit();
  }

  /** Remove one piece. A photo whose last piece is removed leaves the desk too. */
  removePiece(pieceId) {
    const p = this.pieces.find((q) => q.id === pieceId);
    if (!p) return;
    this.save();
    this.pieces = this.pieces.filter((q) => q !== p);
    if (!this.pieces.some((q) => q.ph === p.ph)) {
      this.photos = this.photos.filter((ph) => ph !== p.ph);
      this.arrange(); this.fit();
    }
    if (this.overlay.hover === pieceId) this.overlay.hover = null;
    this.draw(); this.emit();
  }

  /** Lay photos out on a grid; pieces move along with their photo. */
  arrange() {
    const n = this.photos.length;
    if (!n) { this.box = { x0: 0, y0: 0, x1: 1, y1: 1 }; return; }
    const cellW = Math.max(...this.photos.map((p) => p.W)) * 1.14;
    const cellH = Math.max(...this.photos.map((p) => p.H)) * 1.14;
    const aspect = this.cw && this.ch ? this.cw / this.ch : 1.5;
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * aspect * cellH) / cellW))));
    const rows = Math.ceil(n / cols);
    this.photos.forEach((ph, i) => {
      const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols), off = ((cols - inRow) * cellW) / 2;
      const hx = off + ((i % cols) + 0.5) * cellW - ph.W / 2, hy = (r + 0.5) * cellH - ph.H / 2;
      if (ph.hx !== null) {
        const dx = hx - ph.hx, dy = hy - ph.hy;
        for (const p of this.pieces) if (p.ph === ph) {
          p.tx += dx; p.ty += dy;
          if (p.anim) { p.anim.f[0] += dx; p.anim.f[1] += dy; p.anim.t[0] += dx; p.anim.t[1] += dy; }
        }
      }
      ph.hx = hx; ph.hy = hy;
    });
    this.box = { x0: 0, y0: 0, x1: cols * cellW, y1: rows * cellH };
  }

  /* view */
  measure(w, h) {
    this.cw = w; this.ch = h; this.dpr = Math.min(2, devicePixelRatio || 1);
    this.cv.width = Math.round(w * this.dpr); this.cv.height = Math.round(h * this.dpr);
    this.fit(); this.draw();
  }
  fit() {
    if (!this.cw || !this.ch) return;
    const m = this.cw < 500 ? 20 : 48, bw = this.box.x1 - this.box.x0, bh = this.box.y1 - this.box.y0;
    const s = Math.max(0.01, Math.min((this.cw - m * 2) / bw, (this.ch - m * 2) / bh));
    this.view = { s, ox: (this.cw - bw * s) / 2 - this.box.x0 * s, oy: (this.ch - bh * s) / 2 - this.box.y0 * s };
  }
  screenToWorld(x, y) { return [(x - this.view.ox) / this.view.s, (y - this.view.oy) / this.view.s]; }
  pieceAt(w) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i], l = toLocal(p, w[0], w[1]);
      if (insideLocal(p, l[0], l[1])) return p;
    }
    return null;
  }

  /* tearing */
  tear(world) {
    let len = 0;
    for (let i = 1; i < world.length; i++) len += Math.hypot(world[i][0] - world[i - 1][0], world[i][1] - world[i - 1][1]);
    if (len * this.view.s < 24) return;
    const snap = this.snapshot(), out = []; let changed = false;
    for (const p of this.pieces) {
      let hit = false;
      for (let i = 0; i < world.length && !hit; i += 2) { const l = toLocal(p, ...world[i]); hit = insideLocal(p, l[0], l[1]); }
      if (!hit) { out.push(p); continue; }
      const cut = buildCut(world.map((q) => toLocal(p, q[0], q[1])), p.ph);
      if (!cut) { out.push(p); continue; }
      const A = [], B = [];
      for (const i of p.idx) (inPoly(p.ph.sx[i], p.ph.sy[i], cut.pos.paper) ? A : B).push(i);
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
  child(p, con, idx) {
    let qx = 0, qy = 0;
    for (const i of idx) { qx += p.ph.sx[i]; qy += p.ph.sy[i]; }
    qx /= idx.length; qy /= idx.length;
    const c = Math.cos(p.rot), s = Math.sin(p.rot), dx = qx - p.px, dy = qy - p.py;
    return mk(p.ph, p.cons.concat([con]), idx, p.rot, p.tx + (c * dx - s * dy) - dx, p.ty + (s * dx + c * dy) - dy, qx, qy);
  }
  animate(p, tx, ty, rot) {
    if (this.reduce) { p.tx = tx; p.ty = ty; p.rot = rot; return; }
    p.anim = { f: [p.tx, p.ty, p.rot], t: [tx, ty, rot], st: performance.now() };
    if (!this.animating) { this.animating = true; requestAnimationFrame((t) => this.tick(t)); }
  }
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
