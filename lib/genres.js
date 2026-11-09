// Gêneros por artista. O Spotify deixou de informar gêneros para apps em modo de desenvolvimento,
// então eles vêm da exportação do Exportify (quando importada) e, na falta dela, do MusicBrainz.
const store = require('./store');

const UA = `RadarSonoro/1.0 (+${process.env.SPOTIFY_REDIRECT_URI ? new URL(process.env.SPOTIFY_REDIRECT_URI).origin : 'https://github.com/samvitor-git/radar-sonoro'})`;
const MB = 'https://musicbrainz.org/ws/2';
const REFRESH_MS = 120 * 864e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();

let lastCall = 0;
async function mb(path) {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await fetch(`${MB}${path}${path.includes('?') ? '&' : '?'}fmt=json`, {headers: {'User-Agent': UA, Accept: 'application/json'}});
  if (res.status === 503) { await sleep(3000); return null; }
  if (!res.ok) return null;
  return res.json();
}

async function musicbrainz(name) {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
  const found = await mb(`/artist/?query=${q}&limit=5`);
  const cand = ((found && found.artists) || []).find((a) => a.score >= 90 && norm(a.name) === norm(name));
  if (!cand) return [];
  const full = await mb(`/artist/${cand.id}?inc=genres+tags`);
  if (!full) return [];
  const pick = (list) => (list || []).filter((g) => g.count > 0).sort((a, b) => b.count - a.count).map((g) => g.name);
  const genres = pick(full.genres);
  return (genres.length ? genres : pick(full.tags)).slice(0, 6);
}

// Devolve {nome: {g, src}} para os artistas pedidos, consultando o MusicBrainz no máximo `limit` vezes.
async function forArtists(names, {limit = 400, onProgress} = {}) {
  const cache = store.read('genres', {});
  const out = {};
  const todo = [];
  for (const n of names) {
    const c = cache[norm(n)];
    if (c && (c.src === 'export' || Date.now() - c.at < REFRESH_MS)) out[n] = c;
    else todo.push(n);
  }
  let done = 0;
  for (const n of todo.slice(0, limit)) {
    if (onProgress) onProgress(++done, Math.min(todo.length, limit));
    try {
      const g = await musicbrainz(n);
      cache[norm(n)] = {g, src: g.length ? 'musicbrainz' : 'none', at: Date.now()};
    } catch (err) {
      console.warn('[musicbrainz]', n, err.message);
      continue;
    }
    out[n] = cache[norm(n)];
    if (done % 25 === 0) store.write('genres', cache);
  }
  store.write('genres', cache);
  return out;
}

function saveFromExport(map) {
  const cache = store.read('genres', {});
  for (const [name, g] of Object.entries(map)) if (g.length) cache[norm(name)] = {g, src: 'export', at: Date.now()};
  store.write('genres', cache);
}

module.exports = {forArtists, saveFromExport, UA};
