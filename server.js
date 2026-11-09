// Radar Sonoro: servidor HTTP sem dependências externas.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const sp = require('./lib/spotify');
const sync = require('./lib/sync');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');
const DEMO = process.env.DEMO_DATA ? JSON.parse(fs.readFileSync(process.env.DEMO_DATA, 'utf8')) : null;
const POLL_MINUTES = Number(process.env.POLL_MINUTES || 30);

for (const k of ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI']) {
  if (!process.env[k] && !DEMO) { console.error(`Falta a variável ${k} no arquivo .env`); process.exit(1); }
}

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://i.scdn.co https://*.spotifycdn.com; connect-src 'self'",
};

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const secure = () => String(process.env.SPOTIFY_REDIRECT_URI || '').startsWith('https://');
const setCookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure() ? '; Secure' : ''}`;

function send(res, code, body, headers = {}) {
  res.writeHead(code, {...SECURITY, ...headers});
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
const redirect = (res, to, extra = {}) => send(res, 302, '', {Location: to, ...extra});

function serveFile(res, file) {
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(res, 404, 'Não encontrado');
  send(res, 200, fs.readFileSync(full), {'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
}

// Uma sessão por navegador; só a conta do Spotify dona do app entra.
function loggedIn(req) {
  if (DEMO) return true;
  const sid = cookies(req).rs_session;
  const sessions = store.read('sessions', {});
  return !!(sid && sessions[sid] && sessions[sid].exp > Date.now());
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/health') return json(res, 200, {ok: true});

  if (p === '/login') {
    const state = crypto.randomBytes(16).toString('hex');
    return redirect(res, sp.authorizeUrl(state), {'Set-Cookie': setCookie('rs_state', state, 600)});
  }

  if (p === '/callback') {
    const c = cookies(req);
    if (url.searchParams.get('error')) return redirect(res, '/?erro=' + encodeURIComponent('O Spotify não autorizou o acesso.'));
    if (!url.searchParams.get('state') || url.searchParams.get('state') !== c.rs_state) return redirect(res, '/?erro=' + encodeURIComponent('O login expirou. Tente de novo.'));
    try {
      await sp.exchangeCode(url.searchParams.get('code'));
      const me = await sp.get('/me');
      const owner = store.read('owner', null);
      const allowed = process.env.ALLOWED_SPOTIFY_ID || (owner && owner.id);
      if (allowed && me.id !== allowed) {
        if (owner) store.write('token', store.read('token_owner', null));
        return redirect(res, '/?erro=' + encodeURIComponent('Esta dashboard pertence a outra conta do Spotify.'));
      }
      if (!owner) store.write('owner', {id: me.id, nome: me.display_name || me.id});
      store.write('token_owner', store.read('token', null));
      const sid = crypto.randomBytes(24).toString('hex');
      const sessions = store.read('sessions', {});
      for (const [k, v] of Object.entries(sessions)) if (v.exp < Date.now()) delete sessions[k];
      sessions[sid] = {exp: Date.now() + 30 * 864e5};
      store.write('sessions', sessions);
      const first = !store.read('dashboard', null);
      if (first) sync.run();
      return send(res, 302, '', {Location: '/', 'Set-Cookie': [setCookie('rs_session', sid, 30 * 86400), setCookie('rs_state', '', 0)]});
    } catch (err) {
      console.error('[login]', err);
      return redirect(res, '/?erro=' + encodeURIComponent(err.message));
    }
  }

  if (p === '/logout') {
    const sid = cookies(req).rs_session;
    const sessions = store.read('sessions', {});
    delete sessions[sid];
    store.write('sessions', sessions);
    return redirect(res, '/', {'Set-Cookie': setCookie('rs_session', '', 0)});
  }

  if (p === '/' || p === '/index.html') return serveFile(res, loggedIn(req) ? 'index.html' : 'login.html');

  if (p.startsWith('/api/')) {
    if (!loggedIn(req)) return json(res, 401, {erro: 'Faça login.'});
    if (p === '/api/data') {
      const d = DEMO || sync.dashboardData();
      return d ? json(res, 200, d) : json(res, 404, {erro: 'Ainda não há dados. Clique em Atualizar com Spotify.'});
    }
    if (p === '/api/status') return json(res, 200, sync.status);
    if (p === '/api/sync' && req.method === 'POST') {
      if (DEMO) return json(res, 200, {ok: true, demo: true});
      if (req.headers['x-requested-with'] !== 'radar') return json(res, 403, {erro: 'Pedido inválido.'});
      sync.run();
      return json(res, 202, {ok: true});
    }
    return json(res, 404, {erro: 'Não encontrado.'});
  }

  return serveFile(res, p.slice(1));
}

http.createServer((req, res) => handle(req, res).catch((err) => { console.error(err); send(res, 500, 'Erro interno'); }))
  .listen(PORT, () => console.log(`Radar Sonoro ouvindo na porta ${PORT}${DEMO ? ' (modo demonstração)' : ''}`));

if (!DEMO) {
  // Registra o que você ouviu a cada POLL_MINUTES minutos; o Spotify guarda só as últimas 50 faixas.
  setTimeout(() => sync.pollRecentlyPlayed(), 15000);
  setInterval(() => sync.pollRecentlyPlayed(), POLL_MINUTES * 60000);
  // Atualiza a biblioteca sozinho uma vez por dia, às 5h do servidor.
  setInterval(() => { if (new Date().getHours() === 5 && store.read('token', null) && !sync.status.running) sync.run(); }, 3600000);
}
