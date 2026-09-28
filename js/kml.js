/* AJAIB TOOLS: baca KML/KMZ, hitung BOQ per folder, tulis xlsx dengan JSZip. Tanpa UI. */
(function (root) {
  'use strict';
  const R = 6371008.8; // radius rata-rata bumi, meter
  const rad = (d) => (d * Math.PI) / 180;

  // ponytail: haversine (bumi bola), selisih paling besar ~0,3% dari geodesik WGS84; ganti ke Vincenty kalau BOQ butuh lebih presisi.
  function distance([lon1, lat1], [lon2, lat2]) {
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  // Spasi di sekitar koma dirapikan dulu, lalu titik yang lon/lat-nya bukan angka dibuang.
  const coords = (el) => el.textContent.replace(/\s*,\s*/g, ',').trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  const lineLength = (pts) => pts.reduce((sum, p, i) => (i ? sum + distance(pts[i - 1], p) : 0), 0);
  function childName(el) {
    for (const c of el.children) if (c.localName === 'name') return c.textContent.trim().replace(/\s+/g, ' ');
    return '';
  }

  function parse(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('bukan file KML yang valid');
    const out = [];
    (function walk(el, path) {
      for (const c of el.children) {
        if (c.localName === 'Folder') walk(c, [...path, childName(c) || '(Tanpa nama)']);
        else if (c.localName === 'Placemark') {
          const name = childName(c);
          for (const g of c.getElementsByTagName('*')) {
            if (g.localName === 'Point') out.push({ path, name, kind: 'point', length: 0 });
            else if (g.localName === 'Polygon') out.push({ path, name, kind: 'polygon', length: 0 });
            else if (g.localName === 'LineString') {
              const cs = [...g.children].find((x) => x.localName === 'coordinates');
              out.push({ path, name, kind: 'line', length: cs ? lineLength(coords(cs)) : 0 });
            }
          }
        } else walk(c, path);
      }
    })(doc.documentElement, []);
    return out;
  }

  const UNIT = { point: 'pcs', polygon: 'pcs', line: 'm' };
  function boq(places) {
    const groups = new Map();
    for (const p of places) {
      const label = p.path.length ? p.path[p.path.length - 1] : '(Tanpa folder)';
      const key = label.toLowerCase();
      if (!groups.has(key)) groups.set(key, { label, units: new Map() });
      const units = groups.get(key).units, unit = UNIT[p.kind];
      units.set(unit, (units.get(unit) || 0) + (unit === 'm' ? p.length : 1));
    }
    const rows = [];
    for (const { label, units } of groups.values()) {
      for (const [unit, v] of units) rows.push({ item: units.size > 1 ? `${label} (${unit})` : label, unit, volume: unit === 'm' ? Math.round(v * 100) / 100 : v });
    }
    return rows;
  }

  const KIND = { point: 'Titik', line: 'Garis', polygon: 'Poligon' };
  function sheets(places, rows) {
    return {
      BOQ: [['No', 'Item', 'Satuan', 'Volume'], ...rows.map((r, i) => [i + 1, r.item, r.unit, r.volume])],
      Detail: [['Folder', 'Nama placemark', 'Jenis geometri', 'Panjang (m)'], ...places.map((p) => [p.path.join(' / ') || '(Tanpa folder)', p.name, KIND[p.kind], p.kind === 'line' ? Math.round(p.length * 100) / 100 : ''])],
    };
  }

  async function readFile(file) {
    if (!/\.kmz$/i.test(file.name)) return file.text();
    let zip;
    try { zip = await JSZip.loadAsync(file); } catch { throw new Error('arsip KMZ rusak'); }
    const entry = zip.file('doc.kml') || zip.file(/\.kml$/i)[0];
    if (!entry) throw new Error('tidak ada file KML di dalam arsip');
    return entry.async('string');
  }

  const esc = (s) => String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  function sheetXml(aoa) {
    const widths = aoa[0].map((_, c) => Math.min(60, aoa.reduce((w, row) => Math.max(w, String(row[c] ?? '').length + 2), 8)));
    const cols = widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('');
    const rows = aoa.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      const ref = String.fromCharCode(65 + c) + (r + 1), s = r === 0 ? ' s="1"' : '';
      return typeof v === 'number' ? `<c r="${ref}"${s}><v>${v}</v></c>` : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`;
  }

  async function xlsx(sheets) {
    const names = Object.keys(sheets), z = new JSZip();
    const NS = 'http://schemas.openxmlformats.org', X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
    z.file('[Content_Types].xml', `${X}<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`).join('')}</Types>`);
    z.file('_rels/.rels', `${X}<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    z.file('xl/workbook.xml', `${X}<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
    z.file('xl/_rels/workbook.xml.rels', `${X}<Relationships xmlns="${NS}/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    z.file('xl/styles.xml', `${X}<styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`);
    names.forEach((n, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheets[n])));
    return z.generateAsync({ type: 'blob', mimeType: `${CT}.sheet` });
  }

  root.KML = { parse, boq, sheets, readFile, xlsx, distance };
})(this);
