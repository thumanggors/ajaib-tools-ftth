test('SOR: crc16 CCITT-FALSE untuk "123456789" = 0x29B1', () => {
  assert(SOR.crc16(new TextEncoder().encode('123456789')) === 0x29b1, 'crc salah');
});

test('SOR: parse fixture v2', () => {
  const s = SOR.parse(buildSor(), 'uji.sor');
  assert(s.version === 2, 'versi');
  assert(s.gen.cableId === 'CBL-01' && s.gen.fiberId === 'F-1' && s.gen.locB === 'ODP-01' && s.gen.comment === 'uji', 'GenParams');
  assert(s.sup.supplier === 'VENDOR' && s.sup.model === 'OTDR-X', 'SupParams');
  assert(s.fxd.wavelength === 1310 && s.pw === 30, 'FxdParams');
  near(s.ior, 1.4682, 1e-9, 'IOR');
  near(s.bc, -80, 1e-9, 'backscatter');
  near(s.dx, 0.5, 1e-4, 'dx');
  assert(s.trace.length === 4000, 'jumlah titik');
  near(s.trace[0], -5, 1e-9, 'level awal');
  assert(s.events.length === 2 && s.events[0].code === '0F9999' && s.events[1].comment === 'ujung', 'KeyEvents');
  near(SOR.eventM(s, 0), 1000, 0.1, 'jarak event 1');
  assert(s.totals.totalLoss === 930 && s.totals.orl === 45000, 'totals');
  assert(s.checksumOk === true && s.warnings.length === 0, 'checksum');
});

test('SOR: checksum salah tetap dibuka dengan peringatan', () => {
  const b = buildSor(); b[b.length - 3] ^= 0xff;
  const s = SOR.parse(b, 'x.sor');
  assert(s.checksumOk === false, 'checksumOk harus false');
  assert(s.warnings.length === 1 && /checksum/.test(s.warnings[0]), 'peringatan');
});

test('SOR: file terpotong dan file sampah menghasilkan error jelas', async () => {
  await throwsMsg(() => SOR.parse(buildSor().slice(0, 500)), /terpotong|rusak/);
  await throwsMsg(() => SOR.parse(new Uint8Array(10)), /bukan file SOR/);
  const junk = new Uint8Array(300); for (let i = 0; i < junk.length; i++) junk[i] = (i * 73 + 11) & 255;
  await throwsMsg(() => SOR.parse(junk), /SOR/);
});

test('SOR: konversi jarak bolak-balik', () => {
  const s = SOR.parse(buildSor());
  near(SOR.timeToM(s, SOR.mToTime(s, 1234.5)), 1234.5, 0.02, 'm → time → m');
  assert(SOR.mToIdx(s, 1000) === 2000 && SOR.mToIdx(s, -5) === 0 && SOR.mToIdx(s, 1e9) === 3999, 'mToIdx');
});

const blockBytes = (s, name) => { const b = s.blocks.find((x) => x.name === name); return s.bytes.subarray(b.offset, b.offset + b.size).join(','); };

test('SOR: tulis tanpa perubahan = byte asli', () => {
  const s = SOR.parse(buildSor());
  assert(SOR.write(s) === s.bytes, 'harus mengembalikan byte asli');
});

test('SOR: serializer GenParams/KeyEvents identik dengan aslinya', () => {
  const orig = buildSor(), s = SOR.parse(orig);
  s.dirty.add('GenParams'); s.dirty.add('KeyEvents');
  const out = SOR.write(s);
  assert(out.length === orig.length, `panjang ${out.length} vs ${orig.length}`);
  assert(out.join(',') === orig.join(','), 'byte berbeda');
});

test('SOR: edit header, simpan, baca ulang', () => {
  const s = SOR.parse(buildSor());
  SOR.setGen(s, 'fiberId', 'F-07');
  SOR.setGen(s, 'locA', 'Jl. Sudirman ✓');
  const t = SOR.parse(SOR.write(s));
  assert(t.gen.fiberId === 'F-07', 'fiberId');
  assert(t.gen.locA === 'Jl. Sudirman ?', `karakter non-Latin-1 harus jadi ? (${t.gen.locA})`);
  assert(t.gen.cableId === 'CBL-01' && t.gen.fiberType === 652 && t.gen.operator === 'Budi', 'field lain tetap');
  assert(t.checksumOk === true, 'checksum');
  assert(blockBytes(t, 'DataPts') === blockBytes(s, 'DataPts'), 'DataPts harus identik');
  assert(t.events.length === 2 && t.events[0].loss === 300, 'event tidak berubah');
});

test('SOR: komentar event tersimpan', () => {
  const s = SOR.parse(buildSor());
  SOR.setComment(s, 0, 'JC-03 tiang 45');
  const t = SOR.parse(SOR.write(s));
  assert(t.events[0].comment === 'JC-03 tiang 45' && t.events[0].loss === 300 && t.events[0].time === s.events[0].time, 'komentar');
});

test('SOR: field terlarang dan penyimpanan v1 ditolak', async () => {
  const s = SOR.parse(buildSor());
  await throwsMsg(() => SOR.setGen(s, 'wavelength', '1550'), /tidak bisa diedit/);
  s.version = 1; SOR.setGen(s, 'fiberId', 'X');
  await throwsMsg(() => SOR.write(s), /v1 hanya bisa dibaca/);
});

