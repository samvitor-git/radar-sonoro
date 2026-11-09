// Motor de sugestões: parte do que você ouve, reforça o que você marcou como "Gostei",
// conta "Médio" com peso normal e afasta o que você marcou como "Não gostei".
// Os vizinhos de cada artista vêm da API pública do Deezer (artistas relacionados);
// link e foto vêm do Spotify quando possível.
const store = require('./store');
const sp = require('./spotify');
const {familia} = require('./classify');

const DEEZER = 'https://api.deezer.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Pesos: o que você ouve é a base; avaliações mudam o rumo.
const PESO = {ouvindo: 1, gostei: 3, medio: 1, nao: -2.5};
// Vertentes que você disse querer explorar recebem um empurrão; as demais continuam valendo, com menos força.
const FOCO = {
  'Nu metal e metalcore': 1.4, 'J-Rock e anime': 1.4, 'Hard rock e clássicos': 1.3, 'Emo': 1.15, 'Punk e pop-punk': 1.2, 'Rock alternativo': 1.2,
  'Rock brasileiro': 0.45, 'MPB e outros brasileiros': 0.3, 'Pop': 0.45, 'Trilhas e instrumental': 0.25, 'Sem gênero': 0.8,
};
const CATEGORIA = {
  'Nu metal e metalcore': 'Nu metal e metalcore', 'Emo': 'Emocore', 'Punk e pop-punk': 'Punk e pop-punk',
  'J-Rock e anime': 'J-Rock e anime', 'Hard rock e clássicos': 'Clássicos 70, 80 e 90',
  'Rock alternativo': 'Rock alternativo e hard rock', 'Rock brasileiro': 'Rock brasileiro',
};
// Para artistas avaliados sem gênero conhecido: a categoria da sugestão diz a vertente.
const FAMILIA_DA_CATEGORIA = Object.fromEntries(Object.entries(CATEGORIA).map(([f, c]) => [c, f]));
FAMILIA_DA_CATEGORIA['Rock alternativo e hard rock'] = 'Rock alternativo';
const EXCLUIR = [/djonga/i, /jamie cullum/i];

let lastDeezer = 0;
async function deezer(path) {
  const wait = lastDeezer + 120 - Date.now();
  if (wait > 0) await sleep(wait);
  lastDeezer = Date.now();
  try {
    const res = await fetch(DEEZER + path, {headers: {Accept: 'application/json'}});
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return body && !body.error ? body : null;
  } catch (err) {
    console.warn('[deezer]', path, err.message);
    return null;
  }
}

// Acha o artista no Deezer pelo nome exato, preferindo o de mais fãs.
async function deezerArtist(name, cache) {
  const k = norm(name);
  if (cache.ids[k] !== undefined) return cache.ids[k];
  const r = await deezer(`/search/artist?q=${encodeURIComponent(name)}&limit=10`);
  const hits = ((r && r.data) || []).filter((a) => norm(a.name) === k).sort((a, b) => b.nb_fan - a.nb_fan);
  cache.ids[k] = hits.length ? hits[0].id : null;
  return cache.ids[k];
}

async function related(id, cache) {
  const hit = cache.related[id];
  if (hit && Date.now() - hit.at < 30 * 864e5) return hit.list;
  const r = await deezer(`/artist/${id}/related?limit=25`);
  const list = ((r && r.data) || []).map((a) => ({id: a.id, nome: a.name, fas: a.nb_fan, foto: a.picture_medium}));
  cache.related[id] = {list, at: Date.now()};
  return list;
}

async function topTrack(id) {
  const r = await deezer(`/artist/${id}/top?limit=1`);
  const t = r && r.data && r.data[0];
  return t ? t.title : '';
}

async function spotifyArtist(name) {
  let r = null;
  try { r = await sp.get(`/search?q=${encodeURIComponent(name)}&type=artist&limit=5`, {optional: true}); } catch { return null; }
  const items = (r && r.artists && r.artists.items) || [];
  const a = items.find((x) => norm(x.name) === norm(name));
  if (!a) return null;
  const img = (a.images || []).slice().sort((x, y) => (x.width || 0) - (y.width || 0)).find((i) => (i.width || 0) >= 160);
  return {link: `https://open.spotify.com/artist/${a.id}`, img: img ? img.url : ((a.images || [])[0] || {}).url || ''};
}

const status = {running: false, step: '', error: '', finished_at: null};

// Monta as sementes: artistas que você ouve e artistas que você avaliou.
function seeds() {
  const d = store.read('dashboard', null) || {};
  const genres = store.read('genres', {});
  const fb = store.read('feedback', {});
  const famOf = (name) => {
    const g = genres[norm(name)] || {g: [], src: 'none'};
    return familia(name, g.g || [], g.src).familia;
  };
  const w = new Map();
  const add = (name, peso, motivo, categoria) => {
    if (!name || EXCLUIR.some((r) => r.test(name))) return;
    const k = norm(name);
    let fam = famOf(name);
    if (fam === 'Sem gênero' && categoria && FAMILIA_DA_CATEGORIA[categoria]) fam = FAMILIA_DA_CATEGORIA[categoria];
    const cur = w.get(k) || {nome: name, peso: 0, motivos: new Set(), familia: fam};
    cur.peso += peso; cur.motivos.add(motivo);
    w.set(k, cur);
  };
  // O que você ouve agora (mais ouvidos do Spotify) e o que entrou nos últimos 6 meses.
  (d.artistas_mais_ouvidos || []).forEach((a, i) => add(a.artista, PESO.ouvindo * (1.6 - i * 0.08), 'ouvindo'));
  const desde = new Date(Date.now() - 183 * 864e5).toISOString().slice(0, 10);
  const conta = {};
  for (const f of d.faixas || []) if (f.data > desde) { const a = f.artista.split(', ')[0]; conta[a] = (conta[a] || 0) + 1; }
  for (const [a, n] of Object.entries(conta)) add(a, PESO.ouvindo * Math.min(1.5, 0.4 + Math.log2(1 + n) * 0.35), 'biblioteca');
  // Suas avaliações.
  for (const v of Object.values(fb)) add(v.artista, PESO[v.nota] || 0, v.nota, v.categoria);
  // O foco por vertente vale para o que você ouve; avaliações entram com o peso que você deu.
  for (const s of w.values()) {
    if (s.peso <= 0) continue;
    const doFeedback = s.motivos.has('gostei') || s.motivos.has('medio');
    s.peso *= doFeedback ? Math.max(1, FOCO[s.familia] || 1) : (FOCO[s.familia] || 1);
  }
  return [...w.values()];
}

