// Carrega os dados, liga o botão de sincronizar e mostra o andamento.
(function () {
  const statusEl = document.getElementById('app-status');
  const btn = document.getElementById('app-sync');
  const fmt = (iso) => new Date(iso).toLocaleString('pt-BR', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'});
  const say = (text, err) => { statusEl.textContent = text; statusEl.classList.toggle('err', !!err); };

  const erro = new URLSearchParams(location.search).get('erro');
  if (erro) say(erro, true);

  async function load() {
    const res = await fetch('/api/data', {credentials: 'same-origin'});
    if (res.status === 401) { location.href = '/'; return false; }
    if (res.status === 404) { say('Preparando seus dados pela primeira vez…'); return false; }
    if (!res.ok) { say('Não consegui carregar os dados.', true); dash.fail(); return false; }
    const data = await res.json();
    dash.load(data);
    if (!erro) say('Atualizado em ' + fmt(data.meta[0].atualizado_em));
    return true;
  }

  async function watch() {
    btn.disabled = true;
    for (;;) {
      const s = await (await fetch('/api/status', {credentials: 'same-origin'})).json();
      if (!s.running) {
        btn.disabled = false;
        if (s.error) { say('A atualização falhou: ' + s.error, true); return; }
        await load();
        return;
      }
      say(s.step || 'Atualizando…');
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    say('Começando…');
    const res = await fetch('/api/sync', {method: 'POST', credentials: 'same-origin', headers: {'X-Requested-With': 'radar'}});
    if (!res.ok) { btn.disabled = false; say('Não consegui começar a atualização.', true); return; }
    watch();
  });

  load().then(async (loaded) => {
    const s = await (await fetch('/api/status', {credentials: 'same-origin'})).json();
    if (s.running) watch();
    else if (s.error) say('A última atualização falhou: ' + s.error, true);
    else if (!loaded) say('Ainda não há dados. Clique em Atualizar com Spotify.');
  }).catch(() => { say('Não consegui carregar os dados.', true); dash.fail(); });
})();