test('SOR: LSA mengukur splice 0,30 dB, non-reflektif', () => {
  const m = SOR.measureEvent(SOR.parse(buildSor()), 0);
  near(m.loss, 0.3, 0.02, 'loss splice');
  assert(m.reflective === false && m.refl === null, 'splice harus non-reflektif');
  assert(m.before && m.after && m.before.b <= m.e && m.after.a >= m.e, 'jendela regresi mengapit event');
});

test('SOR: reflectance ujung dihitung dengan rumus IEC 61746', () => {
  const m = SOR.measureEvent(SOR.parse(buildSor()), 1);
  assert(m.reflective === true, 'ujung harus reflektif');
  near(m.refl, -63.43, 0.3, 'reflectance');
});

test('SOR: tambah event dihitung dari trace dan ditandai manual', () => {
  const s = SOR.parse(buildSor());
  const i = SOR.addEvent(s, 500);
  assert(i === 0 && s.events.length === 3, 'posisi dan jumlah');
  assert(s.events.map((e) => e.num).join() === '1,2,3', 'nomor urut');
  assert(s.events[0].code === '0A9999' && s.events[0].tech === 'LS', `kode ${s.events[0].code}`);
  near(s.events[0].loss / 1000, 0, 0.02, 'loss event baru di serat lurus');
  near(s.events[1].loss / 1000, 0.3, 0.02, 'splice tetangga dihitung ulang');
  near(s.totals.totalLoss / 1000, 0.755, 0.02, 'total loss dari trace');
  const t = SOR.parse(SOR.write(s));
  assert(t.events.length === 3 && t.checksumOk, 'tersimpan');
  assert(blockBytes(t, 'DataPts') === blockBytes(s, 'DataPts'), 'DataPts harus identik');
  assert(t.events[0].markers.some((x) => x > 0), 'marker LSA tertulis');
});

test('SOR: geser event menghitung ulang dari trace di posisi baru', () => {
  const s = SOR.parse(buildSor());
  const i = SOR.moveEvent(s, 0, 1100);
  near(SOR.eventM(s, i), 1100, 0.1, 'posisi baru');
  assert(s.events[i].code[1] === 'M', 'kode M');
  near(s.events[i].loss / 1000, 0, 0.02, 'tidak ada sambungan di 1100 m');
  const j = SOR.moveEvent(s, 1, 1790);
  assert(s.events[j].code[1] === 'D', 'ujung yang digeser berkode D');
});

test('SOR: hapus event', () => {
  const s = SOR.parse(buildSor());
  SOR.deleteEvent(s, 0);
  assert(s.events.length === 1 && s.events[0].num === 1 && s.dirty.has('KeyEvents'), 'hapus');
});

test('SOR: status pass/fail memakai ambang', () => {
  const s = SOR.parse(buildSor());
  const a = SOR.status(s, { splice: 0.1, connector: 0.5, refl: -35 });
  assert(a.events[0] === false && a.events[1] === null && a.pass === false, `ketat ${JSON.stringify(a)}`);
  const b = SOR.status(s, { splice: 0.5, connector: 0.5, refl: -35 });
  assert(b.pass === true, 'longgar harus lulus');
});

test('SOR: ringkasan panjang, total loss, ORL', () => {
  const r = SOR.summary(SOR.parse(buildSor()));
  near(r.length, 1800, 0.1, 'panjang'); near(r.loss, 0.93, 1e-9, 'loss'); near(r.orl, 45, 1e-9, 'ORL');
});

test('SOR: event OTDR yang tidak bisa diukur LSA tidak ditimpa nol', () => {
  const s = SOR.parse(buildSor());
  s.events.unshift({ num: 0, time: 0, attn: 350, loss: 500, refl: -45000, code: '1F9999', tech: 'LS', markers: [0, 0, 0, 0, 0], comment: 'konektor depan' });
  SOR.addEvent(s, 200);
  const e0 = s.events[0];
  assert(e0.time === 0 && e0.loss === 500 && e0.refl === -45000 && e0.code === '1F9999' && e0.attn === 350, `event 0 berubah: ${JSON.stringify(e0)}`);
  near(s.events[1].loss / 1000, 0, 0.02, 'event baru tetap diukur');
});

test('SOR: reflectance bertanda positif (gaya NOVKER) dibaca sebagai dB negatif', () => {
  const s = SOR.parse(buildSor({ reflPositive: true }));
  near(SOR.reflDb(s.events[1]), -45, 1e-9, 'reflectance ujung');
  assert(SOR.reflDb({ refl: 0 }) === null, 'refl 0 = tidak ada');
  s.events[0].code = '1F9999'; s.events[0].refl = 45000;
  assert(SOR.status(s, { splice: 0.1, connector: 0.5, refl: -35 }).events[0] === true, 'konektor -45 dB harus lulus ambang -35 dB');
  const j = SOR.moveEvent(s, s.events.length - 1, 1800);
  assert(s.events[j].refl > 0, 'analisis ulang mengikuti konvensi tanda file');
  near(SOR.reflDb(s.events[j]), -63.43, 0.3, 'reflectance analisis ulang');
});

test('SOR: checksum 0 (tidak diisi vendor) tidak dianggap salah', () => {
  const s = SOR.parse(buildSor({ zeroChecksum: true }));
  assert(s.checksumOk === null && s.warnings.length === 0, `checksumOk=${s.checksumOk}, warnings=${s.warnings}`);
});
