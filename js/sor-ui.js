/* Halaman Editor SOR: workspace, grafik interaktif, analisis ulang event, edit header. */
(function () {
  'use strict';
  const LABELS = { cableId: 'Cable ID', fiberId: 'Fiber ID', locA: 'Lokasi asal', locB: 'Lokasi tujuan', cableCode: 'Cable code', operator: 'Operator', comment: 'Komentar' };
  const fmt = (v, d) => v.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function field(name, label, value, onchange) {
    const l = document.createElement('label'), inp = document.createElement('input');
    l.textContent = label;
    inp.name = name;
    inp.value = value ?? '';
    if (onchange) inp.onchange = onchange;
    l.append(inp);
    return l;
  }

  AJ.pages.sor = {
    mount(root) {
      const $ = (s) => root.querySelector(s);
      const canvas = $('[data-chart]'), ctx = canvas.getContext('2d');
      let view = null, sel = -1, cursor = null, ghost = null, ab = null, drag = null, progress = 1;
      const cur = () => AJ.ws[AJ.current];
      const maxM = () => (cur().trace.length - 1) * cur().dx;
      const clampM = (m) => Math.max(0, Math.min(maxM(), m));
      const geom = () => { const r = canvas.getBoundingClientRect(); return { r, sc: TraceChart.scales(r.width, r.height, view) }; };

      AJ.drop($('[data-drop]'), async (files) => {
        const before = AJ.ws.length;
        if (await AJ.loadSor(files)) { AJ.current = before; sel = -1; cursor = null; }
        renderList();
        open();
      });

      function renderList() {
        const thr = AJ.thresholds();
        $('[data-list]').replaceChildren(...AJ.ws.map((s, i) => {
          const pass = SOR.status(s, thr).pass, li = document.createElement('li');
          li.className = 'ws-item' + (i === AJ.current ? ' active' : '');
          li.innerHTML = `<input type="checkbox"><button class="ws-name" type="button"></button><span class="badge ${pass ? 'ok' : 'bad'}">${pass ? 'Lulus' : 'Gagal'}</span>${s.dirty.size ? '<span class="dot"><span class="sr-only">ada perubahan belum disimpan</span></span>' : ''}`;
          const box = li.querySelector('input'), btn = li.querySelector('.ws-name');
          box.checked = !!s.checked;
          box.setAttribute('aria-label', 'Pilih ' + s.name);
          box.onchange = () => (s.checked = box.checked);
          btn.textContent = s.name;
          btn.onclick = () => { AJ.current = i; sel = -1; cursor = null; renderList(); open(); };
          return li;
        }));
        $('[data-empty]').hidden = AJ.ws.length > 0;
        $('[data-editor]').hidden = !AJ.ws.length;
      }

      function open() {
        const s = cur();
        if (!s) return;
        $('[data-title]').textContent = s.name + (s.version === 1 ? ' (SOR v1, hanya baca)' : '');
        const save = $('[data-act=save]');
        save.disabled = s.version !== 2;
        save.title = s.version !== 2 ? 'Format SOR v1 hanya bisa dibaca' : '';
        view = TraceChart.fullView(s);
        ab = null;
        $('[data-act=ab]').setAttribute('aria-pressed', 'false');
        renderEvents(); renderGen(); renderPaper(); buttons();
        if (reduced()) { progress = 1; draw(); return; }
        const t0 = performance.now();
        const stepAnim = (t) => { progress = Math.min(1, (t - t0) / 900); draw(); if (progress < 1) requestAnimationFrame(stepAnim); };
        requestAnimationFrame(stepAnim);
      }

      function draw() {
        const s = cur();
        if (!s || !view) return;
        const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
        if (!r.width) return;
        canvas.width = Math.round(r.width * d);
        canvas.height = Math.round(r.height * d);
        ctx.setTransform(d, 0, 0, d, 0, 0);
        TraceChart.draw(ctx, r.width, r.height, s, view, { selected: sel, cursor, ghost, ab, progress, fit: sel >= 0 ? SOR.measureEvent(s, sel) : null });
        renderAB();
      }

      function renderAB() {
        const box = $('[data-ab]');
        box.hidden = !ab;
        if (!ab) return;
        const s = cur(), [a, b] = [...ab].sort((x, y) => x - y);
        const dB = s.trace[SOR.mToIdx(s, a)] - s.trace[SOR.mToIdx(s, b)], dist = b - a;
        box.textContent = `A-B: ${fmt(dist, 1)} m · ${fmt(dB, 3)} dB · ${fmt(dist > 0 ? dB / (dist / 1000) : 0, 3)} dB/km`;
      }

      function renderEvents() {
        const s = cur(), st = SOR.status(s, AJ.thresholds()).events, rows = Report.fields(s).events;
        $('[data-events]').replaceChildren(...s.events.map((e, i) => {
          const tr = document.createElement('tr');
          tr.tabIndex = 0;
          tr.className = (i === sel ? 'sel ' : '') + (st[i] === false ? 'fail' : '');
          for (const t of rows[i]) { const td = document.createElement('td'); td.textContent = t; tr.append(td); }
          if ('AMD'.includes(e.code[1])) tr.children[1].insertAdjacentHTML('beforeend', ' <small>(manual)</small>');
          tr.insertAdjacentHTML('beforeend', `<td><input class="cell"></td><td>${st[i] == null ? '' : st[i] ? '<span class="badge ok">Lulus</span>' : '<span class="badge bad">Gagal</span>'}</td>`);
          const inp = tr.querySelector('input');
          inp.value = e.comment;
          inp.setAttribute('aria-label', `Komentar event ${e.num}`);
          inp.onchange = () => { SOR.setComment(s, i, inp.value); inp.value = s.events[i].comment; renderList(); };
          tr.onclick = (ev) => { if (ev.target !== inp) { select(i, true); zoomTo(i); } };
          tr.onkeydown = (ev) => {
            if (ev.target !== tr) return;
            if (ev.key === 'Enter') { select(i, true); zoomTo(i); }
            if (ev.key === 'Delete') { select(i); del(); }
          };
          return tr;
        }));
      }

      function renderGen() {
        const s = cur(), f = $('[data-gen]');
        f.replaceChildren(...SOR.GEN_FIELDS.map((k) => {
          const l = field(k, LABELS[k], s.gen?.[k], (e) => { SOR.setGen(s, k, e.target.value); e.target.value = s.gen[k]; renderList(); renderPaper(); });
          l.querySelector('input').disabled = !s.gen;
          return l;
        }));
        const meta = document.createElement('p');
        meta.className = 'meta';
        meta.textContent = [[s.sup?.supplier, s.sup?.model].filter(Boolean).join(' '), `${s.fxd.wavelength} nm`, `pulse ${s.pw} ns`, `IOR ${s.ior}`, `resolusi ${fmt(s.dx, 3)} m`].filter(Boolean).join(' · ');
        f.append(meta);
      }

      // Parameters dan Summary dengan teks yang sama persis dengan halaman PDF (report.js).
      function renderPaper() {
        const F = Report.fields(cur(), AJ.store.get('kop', {}));
        const spans = (rows) => rows.flat().map((t) => { const el = document.createElement('span'); el.textContent = t; el.title = t; return el; });
        $('[data-params]').replaceChildren(...spans(F.params));
        $('[data-summ]').replaceChildren(...spans(F.summary));
      }

      function buttons() {
        $('[data-act=add]').disabled = cursor == null;
        $('[data-act=del]').disabled = sel < 0;
      }
      function changed() { renderEvents(); renderPaper(); renderList(); buttons(); draw(); }
      function select(i, focusRow) {
        sel = i;
        buttons(); renderEvents(); draw();
        if (focusRow) $('[data-events]').children[i]?.focus();
      }
      function del() {
        if (sel < 0) return;
        SOR.deleteEvent(cur(), sel);
        sel = -1;
        changed();
      }
      function zoom(m, k) {
        const s = cur();
        let x0 = m - (m - view.x0) * k, x1 = m + (view.x1 - m) * k;
        if (x1 - x0 < s.dx * 20) return;
        x0 = Math.max(0, x0); x1 = Math.min(maxM(), x1);
        view = TraceChart.fitY(s, { x0, x1 });
        draw();
      }
      function pan(dm) {
        const w = view.x1 - view.x0, x0 = Math.min(Math.max(0, view.x0 + dm), maxM() - w);
        view = TraceChart.fitY(cur(), { x0, x1: x0 + w });
        draw();
      }
      function zoomTo(i) {
        const s = cur(), m = SOR.eventM(s, i), w = Math.min(maxM(), Math.max(s.dx * 200, maxM() / 10));
        const x0 = Math.max(0, Math.min(maxM() - w, m - w / 2));
        view = TraceChart.fitY(s, { x0, x1: x0 + w });
        draw();
      }
      function hitEvent(px) {
        const s = cur(), { sc } = geom();
        let best = -1, bd = 8;
        s.events.forEach((_, i) => { const d = Math.abs(sc.X(SOR.eventM(s, i)) - px); if (d < bd) { bd = d; best = i; } });
        return best;
      }
      const hitAB = (px) => (ab ? ab.findIndex((m) => Math.abs(geom().sc.X(m) - px) < 8) : -1);

      canvas.addEventListener('wheel', (e) => {
        if (!cur()) return;
        e.preventDefault();
        const { r, sc } = geom();
        zoom(sc.M(e.clientX - r.left), e.deltaY > 0 ? 1.25 : 0.8);
      }, { passive: false });
      canvas.addEventListener('pointerdown', (e) => {
        if (!cur()) return;
        const { r } = geom(), px = e.clientX - r.left, a = hitAB(px), ev = a < 0 ? hitEvent(px) : -1;
        drag = a >= 0 ? { type: 'ab', i: a } : ev >= 0 ? { type: 'event', i: ev, m: null, x0: e.clientX } : { type: 'pan', x0: e.clientX, last: e.clientX, moved: false };
        if (ev >= 0) select(ev);
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!cur()) return;
        const { r, sc } = geom(), px = e.clientX - r.left;
        if (!drag) { canvas.style.cursor = hitAB(px) >= 0 || hitEvent(px) >= 0 ? 'ew-resize' : 'crosshair'; return; }
        if (drag.type === 'pan') {
          drag.moved = drag.moved || Math.abs(e.clientX - drag.x0) > 3;
          if (drag.moved) pan((-(e.clientX - drag.last) / sc.pw) * (view.x1 - view.x0));
          drag.last = e.clientX;
        } else if (drag.type === 'ab') { ab[drag.i] = clampM(sc.M(px)); draw(); }
        else if (drag.m != null || Math.abs(e.clientX - drag.x0) > 3) { drag.m = clampM(sc.M(px)); ghost = drag.m; draw(); } // klik dengan getaran kecil tidak menggeser event
      });
      canvas.addEventListener('pointercancel', () => { drag = null; ghost = null; draw(); });
      canvas.addEventListener('pointerup', (e) => {
        const d = drag;
        drag = null; ghost = null;
        if (!d || !cur()) return;
        const { r, sc } = geom(), px = e.clientX - r.left;
        if (d.type === 'event' && d.m != null) { sel = SOR.moveEvent(cur(), d.i, d.m); changed(); }
        else if (d.type === 'pan' && !d.moved) { cursor = clampM(sc.M(px)); buttons(); draw(); }
        else draw();
      });
      canvas.addEventListener('keydown', (e) => {
        if (!cur()) return;
        const w = view.x1 - view.x0, mid = (view.x0 + view.x1) / 2;
        const act = { ArrowLeft: () => pan(-w * 0.1), ArrowRight: () => pan(w * 0.1), '+': () => zoom(mid, 0.8), '=': () => zoom(mid, 0.8), '-': () => zoom(mid, 1.25), Delete: del }[e.key];
        if (act) { e.preventDefault(); act(); }
      });

      $('[data-act=add]').onclick = () => { sel = SOR.addEvent(cur(), cursor); cursor = null; changed(); };
      $('[data-act=del]').onclick = del;
      $('[data-act=reset]').onclick = () => { view = TraceChart.fullView(cur()); draw(); };
      $('[data-act=zin]').onclick = () => zoom((view.x0 + view.x1) / 2, 0.8);
      $('[data-act=zout]').onclick = () => zoom((view.x0 + view.x1) / 2, 1.25);
      $('[data-act=ab]').onclick = (e) => {
        const w = view.x1 - view.x0;
        ab = ab ? null : [view.x0 + w / 3, view.x0 + (2 * w) / 3];
        e.currentTarget.setAttribute('aria-pressed', String(!!ab));
        draw();
      };

      const thrForm = $('[data-thr]'), thr = AJ.thresholds();
      for (const k in thr) thrForm.elements[k].value = thr[k];
      thrForm.oninput = () => {
        const t = {};
        for (const k in thr) t[k] = parseFloat(thrForm.elements[k].value);
        if (Object.values(t).every(Number.isFinite)) { AJ.store.set('thr', t); if (cur()) changed(); }
      };

      const dlg = $('[data-bulk]');
      $('[data-bulk-fields]').replaceChildren(...SOR.GEN_FIELDS.map((k) => field(k, LABELS[k], '')));
      $('[data-act=bulk]').onclick = () => {
        if (!AJ.ws.some((s) => s.checked)) { AJ.toast('Centang dulu file yang ingin diedit', 'warn'); return; }
        dlg.returnValue = ''; // Esc menutup tanpa mengubah returnValue, jadi nilai 'ok' sebelumnya harus dihapus
        dlg.showModal();
      };
      dlg.addEventListener('close', () => {
        const form = dlg.querySelector('form');
        if (dlg.returnValue === 'ok') {
          const picked = AJ.ws.filter((s) => s.checked);
          let n = 0;
          picked.forEach((s, idx) => {
            if (!s.gen) return;
            for (const k of SOR.GEN_FIELDS) { const v = form.elements[k].value; if (v) SOR.setGen(s, k, v.replaceAll('{n}', String(idx + 1))); }
            n++;
          });
          AJ.toast(`${n} file diperbarui`, 'ok');
          renderList();
          if (cur()) { renderGen(); renderPaper(); }
        }
        form.reset();
      });
      $('[data-act=all]').onchange = (e) => { AJ.ws.forEach((s) => (s.checked = e.target.checked)); renderList(); };

      // Setelah disimpan, file dibaca ulang dari hasil tulis supaya workspace sama dengan file di disk.
      const reload = (i, out) => { AJ.ws[i] = Object.assign(SOR.parse(out, AJ.ws[i].name), { checked: AJ.ws[i].checked }); };
      $('[data-act=save]').onclick = () => {
        const s = cur();
        if (!s) return;
        try {
          const out = SOR.write(s);
          AJ.download(new Blob([out]), s.name);
          reload(AJ.current, out);
          sel = -1;
          renderList(); open();
        } catch (e) { AJ.toast(`${s.name}: ${e.message}`, 'error'); }
      };
      $('[data-act=saveall]').onclick = async () => {
        if (!AJ.ws.length) return;
        const z = new JSZip();
        let n = 0;
        AJ.ws.forEach((s, i) => {
          try { const out = SOR.write(s); z.file(s.name, out); reload(i, out); n++; }
          catch (e) { AJ.toast(`${s.name}: ${e.message}, dilewati`, 'warn'); }
        });
        if (n) AJ.download(await z.generateAsync({ type: 'blob' }), 'SOR_AJAIB.zip');
        sel = -1;
        renderList(); open();
      };

      const onResize = () => draw();
      window.addEventListener('resize', onResize);
      renderList();
      if (AJ.ws.length) open();
      return () => window.removeEventListener('resize', onResize);
    },
  };
})();
