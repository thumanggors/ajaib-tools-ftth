const KML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Proyek</name>
<Placemark><name>Lepas</name><Point><coordinates>106.8,-6.2,0</coordinates></Point></Placemark>
<Folder><name>Cluster A</name>
  <Folder><name>ODP</name>
    <Placemark><name>ODP-01</name><Point><coordinates>106.8,-6.2,0</coordinates></Point></Placemark>
    <Placemark><name>ODP-02</name><Point><coordinates>106.801,-6.2,0</coordinates></Point></Placemark>
  </Folder>
  <Folder><name><![CDATA[ KABEL  24C ]]></name>
    <Placemark><name>Kabel 1</name><LineString><coordinates>106.8,-6.2,0 106.801,-6.2,0</coordinates></LineString></Placemark>
  </Folder>
  <Folder><name>TIANG</name>
    <Placemark><name>T1</name><Point><coordinates>106.8,-6.2,0</coordinates></Point></Placemark>
    <Placemark><name>Jalur tiang</name><LineString><coordinates>106.8,-6.2,0
      106.8,-6.201,0</coordinates></LineString></Placemark>
  </Folder>
</Folder>
<Folder><name>Cluster B</name>
  <Folder><name>odp </name>
    <Placemark><name>ODP-03</name><MultiGeometry><Point><coordinates>106.8,-6.2</coordinates></Point><Point><coordinates>106.9,-6.2</coordinates></Point></MultiGeometry></Placemark>
  </Folder>
  <Folder><name>Area &amp; Blok</name>
    <Placemark><name>Blok</name><Polygon><outerBoundaryIs><LinearRing><coordinates>106.8,-6.2 106.801,-6.2 106.801,-6.201 106.8,-6.2</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Folder>
