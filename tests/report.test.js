test('SOR: Loss/Refl. Threshold dibaca dari FxdParams', () => {
  const s = SOR.parse(buildSor());
  near(s.fxd.lossThr, 0.02, 1e-9, 'loss threshold');
  near(s.fxd.reflThr, -40, 1e-9, 'refl threshold');
});

test('Report: aturan sumbu sama dengan laporan acuan', () => {
  assert(Report.kmStep(8.365) === 1 && Report.kmStep(4.182) === 1 && Report.kmStep(2.091) === 0.5, 'langkah km');
  assert(Report.yMax(23.793) === 25, 'rentang dB');
});

test('Report: isi Parameters, Summary, dan Event Table berformat acuan', () => {
  const s = SOR.parse(buildSor(), 'uji.sor');
  const f = Report.fields(s, { customer: 'Starlite', job: 'KRENCENG' });
  const range = (((s.trace.length - 1) * s.dx) / 1000).toFixed(3).replace('.', ',');
  const want = [
    ['Begin: ODC-A', 'End: ODP-01'],
    ['Cable: CBL-01', 'Fiber: F-1'],
    [`Range: ${range} km`, 'Pulse Width: 30 ns'],
    ['Wavelength: 1310 nm (Singlemode)', 'Refractive index: 1,46820'],
    ['Loss Threshold: 0,020 dB', 'Refl. Threshold: -40,000 dB'],
  ];
  want.forEach((row, i) => assert(JSON.stringify(f.params[i]) === JSON.stringify(row), `baris ${i}: ${JSON.stringify(f.params[i])}`));
  assert(/^Date: \d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d$/.test(f.params[5][0]) && f.params[5][1] === 'File: uji.sor', `baris 5: ${f.params[5]}`);
  assert(f.params[6][0] === 'OTDR: OTDR-X S/N: SN1' && f.params[7][0] === 'Module: MOD S/N: SN2', 'OTDR/Module');
  assert(JSON.stringify(f.params[8]) === JSON.stringify(['Customer: Starlite', 'Job Name: KRENCENG']), 'Customer/Job');
  assert(f.params[9][0] === 'Supplier: VENDOR' && f.params[10][0] === 'Comment: uji', 'Supplier/Comment');
  assert(JSON.stringify(f.summary) === JSON.stringify([['Fiber Lenght: 1,800 km', 'Total Loss: 0,930 dB'], ['Attenuation: 0,517 dB/km', '']]), `summary ${JSON.stringify(f.summary)}`);
  assert(JSON.stringify(f.events) === JSON.stringify([['1', 'Loss', '1,000', '0,300', '- - -', '0,350'], ['2', 'End', '1,800', '- - -', '-45,000', '0,350']]), `events ${JSON.stringify(f.events)}`);
});

test('Report: event di 0 m bertipe Begin', () => {
  const s = SOR.parse(buildSor({ reflPositive: true }));
  s.events.unshift({ num: 0, time: 0, attn: 350, loss: 500, refl: 12071, code: '1F9999', tech: 'LS', markers: [0, 0, 0, 0, 0], comment: '' });
  const row = Report.fields(s).events[0];
  assert(JSON.stringify(row.slice(1)) === JSON.stringify(['Begin', '0,000', '- - -', '-12,071', '- - -']), `begin ${JSON.stringify(row)}`);
});
