/* Halaman KML/KMZ ke BOQ. */
(function () {
  'use strict';
  const fmt = (v) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 });

  AJ.pages.boq = {
    mount(root) {
      const $ = (s) => root.querySelector(s);
      let current = null;

      AJ.drop($('[data-drop]'), async (files) => {
        const f = files[0];
        try {
          const places = KML.parse(await KML.readFile(f));
          if (!places.length) throw new Error('Tidak ada titik atau garis yang bisa dihitung');
          current = { name: f.name.replace(/\.(kmz|kml)$/i, ''), places, rows: KML.boq(places) };
          show(current.rows);
        } catch (e) {
          AJ.toast(`${f.name}: ${e.message}`, 'error');
        }
      });

      function show(rows) {
        $('.result').hidden = false;
        $('tbody').replaceChildren(...rows.map((r, i) => {
          const tr = document.createElement('tr');
          tr.style.setProperty('--i', Math.min(i, 20));
          for (const [text, cls] of [[i + 1], [r.item], [r.unit], [fmt(r.volume), 'r']]) {
            const td = document.createElement('td');
            td.textContent = text;
            if (cls) td.className = cls;
            tr.append(td);
          }
          return tr;
        }));
        const sum = (unit) => rows.filter((r) => r.unit === unit).reduce((s, r) => s + r.volume, 0);
        AJ.countUp($('[data-k=items]'), rows.length);
        AJ.countUp($('[data-k=pcs]'), sum('pcs'));
        AJ.countUp($('[data-k=m]'), sum('m'), 2);
      }

      $('[data-act=xlsx]').addEventListener('click', async () => {
        AJ.download(await KML.xlsx(KML.sheets(current.places, current.rows)), `${current.name}_BOQ.xlsx`);
        AJ.toast('File Excel BOQ dibuat', 'ok');
      });
    },
  };
})();
