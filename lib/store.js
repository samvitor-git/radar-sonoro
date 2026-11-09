// Guarda o estado em arquivos JSON dentro de DATA_DIR (um volume do Docker).
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DIR, {recursive: true});

function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, name + '.json'), 'utf8')); } catch { return fallback; }
}

function write(name, value) {
  const file = path.join(DIR, name + '.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

module.exports = {read, write, DIR};
