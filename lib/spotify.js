// Cliente mínimo da Web API do Spotify: login, renovação do token e chamadas com novas tentativas.
const store = require('./store');

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = ['user-library-read', 'playlist-read-private', 'playlist-read-collaborative', 'user-top-read', 'user-read-recently-played'];

const cfg = () => ({
  id: process.env.SPOTIFY_CLIENT_ID,
  secret: process.env.SPOTIFY_CLIENT_SECRET,
  redirect: process.env.SPOTIFY_REDIRECT_URI,
});

function authorizeUrl(state) {
  const c = cfg();
  const q = new URLSearchParams({response_type: 'code', client_id: c.id, scope: SCOPES.join(' '), redirect_uri: c.redirect, state});
  return `${ACCOUNTS}/authorize?${q}`;
}

async function tokenRequest(params) {
  const c = cfg();
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${c.id}:${c.secret}`).toString('base64'),
    },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Spotify recusou o token (${res.status}): ${body.error_description || body.error || ''}`);
  return body;
}

async function exchangeCode(code) {
  const t = await tokenRequest({grant_type: 'authorization_code', code, redirect_uri: cfg().redirect});
  return saveToken(t);
}

function saveToken(t, previous = {}) {
  const tok = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || previous.refresh_token,
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  };
  store.write('token', tok);
  return tok;
}

async function accessToken() {
  const tok = store.read('token', null);
  if (!tok || !tok.refresh_token) throw Object.assign(new Error('Faça login no Spotify primeiro.'), {code: 'NO_TOKEN'});
  if (Date.now() < tok.expires_at) return tok.access_token;
  const t = await tokenRequest({grant_type: 'refresh_token', refresh_token: tok.refresh_token});
  return saveToken(t, tok).access_token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(pathOrUrl, {optional = false} = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : API + pathOrUrl;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {headers: {Authorization: 'Bearer ' + (await accessToken())}});
    if (res.status === 429) { await sleep((Number(res.headers.get('retry-after')) || 2) * 1000 + 250); continue; }
    if (res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (res.status === 204) return null;
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      if (optional && [403, 404].includes(res.status)) return null;
      const msg = body && body.error ? body.error.message : res.statusText;
      throw Object.assign(new Error(`Spotify ${res.status} em ${url.replace(API, '')}: ${msg}`), {status: res.status});
    }
    return body;
  }
  throw new Error(`Spotify não respondeu depois de várias tentativas: ${url}`);
}

// Percorre todas as páginas de um endpoint paginado.
async function all(path, {onPage, optional = false} = {}) {
  const items = [];
  let next = path;
  while (next) {
    const page = await get(next, {optional});
    if (!page) break;
    items.push(...(page.items || []));
    if (onPage) onPage(items.length, page.total);
    next = page.next;
  }
  return items;
}

module.exports = {authorizeUrl, exchangeCode, get, all, sleep};
