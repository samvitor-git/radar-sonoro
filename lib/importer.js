// Lê arquivos CSV do Exportify e guarda o que a API do Spotify não entrega mais:
// dados de áudio por faixa e gêneros por artista.
const store = require('./store');
const genres = require('./genres');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

function importCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length || !('Track URI' in rows[0])) return {faixas: 0, artistas: 0, ignorado: true};
  const features = store.read('features', {});
  const artistGenres = {};
  let faixas = 0;
  for (const r of rows) {
    const id = String(r['Track URI'] || '').split(':').pop();
    const num = (k) => (r[k] === '' || r[k] == null ? null : Number(r[k]));
    if (id && num('Energy') != null && !isNaN(num('Energy'))) {
      if (!features[id] || features[id].miss) faixas++;
      features[id] = {e: num('Energy'), v: num('Valence'), d: num('Danceability'), a: num('Acousticness'), t: num('Tempo'), src: 'export'};
    }
    const first = String(r['Artist Name(s)'] || '').split(/[;,]/)[0].trim();
    const gs = String(r.Genres || '').split(',').map((g) => g.trim()).filter(Boolean);
    if (first && gs.length && !artistGenres[first]) artistGenres[first] = gs;
  }
  store.write('features', features);
  genres.saveFromExport(artistGenres);
  return {faixas, artistas: Object.keys(artistGenres).length};
}

module.exports = {importCsv, parseCsv};
