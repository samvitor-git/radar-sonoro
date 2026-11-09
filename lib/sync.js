// Busca a biblioteca no Spotify, completa com dados de áudio do ReccoBeats e monta os dados da dashboard.
const sp = require('./spotify');
const store = require('./store');
const {familia, excluida} = require('./classify');
const genresLib = require('./genres');
const recomendacoesBase = require('../seed/recomendacoes.json');

const AUTO_PLAYLIST = /discover weekly|release radar|daily mix|your top songs|mais tocadas|on repeat|repeat rewind|time capsule|daylist/i;
const RECCO = 'https://api.reccobeats.com/v1/audio-features';
const status = {running: false, step: '', error: '', finished_at: null};

const day = (iso) => String(iso || '').slice(0, 10);
const monthsAgo = (n) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
const pickImage = (images) => {
  if (!images || !images.length) return '';
  const sorted = images.slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= 160) || sorted[sorted.length - 1]).url;
};
const step = (s) => { status.step = s; console.log('[sync]', s); };

async function audioFeatures(ids) {
  const cache = store.read('features', {});
  const retryAfter = Date.now() - 14 * 864e5;
  const todo = ids.filter((id) => !cache[id] || (cache[id].miss && cache[id].at < retryAfter));
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    step(`Buscando energia e humor (${Math.min(i + 20, todo.length)} de ${todo.length})`);
    try {
      let res = await fetch(`${RECCO}?ids=${batch.join(',')}`, {headers: {Accept: 'application/json', 'User-Agent': genresLib.UA}});
      if (res.status === 429) { await sp.sleep((Number(res.headers.get('retry-after')) || 5) * 1000); res = await fetch(`${RECCO}?ids=${batch.join(',')}`, {headers: {Accept: 'application/json', 'User-Agent': genresLib.UA}}); }
      if (!res.ok) console.warn('[reccobeats]', res.status);
      if (res.ok) {
        const body = await res.json();
        const found = new Set();
        for (const c of body.content || []) {
          const id = String(c.href || '').split('/').pop();
          found.add(id);
          cache[id] = {e: c.energy, v: c.valence, d: c.danceability, a: c.acousticness, t: c.tempo};
        }
        for (const id of batch) if (!found.has(id)) cache[id] = {miss: true, at: Date.now()};
      }
    } catch (err) { console.warn('[reccobeats]', err.message); }
    await sp.sleep(800);
  }
  store.write('features', cache);
  return cache;
}

// Fotos de artistas (a busca em lote foi removida do modo de desenvolvimento; uma por vez, com cache).
async function artistImages(ids) {
  const cache = store.read('artist_images', {});
  for (const id of ids) {
    if (cache[id] && Date.now() - cache[id].at < 30 * 864e5) continue;
    const a = await sp.get(`/artists/${id}`, {optional: true});
    cache[id] = {img: a ? pickImage(a.images) : '', at: Date.now()};
  }
  store.write('artist_images', cache);
  return cache;
}

// Desde fev/2026 a faixa vem em `item` (e `track` virou um booleano) em /playlists/{id}/items.
async function playlistItems(id) {
  let items = await sp.all(`/playlists/${id}/items?limit=50`, {optional: true});
  if (!items.length) items = await sp.all(`/playlists/${id}/tracks?limit=50`, {optional: true});
  return items.map((it) => ({...it, track: it.item && typeof it.item === 'object' ? it.item : (it.track && typeof it.track === 'object' ? it.track : null)}));
}

async function pollRecentlyPlayed() {
  try {
    const res = await sp.get('/me/player/recently-played?limit=50', {optional: true});
    if (!res) return 0;
    const plays = store.read('plays', {});
    let added = 0;
    for (const it of res.items || []) {
      if (!it.track || plays[it.played_at]) continue;
      plays[it.played_at] = {id: it.track.id, faixa: it.track.name, artista: (it.track.artists || []).map((a) => a.name).join(', '), ms: it.track.duration_ms};
      added++;
    }
    if (added) store.write('plays', plays);
    const meta = store.read('plays_meta', {});
    if (!meta.desde) { meta.desde = new Date().toISOString(); store.write('plays_meta', meta); }
    return added;
  } catch (err) {
    if (err.code !== 'NO_TOKEN') console.warn('[plays]', err.message);
    return 0;
  }
}

