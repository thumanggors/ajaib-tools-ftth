/* AJAIB TOOLS: shell aplikasi. Router hash, toast, upload, penyimpanan lokal, workspace SOR bersama. */
(function () {
  'use strict';
  const AJ = (window.AJ = { pages: { home: {} }, ws: [], current: 0 });
  const $ = (s) => document.querySelector(s);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  AJ.store = {
    get(key, def) { try { const v = localStorage.getItem('aj.' + key); return v == null ? def : JSON.parse(v); } catch { return def; } },
    set(key, val) { try { localStorage.setItem('aj.' + key, JSON.stringify(val)); } catch { AJ.toast('Pengaturan tidak bisa disimpan di browser ini', 'warn'); } },
  };

  AJ.toast = (msg, type = 'info') => {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    $('#toasts').append(el);
    setTimeout(() => el.classList.add('out'), 4500);
    setTimeout(() => el.remove(), 4800);
  };

  AJ.download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  AJ.drop = (el, onFiles) => {
    const input = el.querySelector('input[type=file]');
    input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('over');
      el.classList.add('pulse');
      setTimeout(() => el.classList.remove('pulse'), 600);
      if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
    });
  };

  AJ.countUp = (el, value, digits = 0) => {
    const fmt = (v) => v.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    if (reduced()) { el.textContent = fmt(value); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 700);
      el.textContent = fmt(value * (1 - (1 - k) ** 3));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  AJ.loadSor = async (files) => {
    let added = 0;
    for (const f of files) {
      try {
        const sor = SOR.parse(await f.arrayBuffer(), f.name);
        AJ.ws.push(sor);
        added++;
        for (const w of sor.warnings) AJ.toast(`${f.name}: ${w}`, 'warn');
      } catch (e) {
        AJ.toast(`${f.name}: ${e.message}`, 'error');
      }
    }
    if (added) AJ.toast(`${added} file SOR dimuat`, 'ok');
    return added;
  };

  AJ.thresholds = () => AJ.store.get('thr', { splice: 0.1, connector: 0.5, refl: -35 });

  let cleanup = null;
  function route() {
    const name = location.hash.replace(/^#\/?/, '');
    const page = AJ.pages[name] ? name : 'home';
    const render = () => {
      if (cleanup) cleanup();
      const view = $('#view');
      view.replaceChildren($('#tpl-' + page).content.cloneNode(true));
      for (const a of document.querySelectorAll('.nav a[data-route]')) {
        if (a.dataset.route === (page === 'home' ? '' : page)) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
      cleanup = (AJ.pages[page].mount && AJ.pages[page].mount(view)) || null;
      view.focus({ preventScroll: true });
    };
    // Transisi yang dibatalkan browser (tab tersembunyi, navigasi cepat) cukup diabaikan; render tetap jalan.
    if (document.startViewTransition && !reduced()) document.startViewTransition(render).ready.catch(() => {});
    else render();
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('DOMContentLoaded', () => {
    $('#theme').addEventListener('click', () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t;
      AJ.store.set('theme', t);
      window.dispatchEvent(new Event('themechange'));
    });
    route();
  });
})();
