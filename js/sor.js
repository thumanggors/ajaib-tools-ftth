/* AJAIB TOOLS: baca/tulis file OTDR SOR (Telcordia SR-4731 v1 dan v2) dan analisis ulang event.
   Tanpa DOM supaya bisa dites terpisah. Semua angka di file little-endian. */
(function (root) {
  'use strict';
  const C = 299792458; // kecepatan cahaya, m/s
  const T = 1e-10; // satuan waktu event dan marker: 100 ps
  const GEN_FIELDS = ['cableId', 'fiberId', 'locA', 'locB', 'cableCode', 'operator', 'comment'];

  function reader(bytes, pos) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const r = {
      pos,
      u16() { const v = dv.getUint16(r.pos, true); r.pos += 2; return v; },
      i16() { const v = dv.getInt16(r.pos, true); r.pos += 2; return v; },
      u32() { const v = dv.getUint32(r.pos, true); r.pos += 4; return v; },
      i32() { const v = dv.getInt32(r.pos, true); r.pos += 4; return v; },
      str() {
        let s = '';
        for (;;) {
          if (r.pos >= bytes.length) throw new RangeError('string tidak berakhir');
          const c = bytes[r.pos++];
          if (!c) return s;
          s += String.fromCharCode(c);
        }
      },
      fixed(n) {
        if (r.pos + n > bytes.length) throw new RangeError('field terpotong');
        let s = '';
        for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[r.pos++]);
        return s;
      },
    };
    return r;
  }

  function crc16(bytes) { // CRC-16/CCITT-FALSE, poly 0x1021, init 0xFFFF
    let crc = 0xffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }

  function parseMap(bytes) {
    const r = reader(bytes, 0);
    let version = 1;
    if (bytes.length >= 4 && r.fixed(4) === 'Map\u0000') version = 2; else r.pos = 0;
    const mapVersion = r.u16(), mapSize = r.u32(), count = r.u16();
    const blocks = [{ name: 'Map', version: mapVersion, size: mapSize, offset: 0 }];
    let offset = mapSize;
    for (let i = 1; i < count; i++) {
      const name = r.str(), v = r.u16(), size = r.u32();
      blocks.push({ name, version: v, size, offset });
      offset += size;
    }
    return { version, blocks };
  }

  function parseGen(r, v) {
    const g = { lang: r.fixed(2), cableId: r.str(), fiberId: r.str() };
    if (v === 2) g.fiberType = r.u16();
    g.wavelength = r.u16();
    g.locA = r.str(); g.locB = r.str(); g.cableCode = r.str(); g.flag = r.fixed(2);
    g.userOffset = r.i32();
    if (v === 2) g.userOffsetDist = r.i32();
    g.operator = r.str(); g.comment = r.str();
    return g;
  }

  function parseSup(r) {
    return { supplier: r.str(), model: r.str(), serial: r.str(), module: r.str(), moduleSerial: r.str(), software: r.str(), other: r.str() };
  }

  function parseFxd(r, v, end) {
    const f = { date: r.u32(), units: r.fixed(2), wavelength: r.u16() / 10, acqOffset: r.i32() };
    if (v === 2) f.acqOffsetDist = r.i32();
    const n = r.u16();
    f.pulseWidths = Array.from({ length: n }, () => r.u16());
    f.dataSpacing = Array.from({ length: n }, () => r.u32());
    f.numPoints = Array.from({ length: n }, () => r.u32());
    f.ior = r.u32() / 100000;
    f.backscatter = r.u16(); // 0,1 dB
    f.averages = r.u32();
    if (v === 2) f.avgTime = r.u16();
    f.range = r.u32();
    // Field sisanya dibaca hanya kalau masih di dalam blok (ada vendor yang memotong FxdParams).
    if (r.pos + (v === 2 ? 4 : 0) + 16 <= end) {
      if (v === 2) f.rangeDist = r.i32();
      f.frontPanelOffset = r.i32(); f.noiseFloor = r.u16(); f.noiseFloorSF = r.i16(); f.powerOffset = r.u16();
      f.lossThr = r.u16() / 1000; // dB
      f.reflThr = -r.u16() / 1000; // dB, negatif
      f.eofThr = r.u16() / 1000;
    }
    return f;
  }

  function parseEvents(r, v) {
    const n = r.u16(), events = [];
    for (let i = 0; i < n; i++) {
      const e = { num: r.u16(), time: r.u32(), attn: r.i16(), loss: r.i16(), refl: r.i32(), code: r.fixed(6), tech: r.fixed(2) };
      e.markers = v === 2 ? [r.u32(), r.u32(), r.u32(), r.u32(), r.u32()] : null;
      e.comment = r.str();
      events.push(e);
    }
    const totals = { totalLoss: r.i32(), lossStart: r.i32(), lossEnd: r.u32(), orl: r.u16(), orlStart: r.i32(), orlEnd: r.u32() };
    return { events, totals };
  }

  function parseData(r) {
    const n = r.u32(), traces = r.u16(), heads = [];
    for (let i = 0; i < traces; i++) heads.push({ n: r.u32(), sf: r.u16() });
    const h = heads[0] || { n, sf: 1000 }, k = (h.sf || 1000) / 1e6;
    const trace = new Float64Array(h.n);
    for (let i = 0; i < h.n; i++) trace[i] = -r.u16() * k;
    return trace;
  }

  function parse(buf, name = '') {
    try {
      return parseRaw(buf instanceof Uint8Array ? buf : new Uint8Array(buf), name);
    } catch (e) {
      throw e instanceof RangeError ? new Error('file SOR rusak atau terpotong') : e;
    }
  }

  function parseRaw(bytes, name) {
    const { version, blocks } = parseMap(bytes);
    const sor = { name, version, bytes, blocks, gen: null, genTail: new Uint8Array(0), sup: null, fxd: null, events: [], eventsTail: new Uint8Array(0), totals: null, trace: null, checksumOk: null, warnings: [], dirty: new Set() };
    for (const b of blocks.slice(1)) {
      const end = b.offset + b.size;
      if (end > bytes.length) throw new Error(`blok ${b.name} terpotong`);
      const r = reader(bytes, b.offset + (version === 2 ? b.name.length + 1 : 0));
      if (b.name === 'GenParams') { sor.gen = parseGen(r, version); sor.genTail = bytes.slice(r.pos, end); }
      else if (b.name === 'SupParams') sor.sup = parseSup(r);
      else if (b.name === 'FxdParams') sor.fxd = parseFxd(r, version, end);
      else if (b.name === 'KeyEvents') { Object.assign(sor, parseEvents(r, version)); sor.eventsTail = bytes.slice(r.pos, end); }
      else if (b.name === 'DataPts') sor.trace = parseData(r);
      else if (b.name === 'Cksum') { const at = r.pos, v = r.u16(); sor.checksumOk = v === 0 ? null : v === crc16(bytes.subarray(0, at)); } // 0 = tidak diisi vendor (mis. NOVKER)
      if ((b.name === 'GenParams' || b.name === 'KeyEvents') && r.pos > end) throw new Error(`blok ${b.name} rusak`);
    }
    if (!sor.fxd || !sor.trace || !sor.trace.length) throw new Error('bukan file SOR yang lengkap (FxdParams/DataPts tidak ada)');
    if (sor.checksumOk === false) sor.warnings.push('checksum tidak cocok, file tetap dibuka');
    sor.reflSign = sor.events.some((e) => e.refl > 0) ? 1 : -1; // sebagian vendor (mis. NOVKER) menyimpan reflectance sebagai angka positif
    sor.ior = sor.fxd.ior || 1.468;
    sor.pw = sor.fxd.pulseWidths[0] || 0;
    sor.dx = (sor.fxd.dataSpacing[0] * 1e-14 * C) / sor.ior; // data spacing = waktu 10.000 titik dalam 100 ps
    sor.bc = sor.fxd.backscatter ? -sor.fxd.backscatter / 10 : null; // dB untuk pulsa 1 ns
    if (!(sor.dx > 0)) throw new Error('jarak antar titik trace tidak valid');
    return sor;
  }

  function writer() {
    const out = [];
    const w = {
      raw: (arr) => { for (const b of arr) out.push(b); },
      u16: (v) => out.push(v & 255, (v >>> 8) & 255),
      i16: (v) => w.u16(v & 0xffff),
      u32: (v) => out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255),
      i32: (v) => w.u32(v >>> 0),
      fixed: (s, n) => { for (let i = 0; i < n; i++) out.push(i < s.length ? s.charCodeAt(i) & 255 : 32); },
      str: (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255); out.push(0); },
      done: () => Uint8Array.from(out),
    };
    return w;
  }

  function writeGen(w, g) { // v2
    w.fixed(g.lang, 2); w.str(g.cableId); w.str(g.fiberId); w.u16(g.fiberType); w.u16(g.wavelength);
    w.str(g.locA); w.str(g.locB); w.str(g.cableCode); w.fixed(g.flag, 2);
    w.i32(g.userOffset); w.i32(g.userOffsetDist); w.str(g.operator); w.str(g.comment);
  }

  function writeEvents(w, events, t) { // v2
    w.u16(events.length);
    for (const e of events) {
      w.u16(e.num); w.u32(e.time); w.i16(e.attn); w.i16(e.loss); w.i32(e.refl); w.fixed(e.code, 6); w.fixed(e.tech, 2);
      for (const m of e.markers || [0, 0, 0, 0, 0]) w.u32(m);
      w.str(e.comment);
    }
    w.i32(t.totalLoss); w.i32(t.lossStart); w.u32(t.lossEnd); w.u16(t.orl); w.i32(t.orlStart); w.u32(t.orlEnd);
  }

  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // Hanya GenParams dan KeyEvents yang ditulis ulang; blok lain (termasuk DataPts dan blok vendor) disalin byte per byte.
  function write(sor) {
    if (!sor.dirty.size) return sor.bytes;
    if (sor.version !== 2) throw new Error('Format SOR v1 hanya bisa dibaca');
    const blocks = [];
    for (const b of sor.blocks.slice(1)) {
      if (b.name === 'Cksum') continue;
      let body = sor.bytes.subarray(b.offset, b.offset + b.size);
      if (sor.dirty.has(b.name) && (b.name === 'GenParams' || b.name === 'KeyEvents')) {
        const w = writer();
        w.str(b.name);
        if (b.name === 'GenParams') { writeGen(w, sor.gen); w.raw(sor.genTail); }
        else { writeEvents(w, sor.events, sor.totals); w.raw(sor.eventsTail); }
        body = w.done();
      }
      blocks.push({ name: b.name, version: b.version, body });
    }
    const mapVersion = sor.blocks[0].version;
    const ckVersion = (sor.blocks.find((b) => b.name === 'Cksum') || { version: mapVersion }).version;
    const m = writer();
    m.str('Map'); m.u16(mapVersion); m.u32(0); m.u16(blocks.length + 2);
    for (const b of blocks) { m.str(b.name); m.u16(b.version); m.u32(b.body.length); }
    m.str('Cksum'); m.u16(ckVersion); m.u32(8);
    const map = m.done();
    new DataView(map.buffer).setUint32(6, map.length, true);
    const ck = writer(); ck.str('Cksum');
    const out = concat([map, ...blocks.map((b) => b.body), ck.done(), new Uint8Array(2)]);
    new DataView(out.buffer).setUint16(out.length - 2, crc16(out.subarray(0, out.length - 2)), true);
    return out;
  }

  const latin1 = (s) => String(s).replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
  function setGen(sor, field, value) {
    if (!GEN_FIELDS.includes(field)) throw new Error(`field ${field} tidak bisa diedit`);
    if (!sor.gen) throw new Error('file ini tidak punya blok GenParams');
    sor.gen[field] = latin1(value);
    sor.dirty.add('GenParams');
  }
  function setComment(sor, i, text) {
    sor.events[i].comment = latin1(text);
    sor.dirty.add('KeyEvents');
  }

  // ponytail: offset akuisisi di FxdParams diabaikan, jarak dihitung dari titik trace pertama; tambahkan kalau ada OTDR dengan offset bukan nol.
  const timeToM = (sor, t) => (t * T * C) / sor.ior;
  const mToTime = (sor, m) => Math.max(0, Math.round((m * sor.ior) / (T * C)));
  const mToIdx = (sor, m) => Math.max(0, Math.min(sor.trace.length - 1, Math.round(m / sor.dx)));
  const eventM = (sor, i) => timeToM(sor, sor.events[i].time);

  const clamp16 = (v) => Math.max(-32768, Math.min(32767, v));
  const idxOf = (sor, ev) => mToIdx(sor, timeToM(sor, ev.time));
  const isEnd = (ev) => ev.code[1] === 'E' || ev.code[1] === 'D';

  // Regresi linear trace[a..b). x dihitung dari a supaya jumlah kuadrat tetap presisi.
  function fit(tr, a, b) {
    const n = b - a;
    if (n < 5) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = a; i < b; i++) { const x = i - a, y = tr[i]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const d = n * sxx - sx * sx;
    if (!d) return null;
    const slope = (n * sxy - sx * sy) / d;
    return { a, b, slope, icpt: (sy - slope * sx) / n };
  }
  const at = (f, i) => f.icpt + f.slope * (i - f.a);

  // Ukur event di indeks e dengan LSA. lo/hi = indeks event tetangga atau ujung trace.
  function measure(sor, e, lo, hi) {
    const tr = sor.trace;
    const gap = Math.max(3, Math.ceil((1.5 * sor.pw * 1e-9 * C) / (2 * sor.ior) / sor.dx)); // lewati dead zone ±1,5 panjang pulsa
    const len = Math.max(20, 4 * gap);
    const before = fit(tr, Math.max(lo + (lo > 0 ? gap : 0), e - gap - len), e - gap);
    const after = fit(tr, e + gap, Math.min(hi - (hi < tr.length - 1 ? gap : 0), e + gap + len));
    let peak = -Infinity;
    for (let i = Math.max(0, e - gap); i <= Math.min(tr.length - 1, e + gap); i++) peak = Math.max(peak, tr[i]);
    const H = before ? peak - at(before, e) : 0;
    const reflective = H >= 0.1; // puncak minimal 0,1 dB di atas backscatter dianggap reflektif
    const refl = reflective && sor.bc != null && sor.pw ? sor.bc + 10 * Math.log10((10 ** (H / 5) - 1) * sor.pw) : null;
    return { e, before, after, loss: before && after ? at(before, e) - at(after, e) : null, reflective, refl };
  }

  function measureEvent(sor, i) {
    const ev = sor.events;
    return measure(sor, idxOf(sor, ev[i]), i > 0 ? idxOf(sor, ev[i - 1]) : 0, i < ev.length - 1 ? idxOf(sor, ev[i + 1]) : sor.trace.length - 1);
  }

  // Nilai event selalu berasal dari trace; tidak ada jalur untuk mengetik loss/reflectance.
  function reanalyze(sor, i) {
    const E = sor.events[i], m = measureEvent(sor, i);
    // LSA tidak bisa mengukur (dead zone awal atau jendela terlalu sempit): event dari OTDR dibiarkan apa adanya.
    // Event manual tetap diproses karena nilai lamanya milik posisi lain.
    if ((!m.before || (!isEnd(E) && m.loss == null)) && !'AMD'.includes(E.code[1])) return;
    E.loss = isEnd(E) || m.loss == null ? 0 : clamp16(Math.round(m.loss * 1000));
    E.refl = m.refl == null ? 0 : Math.round(Math.abs(m.refl) * 1000) * sor.reflSign;
    E.attn = m.before ? clamp16(Math.round((-m.before.slope / sor.dx) * 1e6)) : 0; // dB/km × 1000
    E.code = (m.reflective ? (E.code[0] === '2' ? '2' : '1') : '0') + E.code.slice(1);
    E.tech = 'LS';
    if (E.markers) E.markers = [m.before?.a, m.before?.b, m.e, m.after?.a, m.after?.b].map((k) => (k == null ? 0 : mToTime(sor, k * sor.dx)));
  }

  function updateTotals(sor) {
    const ev = sor.events, t = sor.totals;
    if (!t || ev.length < 2) return;
    const i0 = idxOf(sor, ev[0]), i1 = idxOf(sor, ev[ev.length - 1]);
    const a = measure(sor, i0, 0, idxOf(sor, ev[1])).after;
    const b = measure(sor, i1, idxOf(sor, ev[ev.length - 2]), sor.trace.length - 1).before;
    if (a && b) t.totalLoss = Math.round((at(a, i0) - at(b, i1)) * 1000);
    t.lossStart = ev[0].time;
    t.lossEnd = ev[ev.length - 1].time;
  }

  const byTime = (a, b) => a.time - b.time;
  function refresh(sor, touched) {
    sor.events.sort(byTime);
    sor.events.forEach((ev, k) => (ev.num = k + 1));
    for (const ev of new Set(touched)) { const k = sor.events.indexOf(ev); if (k >= 0) reanalyze(sor, k); }
    updateTotals(sor);
    sor.dirty.add('KeyEvents');
  }
  function around(sor, ev) {
    const k = sor.events.indexOf(ev);
    return [sor.events[k - 1], ev, sor.events[k + 1]].filter(Boolean);
  }

  function addEvent(sor, m) {
    const ev = { num: 0, time: mToTime(sor, m), attn: 0, loss: 0, refl: 0, code: '0A9999', tech: 'LS', markers: sor.version === 2 ? [0, 0, 0, 0, 0] : null, comment: '' };
    sor.events.push(ev);
    sor.events.sort(byTime);
    refresh(sor, around(sor, ev));
    return sor.events.indexOf(ev);
  }
  function moveEvent(sor, i, m) {
    const ev = sor.events[i], old = around(sor, ev);
    ev.time = mToTime(sor, m);
    ev.code = ev.code[0] + (isEnd(ev) ? 'D' : 'M') + ev.code.slice(2);
    sor.events.sort(byTime);
    refresh(sor, [...old, ...around(sor, ev)]);
    return sor.events.indexOf(ev);
  }
  function deleteEvent(sor, i) {
    const ev = sor.events[i], old = around(sor, ev).filter((x) => x !== ev);
    sor.events.splice(i, 1);
    refresh(sor, old);
  }

  function status(sor, thr) {
    const events = sor.events.map((e) => {
      if (isEnd(e)) return null;
      const loss = e.loss / 1000;
      return e.code[0] === '0' ? loss <= thr.splice : loss <= thr.connector && (e.refl === 0 || reflDb(e) <= thr.refl);
    });
    return { events, pass: events.every((x) => x !== false) };
  }

  function summary(sor) {
    const n = sor.events.length;
    return { length: n ? eventM(sor, n - 1) : (sor.trace.length - 1) * sor.dx, loss: (sor.totals?.totalLoss || 0) / 1000, orl: (sor.totals?.orl || 0) / 1000 };
  }

  // Reflectance selalu negatif secara fisik; tanda di file bergantung vendor.
  const reflDb = (e) => (e.refl ? -Math.abs(e.refl) / 1000 : null);

  root.SOR = { parse, write, setGen, setComment, measureEvent, addEvent, moveEvent, deleteEvent, status, summary, reflDb, crc16, timeToM, mToTime, mToIdx, eventM, GEN_FIELDS };
})(this);