async function generate({quantos = 30} = {}) {
  if (status.running) return;
  Object.assign(status, {running: true, error: '', step: 'Começando'});
  try {
    const cache = store.read('deezer_cache', {ids: {}, related: {}});
    const fb = store.read('feedback', {});
    const library = store.read('library_artists', {});
    const all = seeds();
    const positivos = all.filter((s) => s.peso > 0).sort((a, b) => b.peso - a.peso).slice(0, 30);
    const negativos = all.filter((s) => s.peso < 0);
    const avaliados = new Set(Object.keys(fb));
    const conhecidos = new Set([...all.map((s) => norm(s.nome)), ...avaliados]);

    const cand = new Map();
    let n = 0;
    for (const s of [...positivos, ...negativos]) {
      status.step = `Procurando artistas parecidos (${++n} de ${positivos.length + negativos.length}): ${s.nome}`;
      const id = await deezerArtist(s.nome, cache);
      if (!id) continue;
      const lista = await related(id, cache);
      lista.forEach((a, rank) => {
        const k = norm(a.nome);
        if (conhecidos.has(k) || (library[k] || 0) >= 3 || EXCLUIR.some((r) => r.test(a.nome))) return;
        const proximidade = 1 / (1 + rank * 0.12);
        const c = cand.get(k) || {nome: a.nome, deezer: a.id, fas: a.fas, foto: a.foto, score: 0, pontes: []};
        c.score += s.peso * proximidade;
        if (s.peso > 0) c.pontes.push({nome: s.nome, contrib: s.peso * proximidade, familia: s.familia});
        cand.set(k, c);
      });
    }
    store.write('deezer_cache', cache);

    // Bandas menores ganham um pouco, já que você gosta de descobrir artistas novos.
    for (const c of cand.values()) {
      if (c.fas < 300000) c.score *= 1.12;
      if (library[norm(c.nome)]) c.score *= 0.6;
    }
    const ordem = [...cand.values()].filter((c) => c.score > 0 && c.pontes.length).sort((a, b) => b.score - a.score);
    // Variedade: no máximo 3 sugestões vindas da mesma ponte principal.
    const porPonte = {};
    const escolhidos = [];
    for (const c of ordem) {
      c.pontes.sort((a, b) => b.contrib - a.contrib);
      const p = norm(c.pontes[0].nome);
      if ((porPonte[p] || 0) >= 3) continue;
      porPonte[p] = (porPonte[p] || 0) + 1;
      escolhidos.push(c);
      if (escolhidos.length >= quantos) break;
    }

    const itens = [];
    let i = 0;
    for (const c of escolhidos) {
      status.step = `Preparando as sugestões (${++i} de ${escolhidos.length})`;
      const spa = await spotifyArtist(c.nome);
      const faixa = await topTrack(c.deezer);
      const pontes = [...new Set(c.pontes.map((p) => p.nome))].slice(0, 2);
      const vezes = library[norm(c.nome)] || 0;
      itens.push({
        categoria: CATEGORIA[c.pontes[0].familia] || 'Outros',
        artista: c.nome,
        estilo: `Parecido com ${pontes.join(' e ')}`,
        status: vezes ? 'Já passou pelo seu radar' : 'Novo para você',
        vezes_na_biblioteca: vezes,
        ponte: pontes[0],
        origem: 'Motor de sugestões',
        faixa_de_entrada: faixa,
        link: spa ? spa.link : `https://open.spotify.com/search/${encodeURIComponent(c.nome)}`,
        link_faixa: faixa ? `https://open.spotify.com/search/${encodeURIComponent(c.nome + ' ' + faixa)}` : '',
        foto: (spa && spa.img) || c.foto || '',
        pontuacao: Math.round(c.score * 100) / 100,
      });
    }
    store.write('recs', {gerado_em: new Date().toISOString(), itens});
    status.finished_at = new Date().toISOString();
    status.step = 'Pronto';
  } catch (err) {
    console.error('[sugestões]', err);
    status.error = err.message;
    status.step = 'Falhou';
  } finally {
    status.running = false;
  }
}

function rate(artista, nota, extra = {}) {
  const fb = store.read('feedback', {});
  const k = norm(artista);
  if (!nota) delete fb[k];
  else fb[k] = {...(fb[k] || {}), ...extra, artista, nota, em: new Date().toISOString()};
  store.write('feedback', fb);
}

module.exports = {generate, rate, status, norm};
