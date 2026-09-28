/* Halaman SOR ke PDF: satu halaman "OTDR Report" per file SOR (tata letak di report.js). */
(function () {
  'use strict';

  AJ.pages.pdf = {
    mount(root) {
      const $ = (s) => root.querySelector(s), form = $('[data-kop]');
      const kop = AJ.store.get('kop', {});
      form.elements.customer.value = kop.customer ?? kop.company ?? '';
      form.elements.job.value = kop.job ?? kop.project ?? '';
      const save = () => AJ.store.set('kop', { customer: form.elements.customer.value, job: form.elements.job.value });
      form.elements.customer.oninput = save;
      form.elements.job.oninput = save;

      const refresh = () => { AJ.countUp($('[data-count]'), AJ.ws.length); $('[data-act=pdf]').disabled = !AJ.ws.length; };
      AJ.drop($('[data-drop]'), async (files) => { await AJ.loadSor(files); refresh(); });
      refresh();

      $('[data-act=pdf]').onclick = async () => {
        const fontsReady = Report.loadFonts(); // dipanggil paling awal, selagi klik pengguna masih berlaku untuk izin akses font
        const btn = $('[data-act=pdf]'), bar = $('.progress'), total = AJ.ws.length;
        const kopNow = { customer: form.elements.customer.value, job: form.elements.job.value };
        btn.disabled = true;
        bar.hidden = false;
        try {
          const fonts = await fontsReady;
          if (!fonts) AJ.toast('Font Segoe UI tidak bisa dipakai (izin akses font ditolak atau browser tidak mendukung), PDF memakai Helvetica', 'warn');
          const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
          const font = Report.useFonts(doc, fonts);
          for (let i = 0; i < total; i++) {
            $('[data-prog]').textContent = `Memproses ${i + 1} dari ${total}`;
            bar.style.setProperty('--p', (i + 1) / total);
            // Beri kesempatan browser menggambar progress. Saat tab tersembunyi timer diperlambat sampai >1 s, jadi lewati saja.
            if (!document.hidden) await new Promise((r) => setTimeout(r));
            if (i) doc.addPage();
            Report.page(doc, AJ.ws[i], kopNow, font);
          }
          doc.save(`Laporan_OTDR_${new Date().toISOString().slice(0, 10)}.pdf`);
          AJ.toast(`PDF ${total} halaman selesai dibuat`, 'ok');
        } catch (e) {
          AJ.toast(`PDF gagal dibuat: ${e.message}`, 'error');
        } finally {
          btn.disabled = false;
          bar.hidden = true;
        }
      };
    },
  };
})();
