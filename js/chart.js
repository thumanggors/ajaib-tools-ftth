/* AJAIB TOOLS: grafik trace interaktif di editor, bergaya "OTDR Report" NOVKER (latar putih, trace hitam, grid abu-abu
   putus-putus, dB relatif terhadap noise floor, penanda event merah). Versi PDF-nya ada di report.js. */
(function (root) {
  'use strict';
  const PAD = { l: 56, r: 14, t: 14, b: 30 };
  const C = { trace: '#000', axis: '#000', grid: 'rgb(192,192,192)', text: '#000', event: '#f00', cursor: '#0a7d36', fit: '#777' };

  const base = (sor) => (sor._base ??= Report.traceRange(sor).mn);
  function fitY(sor, v) {
    const tr = sor.trace, i0 = Math.max(0, Math.floor(v.x0 / sor.dx)), i1 = Math.min(tr.length - 1, Math.ceil(v.x1 / sor.dx));
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) { if (tr[i] < lo) lo = tr[i]; if (tr[i] > hi) hi = tr[i]; }
    const pad = Math.max(0.2, (hi - lo) * 0.08);
    return { x0: v.x0, x1: v.x1, y0: lo - pad, y1: hi + pad };
  }
  // Tampilan penuh sama dengan laporan: 0 dB di noise floor sampai rentang × 1,05 (kelipatan 5 dB).
  function fullView(sor) {
    const { mn, mx } = Report.traceRange(sor);
    return { x0: 0, x1: (sor.trace.length - 1) * sor.dx, y0: mn, y1: mn + Report.yMax(mx - mn) };
  }

  function scales(w, h, v) {
    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
    return {
      pw, ph,
      X: (m) => PAD.l + ((m - v.x0) / (v.x1 - v.x0)) * pw,
      Y: (db) => PAD.t + ((v.y1 - db) / (v.y1 - v.y0)) * ph,
      M: (px) => v.x0 + ((px - PAD.l) / pw) * (v.x1 - v.x0),
    };
  }

  // o: { selected, cursor, ghost, ab: [m, m], progress: 0..1, fit: hasil SOR.measureEvent }
  function draw(ctx, w, h, sor, v, o) {
    const S = scales(w, h, v), tr = sor.trace, dx = sor.dx, b0 = base(sor);
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.font = '12px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = C.text;

    // grid putus-putus dan label sumbu (km dan dB relatif)
    const km0 = v.x0 / 1000, km1 = v.x1 / 1000, sk = Report.kmStep(Math.max(1e-3, km1 - km0));
    const sd = Report.dbStep(v.y1 - v.y0), left = PAD.l, bottom = h - PAD.b;
    ctx.lineWidth = 0.8;
    ctx.textAlign = 'center';
    for (let k = Math.ceil(km0 / sk - 1e-9) * sk; k <= km1 + 1e-9; k += sk) {
      const x = Math.round(S.X(k * 1000)) + 0.5;
      if (x > left + 1) { ctx.strokeStyle = C.grid; ctx.setLineDash([1.6, 1.6]); ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, bottom); ctx.stroke(); }
      ctx.setLineDash([]); ctx.strokeStyle = C.axis; ctx.beginPath(); ctx.moveTo(x, bottom + 1); ctx.lineTo(x, bottom + 8); ctx.stroke();
      ctx.fillText(Report.tick(k), x, h - 8);
    }
    ctx.textAlign = 'right';
    for (let d = Math.ceil((v.y0 - b0) / sd) * sd; d <= v.y1 - b0 + 1e-9; d += sd) {
      if (d <= 0) continue;
      const y = Math.round(S.Y(b0 + d)) + 0.5;
      ctx.strokeStyle = C.grid; ctx.setLineDash([1.6, 1.6]); ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
      ctx.setLineDash([]); ctx.strokeStyle = C.axis; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left - 8, y); ctx.stroke();
      ctx.fillText(Report.num(d, 2), left - 10, y + 4);
    }
    ctx.fillText('dB', left - 10, PAD.t + 12);
    ctx.textAlign = 'left';
    ctx.fillText('km', w - PAD.r - 18, bottom - 4);
    ctx.strokeStyle = C.axis;
    ctx.beginPath(); ctx.moveTo(left, PAD.t); ctx.lineTo(left, bottom); ctx.lineTo(w - PAD.r, bottom); ctx.stroke();

    // area plot, dipotong sesuai progress animasi
    ctx.beginPath();
    ctx.rect(left, PAD.t, S.pw * (o.progress ?? 1), S.ph);
    ctx.clip();

    // trace: kalau titik lebih rapat dari 2 per piksel, gambar min/max per kolom piksel
    const i0 = Math.max(0, Math.floor(v.x0 / dx)), i1 = Math.min(tr.length - 1, Math.ceil(v.x1 / dx)), per = (i1 - i0) / S.pw;
    ctx.strokeStyle = C.trace;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (per <= 2) {
      for (let i = i0; i <= i1; i++) ctx[i === i0 ? 'moveTo' : 'lineTo'](S.X(i * dx), S.Y(tr[i]));
    } else {
      for (let px = 0; px < S.pw; px++) {
        const a = i0 + Math.floor(px * per), b = Math.min(i1, i0 + Math.floor((px + 1) * per));
        let lo = Infinity, hi = -Infinity;
        for (let i = a; i <= b; i++) { if (tr[i] < lo) lo = tr[i]; if (tr[i] > hi) hi = tr[i]; }
        ctx[px ? 'lineTo' : 'moveTo'](left + px, S.Y(hi));
        ctx.lineTo(left + px, S.Y(lo));
      }
    }
    ctx.stroke();

    // garis regresi LSA untuk event terpilih
    if (o.fit) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = C.fit;
      ctx.beginPath();
      const seg = (f, from, to) => { ctx.moveTo(S.X(from * dx), S.Y(f.icpt + f.slope * (from - f.a))); ctx.lineTo(S.X(to * dx), S.Y(f.icpt + f.slope * (to - f.a))); };
      if (o.fit.before) seg(o.fit.before, o.fit.before.a, o.fit.e);
      if (o.fit.after) seg(o.fit.after, o.fit.e, o.fit.after.b);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // penanda event seperti laporan: garis merah di level trace, panah kanan (Begin) dan panah kiri (End) di kedua ujung
    ctx.strokeStyle = ctx.fillStyle = C.event;
    sor.events.forEach((e, i) => {
      const m = SOR.eventM(sor, i), x = Math.round(S.X(m)) + 0.5, yc = S.Y(tr[SOR.mToIdx(sor, m)]), on = i === o.selected;
      if (on) { ctx.globalAlpha = 0.25; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, bottom); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, yc - 16); ctx.lineTo(x, yc + 16); ctx.stroke();
      const dir = i === 0 && m < 1 ? 1 : e.code[1] === 'E' || e.code[1] === 'D' ? -1 : 0;
      if (dir) for (const y of [yc - 16, yc + 16]) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5 * dir, y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 5 * dir, y - 4); ctx.lineTo(x + 9 * dir, y); ctx.lineTo(x + 5 * dir, y + 4); ctx.closePath(); ctx.fill();
      }
    });

    // kursor, bayangan saat menggeser, marker A-B
    const vline = (m, color, dash, label) => {
      const x = Math.round(S.X(m)) + 0.5;
      ctx.setLineDash(dash);
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.setLineDash([]);
      if (label) ctx.fillText(label, x + 6, PAD.t + 14);
    };
    if (o.cursor != null) vline(o.cursor, C.cursor, [3, 3]);
    if (o.ghost != null) vline(o.ghost, C.event, [6, 3]);
    if (o.ab) {
      const [a, b] = o.ab.map((m) => S.X(m));
      ctx.fillStyle = C.cursor;
      ctx.globalAlpha = 0.07;
      ctx.fillRect(Math.min(a, b), PAD.t, Math.abs(b - a), S.ph);
      ctx.globalAlpha = 1;
      vline(o.ab[0], C.cursor, [], 'A');
      vline(o.ab[1], C.cursor, [], 'B');
    }
    ctx.restore();
  }

  root.TraceChart = { draw, fitY, fullView, scales };
})(this);
