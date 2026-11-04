// Turns pieces on the desk into PNG images.
// unit: 'piece' (one image per piece) | 'photo' (one per source photo) | 'desk' (one image of everything)
import { drawPiece, pieceBounds } from './desk.js';

const MAX_SIDE = 4096;

function union(list, margin) {
  const b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
  for (const p of list) {
    const q = pieceBounds(p);
    b.x0 = Math.min(b.x0, q.x0); b.y0 = Math.min(b.y0, q.y0); b.x1 = Math.max(b.x1, q.x1); b.y1 = Math.max(b.y1, q.y1);
  }
  return { x0: b.x0 - margin, y0: b.y0 - margin, x1: b.x1 + margin, y1: b.y1 + margin };
}

/** "papertear_20261104-1130" — shared prefix so one export's files sort together. */
function stamp() {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  return `papertear_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}

/** What would be written out, without rendering anything. */
export function planExport(desk, unit) {
  const list = desk.pieces.slice();
  if (!list.length) return [];
  const pre = stamp();
  if (unit === 'piece') {
    const w = String(list.length).length < 2 ? 2 : String(list.length).length;
    return list.map((p, i) => ({ name: `${pre}_piece-${String(i + 1).padStart(w, '0')}.png`, pieces: [p], bounds: pieceBounds(p) }));
  }
  if (unit === 'photo') {
    return desk.photos
      .map((ph, i) => ({ i, pieces: list.filter((p) => p.ph === ph) }))
      .filter((g) => g.pieces.length)
      .map((g) => ({ name: `${pre}_photo-${g.i + 1}.png`, pieces: g.pieces, bounds: union(g.pieces, 16) }));
  }
  return [{ name: `${pre}_desk.png`, pieces: list, bounds: union(list, 24) }];
}

function render(job, background) {
  const { x0, y0, x1, y1 } = job.bounds, w = x1 - x0, h = y1 - y0;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d');
  if (background) { g.fillStyle = background; g.fillRect(0, 0, c.width, c.height); }
  g.scale(k, k); g.translate(-x0, -y0);
  for (const p of job.pieces) drawPiece(g, p);
  return new Promise((res) => c.toBlob((blob) => res({ name: job.name, blob, url: URL.createObjectURL(blob), w: c.width, h: c.height }), 'image/png'));
}

export function exportImages(desk, { unit, background }) {
  const desktop = getComputedStyle(document.documentElement).getPropertyValue('--desk').trim();
  const bg = background === 'desk' ? desktop : background === 'white' ? '#ffffff' : null;
  return Promise.all(planExport(desk, unit).map((job) => render(job, bg)));
}
