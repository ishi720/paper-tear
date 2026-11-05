// Saving files with a proper name.
// Inside a claude.ai artifact the page cannot start downloads itself, so it asks the viewer
// through the `downloads` capability. Anywhere else (npm run dev, your own site) a normal
// <a download> link is used.

let cap;
/**
 * claude.ai の downloads 機能を取得する。結果は1回目の呼び出しで決まり、以降は使い回す。
 * @returns {Promise<{save: (opts: {filename: string, data: Blob}) => Promise<void>}|null>} 使えない環境では null
 */
function downloads() {
  if (cap === undefined) cap = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  return cap;
}

/**
 * ファイルを保存する。downloads 機能があればそれを使い、なければ <a download> でダウンロードする。
 * @param {string} filename ファイル名
 * @param {Blob} blob 中身
 * @returns {Promise<boolean>} 保存したら true、見る人が断ったら false。それ以外の失敗は例外を投げる
 */
export async function saveFile(filename, blob) {
  const d = await downloads();
  if (d) {
    try {
      await d.save({ filename, data: blob });
      return true;
    } catch (e) {
      if (e?.code === 'declined') return false;
      throw e;
    }
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/* ---------- a minimal ZIP writer (stored, no compression: PNGs are already compressed) ---------- */

/** CRC-32 の計算表 */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
/**
 * ZIP に書き込む CRC-32 を計算する。
 * @param {Uint8Array} buf
 * @returns {number}
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * 無圧縮の ZIP を作る。ファイル名は UTF-8 で書き込む。
 * @param {{name: string, blob: Blob}[]} files
 * @returns {Promise<Blob>} application/zip の Blob
 */
export async function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let offset = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(local, name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, time, true); cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
