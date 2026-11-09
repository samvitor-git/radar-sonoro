// Recria, fora do Claude, a pequena API `dash` que a página usa: dados, cálculos, desenhos e filtros.
(function () {
  const datasets = {};
  const calcs = [];
  const draws = new Map();
  const listeners = [];
  let params = {periodo: '12'};
  let state = 'loading';

  const status = (id) => (datasets[id] ? 'ok' : state === 'error' ? 'error' : 'loading');

  function computeCalcs() {
    const pending = calcs.slice();
    let guard = pending.length + 1;
    while (pending.length && guard-- > 0) {
      for (let i = 0; i < pending.length; i++) {
        const c = pending[i];
        if (!c.inputs.every((k) => datasets[k])) continue;
        try { datasets[c.id] = c.fn(...c.inputs.map((k) => datasets[k])); } catch (err) { console.error('Cálculo', c.id, err); datasets[c.id] = []; }
        pending.splice(i--, 1);
      }
    }
  }

  function runDraw(name) {
    const fn = draws.get(name);
    if (!fn) return;
    document.querySelectorAll(`[data-draw="${name}"]`).forEach((el) => {
      if (el.closest('[hidden]')) return;
      try { fn(el); } catch (err) { console.error('Desenho', name, err); }
    });
  }

  function redraw() {
    listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
    draws.forEach((_, name) => runDraw(name));
  }

  window.dash = {
    colors: ['#e4572e', '#2e86ab', '#8f5cc2', '#f2a541', '#3bb273', '#c2410c', '#d6336c', '#5b6c8f'],
    data: (id) => ({status: status(id), data: datasets[id] || [], message: '', refreshing: false, meta: []}),
    calc: (id, def) => calcs.push({id, ...def}),
    loader: () => {},
    onData: (fn) => { listeners.push(fn); if (state !== 'loading') fn(); },
    draw: (name, fn) => {
      if (typeof fn === 'function') draws.set(name, fn);
      else if (fn && typeof fn === 'object' && fn.update) draws.set(name, (el) => fn.update(el, fn.mount ? fn.mount(el) : undefined));
      if (state !== 'loading' || !fn) runDraw(name);
    },
    params: () => ({...params}),
    setParams: (p) => { params = {...params, ...p}; redraw(); },
    resetParams: () => { params = {periodo: '12'}; redraw(); },
    setLink: (id) => { try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ } },
    refresh: () => {},
    load(payload) {
      Object.keys(datasets).forEach((k) => delete datasets[k]);
      Object.assign(datasets, payload);
      computeCalcs();
      state = 'ok';
      redraw();
    },
    fail() { state = 'error'; redraw(); },
  };

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redraw, 150); });
})();
