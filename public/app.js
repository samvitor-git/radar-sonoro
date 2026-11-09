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

  // Abre um .zip no próprio navegador e devolve os CSVs de dentro dele.
  async function csvsFromZip(file) {
    const buf = await file.arrayBuffer();
    const v = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Não consegui abrir o zip.');
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const out = [];
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nl));
      p += 46 + nl + el + cl;
      if (!/\.csv$/i.test(name)) continue;
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = new Uint8Array(buf, start, size);
      const text = method === 0 ? dec.decode(data)
        : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      out.push({name, text});
    }
    return out;
  }

  document.getElementById('app-file').addEventListener('change', async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = '';
    if (!files.length) return;
    btn.disabled = true;
    try {
      const csvs = [];
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) csvs.push(...await csvsFromZip(f));
        else csvs.push({name: f.name, text: await f.text()});
      }
      let faixas = 0, artistas = 0;
      for (let i = 0; i < csvs.length; i++) {
        say(`Importando exportação (${i + 1} de ${csvs.length})…`);
        const res = await fetch('/api/import', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-Requested-With': 'radar'}, body: JSON.stringify(csvs[i])});
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).erro || 'falha ao enviar ' + csvs[i].name);
        const r = await res.json();
        faixas += r.faixas || 0; artistas += r.artistas || 0;
      }
      say(`Importado: dados de áudio de ${faixas} faixas e gêneros de ${artistas} artistas. Atualizando…`);
      const s = await fetch('/api/sync', {method: 'POST', credentials: 'same-origin', headers: {'X-Requested-With': 'radar'}});
      if (s.ok) watch(); else btn.disabled = false;
    } catch (err) {
      btn.disabled = false;
      say('A importação falhou: ' + err.message, true);
    }
  });

  load().then(async (loaded) => {
    const s = await (await fetch('/api/status', {credentials: 'same-origin'})).json();
    if (s.running) watch();
    else if (s.error) say('A última atualização falhou: ' + s.error, true);
    else if (!loaded) say('Ainda não há dados. Clique em Atualizar com Spotify.');
  }).catch(() => { say('Não consegui carregar os dados.', true); dash.fail(); });
})();