</Folder>
</Document></kml>`;

test('KML: jarak haversine 0,001° lintang = 111,195 m', () => {
  near(KML.distance([106.8, -6.2], [106.8, -6.201]), 111.195, 0.01, 'jarak');
});

test('KML: parse folder, CDATA, MultiGeometry, Polygon', () => {
  const p = KML.parse(KML_SAMPLE);
  assert(p.length === 9, `jumlah geometri ${p.length}, harusnya 9`);
  assert(p[0].path.length === 0 && p[0].kind === 'point', 'placemark tanpa folder');
  const kabel = p.find((x) => x.name === 'Kabel 1');
  assert(kabel.path.join('/') === 'Cluster A/KABEL 24C', `path kabel ${kabel.path.join('/')}`);
  near(kabel.length, 110.54, 0.05, 'panjang kabel');
  assert(p.filter((x) => x.name === 'ODP-03').length === 2, 'MultiGeometry diurai jadi 2');
  assert(p.find((x) => x.name === 'Blok').kind === 'polygon', 'polygon');
  assert(!p.some((x) => x.name === 'Blok' && x.kind === 'line'), 'LinearRing tidak dihitung sebagai garis');
});

test('KML: BOQ menggabung folder bernama sama dan memisah satuan', () => {
  const rows = KML.boq(KML.parse(KML_SAMPLE));
  const got = rows.map((r) => `${r.item}|${r.unit}|${r.unit === 'm' ? r.volume.toFixed(1) : r.volume}`);
  const want = ['(Tanpa folder)|pcs|1', 'ODP|pcs|4', 'KABEL 24C|m|110.5', 'TIANG (pcs)|pcs|1', 'TIANG (m)|m|111.2', 'Area & Blok|pcs|1'];
  assert(JSON.stringify(got) === JSON.stringify(want), `dapat ${JSON.stringify(got)}`);
});

test('KML: sheets BOQ dan Detail', () => {
  const places = KML.parse(KML_SAMPLE), s = KML.sheets(places, KML.boq(places));
  assert(JSON.stringify(s.BOQ[0]) === JSON.stringify(['No', 'Item', 'Satuan', 'Volume']), 'header BOQ');
  assert(JSON.stringify(s.BOQ[2]) === JSON.stringify([2, 'ODP', 'pcs', 4]), `baris ODP ${JSON.stringify(s.BOQ[2])}`);
  assert(s.Detail.length === places.length + 1, 'jumlah baris Detail');
  assert(s.Detail[0][3] === 'Panjang (m)', 'header Detail');
  assert(s.Detail[1][0] === '(Tanpa folder)' && s.Detail[1][2] === 'Titik', 'baris Detail pertama');
});

test('KML: XML rusak ditolak dengan pesan jelas', async () => {
  await throwsMsg(() => KML.parse('<kml><Document>'), /bukan file KML yang valid/);
});

test('KML: readFile membaca .kml, doc.kml di KMZ, dan .kml lain di KMZ', async () => {
  const plain = new File([KML_SAMPLE], 'a.kml');
  assert((await KML.readFile(plain)).includes('Placemark'), '.kml langsung');
  const z1 = new JSZip(); z1.file('doc.kml', KML_SAMPLE);
  assert((await KML.readFile(new File([await z1.generateAsync({ type: 'blob' })], 'b.kmz'))).includes('Placemark'), 'doc.kml');
  const z2 = new JSZip(); z2.file('files/desain.kml', KML_SAMPLE); z2.file('files/ikon.png', 'x');
  assert((await KML.readFile(new File([await z2.generateAsync({ type: 'blob' })], 'c.KMZ'))).includes('Placemark'), 'kml lain');
});

test('KML: KMZ tanpa KML dan KMZ rusak', async () => {
  const z = new JSZip(); z.file('ikon.png', 'x');
  await throwsMsg(async () => KML.readFile(new File([await z.generateAsync({ type: 'blob' })], 'd.kmz')), /tidak ada file KML/);
  await throwsMsg(() => KML.readFile(new File([new Uint8Array([1, 2, 3, 4, 5])], 'e.kmz')), /arsip KMZ rusak/);
});

test('KML: xlsx berisi dua sheet, angka, dan teks ter-escape', async () => {
  const places = KML.parse(KML_SAMPLE), blob = await KML.xlsx(KML.sheets(places, KML.boq(places)));
  const z = await JSZip.loadAsync(blob);
  const wb = await z.file('xl/workbook.xml').async('string');
  assert(wb.includes('name="BOQ"') && wb.includes('name="Detail"'), 'nama sheet');
  const s1 = await z.file('xl/worksheets/sheet1.xml').async('string');
  assert(s1.includes('>ODP</t>') && s1.includes('<v>4</v>'), 'isi BOQ');
  assert(s1.includes('Area &amp; Blok'), 'escape &');
  assert(z.file('xl/styles.xml') && z.file('[Content_Types].xml') && z.file('xl/worksheets/sheet2.xml'), 'part wajib');
});

test('KML: 5.000 placemark selesai kurang dari 3 detik', () => {
  let body = '';
  for (let f = 0; f < 5; f++) {
    body += `<Folder><name>F${f}</name>`;
    for (let i = 0; i < 1000; i++) body += i % 2 ? `<Placemark><name>P${i}</name><Point><coordinates>106.${i},-6.2,0</coordinates></Point></Placemark>` : `<Placemark><name>L${i}</name><LineString><coordinates>106.8,-6.2,0 106.801,-6.2,0 106.802,-6.201,0</coordinates></LineString></Placemark>`;
    body += '</Folder>';
  }
  const t0 = performance.now();
  const rows = KML.boq(KML.parse(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${body}</Document></kml>`));
  const ms = performance.now() - t0;
  assert(rows.length === 10, `baris ${rows.length}`);
  assert(ms < 3000, `butuh ${ms.toFixed(0)} ms`);
});

test('KML: koordinat tidak baku (spasi setelah koma, token rusak) tidak menghasilkan NaN', async () => {
  const k = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>KABEL</name>
    <Placemark><name>A</name><LineString><coordinates>106.8, -6.2, 0  106.801, -6.2, 0 abc</coordinates></LineString></Placemark>
  </Folder></Document></kml>`;
  const places = KML.parse(k);
  near(places[0].length, 110.54, 0.05, 'panjang');
  const z = await JSZip.loadAsync(await KML.xlsx(KML.sheets(places, KML.boq(places))));
  assert(!(await z.file('xl/worksheets/sheet1.xml').async('string')).includes('NaN'), 'xlsx berisi NaN');
});
