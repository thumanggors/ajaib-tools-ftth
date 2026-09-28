/* AJAIB TOOLS: halaman "OTDR Report" dengan tata letak laporan NOVKER NK6000 (posisi, ukuran, dan warna diukur
   dari PDF acuan dalam satuan pt). fields() dipakai juga oleh tampilan editor; page() menggambar ke jsPDF. */
(function (root) {
  'use strict';
  const NA = '- - -';
  const num = (v, d = 3) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d).replace('.', ','));
  const tick = (v) => String(+v.toFixed(3)).replace('.', ',');
  const pad = (n) => String(n).padStart(2, '0');
  const date = (sec) => {
    if (!sec) return '';
    const t = new Date(sec * 1000);
    return `${pad(t.getDate())}/${pad(t.getMonth() + 1)}/${t.getFullYear()} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  };
  // Aturan sumbu pada laporan acuan: langkah km = 10^floor(log10(range)), dibagi dua kalau kurang dari 4 garis;
  // rentang dB = rentang trace × 1,05 dibulatkan ke atas kelipatan 5.
  const kmStep = (km) => { let s = 10 ** Math.floor(Math.log10(km)); if (km / s < 4) s /= 2; return s; };
  const yMax = (span) => Math.max(5, Math.ceil((span * 1.05) / 5) * 5);
  const dbStep = (range) => (range >= 20 ? 10 : range >= 10 ? 5 : range >= 4 ? 2 : 1);
  const isEnd = (e) => e.code[1] === 'E' || e.code[1] === 'D';
  const isBegin = (s, i) => i === 0 && SOR.eventM(s, 0) < 1;
  function traceRange(s) {
    let mn = Infinity, mx = -Infinity;
    for (const v of s.trace) { if (v < mn) mn = v; if (v > mx) mx = v; }
    return { mn, mx };
  }

  function fields(s, kop = {}) {
    const g = s.gen || {}, u = s.sup || {}, f = s.fxd, sum = SOR.summary(s);
    const km = sum.length / 1000, rangeKm = ((s.trace.length - 1) * s.dx) / 1000;
    return {
      params: [
        [`Begin: ${g.locA || ''}`, `End: ${g.locB || ''}`],
        [`Cable: ${g.cableId || ''}`, `Fiber: ${g.fiberId || ''}`],
        [`Range: ${num(rangeKm)} km`, `Pulse Width: ${s.pw} ns`],
        [`Wavelength: ${g.wavelength || Math.round(f.wavelength)} nm (${g.fiberType === 651 ? 'Multimode' : 'Singlemode'})`, `Refractive index: ${num(s.ior, 5)}`],
        [`Loss Threshold: ${num(f.lossThr)} dB`, `Refl. Threshold: ${num(f.reflThr)} dB`],
        [`Date: ${date(f.date)}`, `File: ${s.name}`],
        [`OTDR: ${u.model || ''} S/N: ${(u.serial || '').trim()}`, ''],
        [`Module: ${u.module || ''} S/N: ${(u.moduleSerial || '').trim()}`, ''],
        [`Customer: ${kop.customer || ''}`, `Job Name: ${kop.job || ''}`],
        [`Supplier: ${u.supplier || ''}`, ''],
        [`Comment: ${g.comment || ''}`, ''],
      ],
      summary: [
        [`Fiber Lenght: ${num(km)} km`, `Total Loss: ${num(sum.loss)} dB`], // ejaan "Lenght" mengikuti laporan acuan
        [`Attenuation: ${num(km > 0 ? sum.loss / km : 0)} dB/km`, ''],
      ],
      events: s.events.map((e, i) => {
        const begin = isBegin(s, i), end = isEnd(e);
        const type = begin ? 'Begin' : end ? 'End' : e.code[0] === '0' ? 'Loss' : 'Reflection';
        return [String(e.num), type, num(SOR.eventM(s, i) / 1000), begin || end ? NA : num(e.loss / 1000), e.refl ? num(SOR.reflDb(e)) : NA, begin ? NA : num(e.attn / 1000)];
      }),
    };
  }

  // Font Segoe UI diambil dari Windows pengguna lewat Local Font Access (tidak disertakan di aplikasi).
  let fontCache;
  const b64 = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  async function loadFonts() {
    if (fontCache !== undefined) return fontCache;
    try {
      const list = await window.queryLocalFonts({ postscriptNames: ['SegoeUI', 'SegoeUI-Bold'] });
      const get = async (ps) => { const x = list.find((f) => f.postscriptName === ps); return x ? b64(await (await x.blob()).arrayBuffer()) : null; };
      const normal = await get('SegoeUI'), bold = await get('SegoeUI-Bold');
      fontCache = normal && bold ? { normal, bold } : null;
    } catch {
      fontCache = null;
    }
    return fontCache;
  }
  function useFonts(doc, fonts) {
    if (!fonts) return 'helvetica';
    doc.addFileToVFS('segoeui.ttf', fonts.normal); doc.addFont('segoeui.ttf', 'SegoeUI', 'normal');
    doc.addFileToVFS('segoeuib.ttf', fonts.bold); doc.addFont('segoeuib.ttf', 'SegoeUI', 'bold');
    return 'SegoeUI';
  }

  // Geometri halaman A4 (pt) hasil pengukuran PDF acuan.
  const L = 29.76, R = 565.58, CX = 297.6, COL2 = 297.6;
  const G = { axis: 58.65, x0: 59.28, right: 565.56, top: 275.52, base: 524.16 };

  function section(doc, title, y, w) {
    const tw = doc.getTextWidth(title);
    doc.setDrawColor(0).setLineWidth(w).setLineDashPattern([], 0);
    doc.line(L, y, CX - tw / 2 - 6.55, y);
    doc.line(CX + tw / 2 + 6.55, y, R, y);
    doc.text(title, CX, y + 2.4, { align: 'center' });
  }

  function trace(doc, s, font) {
    const tr = s.trace, { mn, mx } = traceRange(s), km = ((tr.length - 1) * s.dx) / 1000, ym = yMax(mx - mn);
    const X = (k) => G.x0 + (k / km) * (G.right - G.x0);
    const Y = (db) => G.base - (Math.max(0, Math.min(ym, db)) / ym) * (G.base - G.top);
    const solid = () => doc.setLineDashPattern([], 0);
    doc.setFont(font, 'normal').setFontSize(9).setTextColor(0);

    doc.setDrawColor(0).setLineWidth(0.6); solid();
    doc.line(G.axis, G.top, G.axis, G.base);
    doc.line(G.axis, G.base, G.right, G.base);

    const st = kmStep(km);
    for (let i = 0, k = 0; k <= km + 1e-9; k = ++i * st) {
      const x = X(k);
      if (i) { doc.setDrawColor(192); doc.setLineDashPattern([1.2, 1.2], 0); doc.line(x, G.top, x, G.base); }
      doc.setDrawColor(0); solid(); doc.line(x, G.base + 0.6, x, G.base + 6);
      doc.text(tick(k), x, 539.88, { align: 'center' });
    }
    const sd = dbStep(ym);
    for (let d = sd; d < ym + 1e-9; d += sd) {
      const y = Y(d);
      doc.setDrawColor(192); doc.setLineDashPattern([1.2, 1.2], 0); doc.line(G.x0, y, G.right, y);
      doc.setDrawColor(0); solid(); doc.line(G.axis, y, G.axis - 6, y);
      doc.text(num(d, 2), 51.6, y + 3.69, { align: 'right' });
    }
    doc.text('dB', 51.02, 288.24, { align: 'right' });
    doc.text('km', 550.32, 537.48);

    // Trace vektor dengan pola titik laporan acuan (dicetak 600 dpi, koordinat dibulatkan ke 0,12 pt): semua sampel dari awal
    // sampai 2 sampel sebelum sampel pertama setelah event terakhir yang < 1,5 dB di atas noise floor, lalu satu sampel
    // tiap ~0,84 pt (setiap sampel ke-27 untuk 16.384 titik) di area noise.
    const n = tr.length, q = (v) => Math.round(v / 0.12) * 0.12, xi = (i) => X((i * s.dx) / 1000);
    const endIdx = s.events.length ? SOR.mToIdx(s, SOR.eventM(s, s.events.length - 1)) : 0;
    let sw = n - 1;
    for (let i = endIdx + 1; i < n; i++) if (tr[i] - mn < 1.5) { sw = Math.max(endIdx, i - 2); break; }
    const stride = Math.max(1, Math.round(0.84 / ((G.right - G.x0) / (n - 1))));
    const pts = [];
    const add = (x, y) => { const p = pts[pts.length - 1]; if (!p || p[0] !== x || p[1] !== y) pts.push([x, y]); };
    for (let i = 0; i < n; i = i < sw ? i + 1 : i + stride) add(q(xi(i)), q(Y(tr[i] - mn)));
    doc.setDrawColor(0).setLineWidth(0.6); solid();
    doc.lines(pts.slice(1).map((p, k) => [p[0] - pts[k][0], p[1] - pts[k][1]]), pts[0][0], pts[0][1], [1, 1], 'S', false);

    // Penanda event merah (dipotong ke area plot): garis 24 pt di level trace, panah kanan di kedua ujung Begin,
    // panah kiri di kedua ujung End.
    doc.saveGraphicsState();
    doc.rect(G.axis, G.top, G.right - G.axis, G.base - G.top, null); doc.clip(); doc.discardPath();
    doc.setDrawColor(255, 0, 0).setFillColor(255, 0, 0).setLineWidth(0.6);
    s.events.forEach((e, i) => {
      const m = SOR.eventM(s, i), x = X(m / 1000), yc = Y(tr[SOR.mToIdx(s, m)] - mn);
      doc.line(x, yc - 12, x, yc + 12);
      const dir = isBegin(s, i) ? 1 : isEnd(e) ? -1 : 0;
      if (dir) for (const y of [yc - 12, yc + 12]) { doc.line(x, y, x + 3.75 * dir, y); doc.triangle(x + 3.75 * dir, y - 3, x + 6.75 * dir, y, x + 3.75 * dir, y + 3, 'FD'); }
    });
    doc.restoreGraphicsState();
  }

  function page(doc, s, kop, font) {
    const F = fields(s, kop);
    doc.setTextColor(0).setLineCap('round').setLineJoin('round'); // acuan memakai ujung dan sambungan garis bulat
    doc.setFont(font, 'bold').setFontSize(11.04).text('OTDR Report', CX, 41.64, { align: 'center' });
    doc.setFont(font, 'normal').setFontSize(9.96);
    const rows = (list, y0) => list.forEach(([a, b], i) => { const y = y0 + 13.2 * i; if (a) doc.text(a, L, y); if (b) doc.text(b, COL2, y); });
    section(doc, 'Parameters', 59.4, 0.375);
    rows(F.params, 75);
    section(doc, 'Summary', 224.4, 0.375);
    rows(F.summary, 240);
    section(doc, 'Trace', 270.6, 0.375);
    trace(doc, s, font);

    doc.setFont(font, 'normal').setFontSize(9.96).setTextColor(0);
    section(doc, 'Event Table', 558.23, 0.6);
    const hx = [29.76, 49.24, 136.92, 244.08, 351.24, 458.4], cx = [29.76, 43.44, 136.92, 244.08, 351.24, 458.4];
    const header = (y) => {
      [font === 'helvetica' ? 'No' : '№', 'Type', 'Distance, km', 'Loss, dB', 'Reflection, dB', 'Attenuation, dB/km'].forEach((t, i) => doc.text(t, hx[i], y));
      doc.setDrawColor(0).setLineWidth(0.6).line(L, y + 6.51, R, y + 6.51);
    };
    let y = 573.84;
    header(y);
    y += 19.8;
    for (const row of F.events) {
      if (y > 822) { doc.addPage(); doc.setFont(font, 'normal').setFontSize(9.96); y = 41.64; header(y); y += 19.8; }
      row.forEach((t, i) => doc.text(t, cx[i], y));
      doc.line(L, y + 6.51, R, y + 6.51);
      y += 19.8;
    }
  }

  root.Report = { fields, page, loadFonts, useFonts, kmStep, yMax, dbStep, traceRange, num, tick };
})(this);
