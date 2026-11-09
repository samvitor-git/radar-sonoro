// Agrupa gêneros nas vertentes usadas pela dashboard. Os gêneros vêm em português (exportação do
// Spotify/Exportify) ou em inglês (MusicBrainz); as listas aceitam os dois.
const FAMILIAS = [
  ['J-Rock e anime', ['anime', 'rock japonês', 'j-pop', 'j-rock', 'visual kei', 'rap de anime', 'anison', 'japanese rock', 'j-metal', 'japanese', 'anime song']],
  ['Nu metal e metalcore', ['nu metal', 'metalcore', 'rap metal', 'metal alternativo', 'alternative metal', 'metal', 'post-hardcore', 'screamo', 'mathcore', 'djent', 'deathcore', 'melodic metalcore', 'nu-metal', 'industrial metal']],
  ['Emo', ['emo', 'easycore', 'midwest emo', 'emo pop', 'emo-pop']],
  ['Punk e pop-punk', ['pop punk', 'punk', 'skate punk', 'hardcore punk', 'hardcore', 'punk rock', 'pop-punk', 'melodic hardcore']],
  ['Hard rock e clássicos', ['hard rock', 'rock clássico', 'classic rock', 'glam metal', 'glam rock', 'blues rock', 'heavy metal', 'rock psicodélico', 'psychedelic rock', 'proto-punk', 'aor', 'stoner rock', 'arena rock', 'southern rock', 'progressive rock']],
  ['Rock brasileiro', ['rock brasileiro', 'brazilian rock', 'surf rock', 'rock gaúcho', 'rock baiano', 'mangue beat', 'manguebeat']],
  ['Rock alternativo', ['rock alternativo', 'alternative rock', 'post-grunge', 'grunge', 'indie rock', 'garage rock', 'rock', 'shoegaze', 'indie', 'britpop', 'alternative', 'post-punk revival', 'dance-punk']],
  ['Trilhas e instrumental', ['trilha sonora', 'soundtrack', 'trilha sonora original', 'música clássica', 'lo-fi', 'lo-fi beats', 'jazz beats', 'medieval', 'video game music', 'film score', 'film soundtrack', 'lo-fi hip hop', 'classical', 'ambient', 'modern classical']],
  ['MPB e outros brasileiros', ['mpb', 'nova mpb', 'axé', 'samba', 'forró', 'hip hop brasileiro', 'pop nacional', 'jazz brasileiro', 'brazilian hip hop', 'bossa nova', 'música popular brasileira', 'brazilian']],
  ['Pop', ['pop', 'art pop', 'synthpop', 'synth-pop', 'o lado suave do pop', 'pop acústico', 'pop soul', 'electropop', 'indie pop', 'dance-pop', 'pop rock']],
];

// Artistas classificados à mão: sem gênero nas fontes ou com gêneros que não os descrevem bem.
const MANUAL = {
  'Rock alternativo': ['Jutes', 'VOILÀ', 'Speed of Light', 'Carry the Day', 'The Beaches', 'Temper City', 'Coast Arcade', 'The Rose Hips', 'Night After', 'Power On', 'Cameron Whitcomb', 'Culture Wars', 'Neon Panthers', 'Pacifica', 'The Next Movement', 'Keith Wallen', 'moonstone.', 'her fever', 'Beyond Disdain', 'Father Of Peace', 'Rocket Pengwin', 'Lui Joseph', 'AITA', 'Guto Brant', 'Shrink the Giant', 'izzy reign', 'jackie', 'Vilivant', 'The Mercians', 'Livingston', 'Tess Anderson', 'Bradley Denniston', 'Nicotine Dolls', 'Telling Secrets', 'VISION ARCADE', 'Ryan Mack', 'Imagine Dragons'],
  'Punk e pop-punk': ['Lovedrop', 'Set It Off', 'BEAUTY SCHOOL DROPOUT', 'Honey Revenge'],
  'Hard rock e clássicos': ['The Warning'],
  'Trilhas e instrumental': ['Yann Tiersen', 'Chanpan', 'Marcin', 'Lorien Testard'],
  'Pop': ['Billie Eilish', 'Olivia Rodrigo', 'JVKE', 'Chappell Roan', 'RAYE', 'Harry Styles', 'Lawrence', 'Matt Hansen', 'OneRepublic', 'Shawn Mendes'],
  'MPB e outros brasileiros': ['Ronei Jorge', 'BaianaSystem', 'Ney Matogrosso', 'Belchior', 'Rapadura', 'Bruma', 'Enio e a Maloca', 'Parajás', 'Lo Han'],
};
const MANUAL_BY_ARTIST = new Map();
for (const [fam, list] of Object.entries(MANUAL)) for (const a of list) MANUAL_BY_ARTIST.set(a.toLowerCase(), fam);

// Deixados de fora a pedido.
const EXCLUIR = [/djonga/i, /jamie cullum/i];
const EXCLUIR_GENERO = [/sertanejo/i, /arrocha/i, /agronejo/i];

// Na exportação do Spotify em português, "pop rock" aparece para bandas brasileiras.
const EXPORT_EXTRA = {'pop rock': 'Rock brasileiro'};

function familia(artist, genres, src) {
  const gs = genres.map((g) => g.toLowerCase());
  const m0 = MANUAL_BY_ARTIST.get(String(artist).toLowerCase());
  if (m0) return {familia: m0, classificacao: 'Manual'};
  for (const [nome, lista] of FAMILIAS) {
    if (gs.some((g) => (src === 'export' && EXPORT_EXTRA[g] ? EXPORT_EXTRA[g] === nome : lista.includes(g)))) {
      return {familia: nome, classificacao: src === 'musicbrainz' ? 'Gêneros do MusicBrainz' : 'Gêneros do Spotify'};
    }
  }
  const m = MANUAL_BY_ARTIST.get(String(artist).toLowerCase());
  if (m) return {familia: m, classificacao: 'Manual (sem gênero nas fontes)'};
  return {familia: 'Sem gênero', classificacao: 'Sem gênero nas fontes'};
}

function excluida(artists, genres) {
  const names = artists.join(' ');
  return EXCLUIR.some((r) => r.test(names)) || genres.some((g) => EXCLUIR_GENERO.some((r) => r.test(g)));
}

module.exports = {familia, excluida};