async function run() {
  if (status.running) return;
  Object.assign(status, {running: true, error: '', step: 'Começando'});
  try {
    step('Lendo sua conta');
    const me = await sp.get('/me');
    const entries = [];
    const push = (track, added_at, fonte, album) => {
      if (!track || track.is_local || (track.type && track.type !== 'track') || !track.id) return;
      entries.push({track: album ? {...track, album} : track, added_at, fonte});
    };

    step('Lendo suas músicas curtidas');
    for (const it of await sp.all('/me/tracks?limit=50', {onPage: (n, t) => step(`Lendo suas músicas curtidas (${n} de ${t})`)})) push(it.track, it.added_at, 'Curtidas');

    step('Lendo seus álbuns salvos');
    for (const it of await sp.all('/me/albums?limit=50', {optional: true})) {
      const al = it.album; if (!al) continue;
      let tracks = (al.tracks && al.tracks.items) || [];
      if (al.tracks && al.tracks.next) tracks = tracks.concat(await sp.all(al.tracks.next, {optional: true}));
      const album = {id: al.id, name: al.name, release_date: al.release_date, images: al.images};
      for (const t of tracks) push(t, it.added_at, 'Álbuns salvos', album);
    }

    step('Lendo suas playlists');
    const pls = (await sp.all('/me/playlists?limit=50')).filter((p) => p && p.owner && p.owner.id === me.id && !AUTO_PLAYLIST.test(p.name));
    let n = 0;
    for (const p of pls) {
      step(`Lendo suas playlists (${++n} de ${pls.length}: ${p.name})`);
      for (const it of await playlistItems(p.id)) {
        if (it.added_by && it.added_by.id && it.added_by.id !== me.id) continue;
        push(it.track, it.added_at, 'Playlist: ' + p.name);
      }
    }

    step('Organizando a biblioteca');
    const desde = monthsAgo(13);
    const estreia = new Map();
    const byTrack = new Map();
    const libraryArtists = new Map();
    for (const e of entries) {
      const d = day(e.added_at); if (!d.startsWith('20')) continue;
      const a0 = (e.track.artists || [])[0];
      if (a0) {
        if (!estreia.has(a0.name) || d < estreia.get(a0.name)) estreia.set(a0.name, d);
        for (const a of e.track.artists) libraryArtists.set(a.name.toLowerCase(), (libraryArtists.get(a.name.toLowerCase()) || 0) + 1);
      }
      if (d <= desde) continue;
      const cur = byTrack.get(e.track.id);
      if (!cur || d < day(cur.added_at)) byTrack.set(e.track.id, e);
    }

    const recIds = recomendacoesBase.map((r) => r.link.split('/').pop());
    step('Buscando fotos dos artistas sugeridos');
    const images = await artistImages(recIds);
    const firstNames = [...new Set([...byTrack.values()].map((e) => (e.track.artists || [])[0]).filter(Boolean).map((a) => a.name))];
    step('Buscando gêneros dos artistas');
    const gen = await genresLib.forArtists(firstNames, {onProgress: (i, t) => step(`Buscando gêneros dos artistas no MusicBrainz (${i} de ${t})`)});

    const features = await audioFeatures([...byTrack.keys()]);

    step('Buscando suas mais ouvidas');
    const topT = await sp.get('/me/top/tracks?time_range=short_term&limit=10', {optional: true});
    const topA = await sp.get('/me/top/artists?time_range=short_term&limit=10', {optional: true});
    await pollRecentlyPlayed();

    step('Montando a dashboard');
    const capas = new Map();
    const setCapa = (k, url) => { if (url && !capas.has(k)) capas.set(k, url); };
    const faixas = [];
    for (const e of byTrack.values()) {
      const t = e.track; const a0 = t.artists[0];
      const gi = gen[a0.name] || {g: [], src: 'none'};
      const genres = gi.g || [];
      if (excluida(t.artists.map((a) => a.name), genres)) continue;
      const f = features[t.id] && !features[t.id].miss ? features[t.id] : null;
      const fam = familia(a0.name, genres, gi.src);
      const capa = `${t.album.name} — ${a0.name}`;
      setCapa('album|' + capa, pickImage(t.album.images));
      const r = (x) => (x == null ? '' : Math.round(x * 1000) / 1000);
      faixas.push({
        faixa: t.name, artista: t.artists.map((a) => a.name).join(', '), album: t.album.name, capa, fonte: e.fonte,
        data: day(e.added_at), mes: day(e.added_at).slice(0, 7), lancamento: Number(String(t.album.release_date || '').slice(0, 4)) || '',
        familia: fam.familia, generos: genres.slice(0, 3).join(', '), classificacao: fam.classificacao,
        energia: f ? r(f.e) : '', valencia: f ? r(f.v) : '', dancabilidade: f ? r(f.d) : '', acustica: f ? r(f.a) : '', bpm: f ? Math.round(f.t) : '',
        popularidade: t.popularity == null ? '' : t.popularity, link: `https://open.spotify.com/track/${t.id}`,
        duracao_ms: t.duration_ms || '', artista_estreia: estreia.get(a0.name) || day(e.added_at),
      });
    }

    const recomendacoes = recomendacoesBase.map((r) => {
      const id = r.link.split('/').pop();
      setCapa('artista|' + r.artista, (images[id] || {}).img);
      const vezes = libraryArtists.get(r.artista.toLowerCase()) || 0;
      return {...r, vezes_na_biblioteca: vezes, status: vezes ? 'Já passou pelo seu radar' : 'Novo para você'};
    });

    const mais_ouvidas = ((topT && topT.items) || []).map((t, i) => {
      setCapa('uri|' + t.uri, pickImage(t.album && t.album.images));
      return {posicao: i + 1, faixa: t.name, artista: t.artists.map((a) => a.name).join(', '), album: t.album ? t.album.name : '', uri: t.uri, link: `https://open.spotify.com/track/${t.id}`};
    });
    const artistas_mais_ouvidos = ((topA && topA.items) || []).map((a, i) => {
      setCapa('uri|' + a.uri, pickImage(a.images));
      return {posicao: i + 1, artista: a.name, uri: a.uri, link: `https://open.spotify.com/artist/${a.id}`};
    });

    store.write('dashboard', {
      usuario: me.display_name || me.id,
      atualizado_em: new Date().toISOString(),
      faixas, recomendacoes, mais_ouvidas, artistas_mais_ouvidos,
      capas: [...capas].map(([k, img]) => { const i = k.indexOf('|'); return {tipo: k.slice(0, i), chave: k.slice(i + 1), img}; }),
    });
    status.finished_at = new Date().toISOString();
    step('Pronto');
  } catch (err) {
    console.error('[sync]', err);
    status.error = err.message;
    step('Falhou');
  } finally {
    status.running = false;
  }
}

// O que a página recebe: a última sincronização mais o histórico de escuta guardado aqui.
function dashboardData() {
  const d = store.read('dashboard', null);
  if (!d) return null;
  const plays = store.read('plays', {});
  const desde = monthsAgo(13);
  const rows = Object.entries(plays).filter(([at]) => day(at) > desde).map(([at, p]) => ({data: day(at), ms: p.ms || 0, faixa: p.faixa, artista: p.artista}));
  const pm = store.read('plays_meta', {});
  return {
    ...d,
    meta: [{agora: new Date().toISOString().slice(0, 10), atualizado_em: d.atualizado_em, usuario: d.usuario, escuta_desde: day(pm.desde)}],
    plays: rows,
  };
}

module.exports = {run, status, pollRecentlyPlayed, dashboardData};
