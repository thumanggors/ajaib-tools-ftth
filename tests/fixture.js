/* Fixture tes: SOR v2 sintetis, hanya untuk menguji parser.
   Trace 2000 m, redaman 0,35 dB/km, splice 0,30 dB di 1000 m, puncak reflektif +2 dB di 1800 m lalu noise floor -30 dB. */
function buildSor(opt = {}) { // opt.reflPositive: reflectance disimpan positif (gaya NOVKER); opt.zeroChecksum: checksum 0 (tidak diisi vendor)
  const C = 299792458, ior = 1.4682, dx = 0.5, n = 4000, pw = 30;
  const ds = Math.round((dx * ior) / C / 1e-14); // waktu 10.000 titik dalam satuan 100 ps
  const t = (m) => Math.round((m * ior) / (1e-10 * C));
  const W = () => {
    const b = [];
    return {
      b,
      u16: (v) => b.push(v & 255, (v >>> 8) & 255),
      u32: (v) => b.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255),
      str: (s) => { for (const ch of s) b.push(ch.charCodeAt(0)); b.push(0); },
      fixed: (s) => { for (const ch of s) b.push(ch.charCodeAt(0)); },
    };
  };
  const blocks = [];
  const add = (name, fn) => { const w = W(); w.str(name); fn(w); blocks.push({ name, b: w.b }); };
  const lv = (m) => (m >= 1803 ? -30 : -5 - 0.35e-3 * m - (m >= 1000 ? 0.3 : 0) + (m >= 1800 ? 2 : 0));

  add('GenParams', (w) => { w.fixed('EN'); w.str('CBL-01'); w.str('F-1'); w.u16(652); w.u16(1310); w.str('ODC-A'); w.str('ODP-01'); w.str(''); w.fixed('BC'); w.u32(0); w.u32(0); w.str('Budi'); w.str('uji'); });
  add('SupParams', (w) => ['VENDOR', 'OTDR-X', 'SN1', 'MOD', 'SN2', '1.0', ''].forEach((s) => w.str(s)));
  add('FxdParams', (w) => {
    w.u32(1790000000); w.fixed('mt'); w.u16(13100); w.u32(0); w.u32(0); // tanggal, satuan, wavelength ×10, offset, offset distance
    w.u16(1); w.u16(pw); w.u32(ds); w.u32(n); // 1 pulse width, pulse, data spacing, jumlah titik
    w.u32(Math.round(ior * 100000)); w.u16(800); w.u32(1000); w.u16(10); w.u32(n); w.u32(0); // IOR, backscatter, averages, avg time, range, range distance
    w.u32(0); w.u16(0); w.u16(1000); w.u16(0); w.u16(20); w.u16(40000); w.u16(3000); w.fixed('ST'); for (let i = 0; i < 4; i++) w.u32(0);
  });
  add('KeyEvents', (w) => {
    w.u16(2);
    [[1, 1000, '0F9999', 300, 0, 'sambungan'], [2, 1800, '1E9999', 0, opt.reflPositive ? 45000 : -45000, 'ujung']].forEach(([num, m, code, loss, refl, cm]) => {
      w.u16(num); w.u32(t(m)); w.u16(350); w.u16(loss); w.u32(refl >>> 0); w.fixed(code); w.fixed('LS');
      for (let i = 0; i < 5; i++) w.u32(0);
      w.str(cm);
    });
    w.u32(930); w.u32(0); w.u32(t(1800)); w.u16(45000); w.u32(0); w.u32(t(1800));
  });
  add('DataPts', (w) => { w.u32(n); w.u16(1); w.u32(n); w.u16(1000); for (let i = 0; i < n; i++) w.u16(Math.round(-lv(i * dx) * 1000)); });

  const map = W(); map.str('Map'); map.u16(200); map.u32(0); map.u16(blocks.length + 2);
  for (const bl of blocks) { map.str(bl.name); map.u16(200); map.u32(bl.b.length); }
  map.str('Cksum'); map.u16(200); map.u32(8);
  const L = map.b.length; map.b[6] = L & 255; map.b[7] = (L >>> 8) & 255; map.b[8] = (L >>> 16) & 255; map.b[9] = (L >>> 24) & 255;
  const ck = W(); ck.str('Cksum');
  const body = Uint8Array.from([...map.b, ...blocks.flatMap((bl) => bl.b), ...ck.b, 0, 0]);
  const crc = SOR.crc16(body.subarray(0, body.length - 2));
  if (!opt.zeroChecksum) { body[body.length - 2] = crc & 255; body[body.length - 1] = crc >>> 8; }
  return body;
}
