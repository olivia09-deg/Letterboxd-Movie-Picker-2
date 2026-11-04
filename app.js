// Paste your Cloudflare Worker address here (see README), e.g. 'https://reel-good.yourname.workers.dev'
const WORKER_URL = 'https://reel-good.olivia-layton.workers.dev';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nice = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const clean = (s) => s.trim().replace(/^.*letterboxd\.com\//i, '').replace(/[/?#].*$/, '');
const say = (t) => { $('#status').textContent = t; };
const HINT = 'Set your filters, then press Pick a film.';

let films = [], soloFilms = [], soloMap = new Map(), sharedFilms = [], last = null, busy = false;
const genres = new Set();
let hidden = new Set();
try { hidden = new Set(JSON.parse(localStorage.getItem('rg:hidden') || '[]')); } catch {}
const saveHidden = () => { try { localStorage.setItem('rg:hidden', JSON.stringify([...hidden])); } catch {} };
const COUNTRIES = { AU: 'Australia', AT: 'Austria', BE: 'Belgium', BR: 'Brazil', CA: 'Canada', CZ: 'Czechia', DK: 'Denmark', FI: 'Finland', FR: 'France', DE: 'Germany', IN: 'India', IE: 'Ireland', IT: 'Italy', JP: 'Japan', MX: 'Mexico', NL: 'Netherlands', NZ: 'New Zealand', NO: 'Norway', PL: 'Poland', PT: 'Portugal', ZA: 'South Africa', ES: 'Spain', SE: 'Sweden', CH: 'Switzerland', GB: 'United Kingdom', US: 'United States' };
let country = 'US';
try {
  const saved = localStorage.getItem('rg:country');
  const guess = ((navigator.language || '').split('-')[1] || '').toUpperCase();
  country = COUNTRIES[saved] ? saved : COUNTRIES[guess] ? guess : 'US';
} catch {}

function filtered() {
  const from = +$('#from').value || null, to = +$('#to').value || null, lang = $('#lang').value, len = $('#len').value;
  return films.filter((f) =>
    !hidden.has(f.slug) &&
    (!len || (f.runtime && (len === 'o150' ? f.runtime > 150 : f.runtime <= +len.slice(1)))) &&
    (!(from || to) || f.year) &&
    (!from || f.year >= from) && (!to || f.year <= to) &&
    (!lang || f.languages.includes(lang)) &&
    (!genres.size || f.genres.some((g) => genres.has(g))));
}

function count(key) {
  const m = new Map();
  films.forEach((f) => (Array.isArray(f[key]) ? f[key] : []).forEach((v) => m.set(v, (m.get(v) || 0) + 1)));
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function updateCount() {
  $('#count').textContent = `${filtered().length} of ${films.length} films match`;
  $('#unhide').hidden = !hidden.size;
  $('#unhide').textContent = `Bring back ${hidden.size} hidden film${hidden.size === 1 ? '' : 's'}`;
}

function show(f) {
  $('#stage').classList.add('on');
  $('#title').textContent = f.title;
  $('#still').style.backgroundImage = f.image ? `url("${f.image}")` : 'none';
  $('#meta').innerHTML = [f.year, ...f.genres.slice(0, 3), ...f.languages.slice(0, 2)]
    .filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');
  $('#open').href = `https://letterboxd.com/film/${f.slug}/`;
  $('#open').hidden = false;
  $('#skip').hidden = false;
  $('#where').textContent = '';
  loadWhere(f);
}

function pick() {
  if (busy) return;
  const pool = filtered();
  if (!pool.length) {
    $('#stage').classList.remove('on');
    $('#hint').textContent = 'Nothing matches. Widen the years or clear a genre.';
    return;
  }
  let w;
  do { w = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && w === last);
  last = w;
  $('#pick').textContent = 'Pick another';
  if (pool.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) { show(w); return; }
  busy = true;
  $('#stage').classList.add('on', 'rolling');
  $('#open').hidden = true;
  $('#skip').hidden = true;
  $('#where').textContent = '';
  let i = 0;
  const t = setInterval(() => {
    if (++i > 12) { clearInterval(t); busy = false; $('#stage').classList.remove('rolling'); show(w); return; }
    $('#title').textContent = pool[Math.floor(Math.random() * pool.length)].title;
  }, 70);
}

function build() {
  const years = films.map((f) => f.year).filter(Boolean);
  $('#from').placeholder = years.length ? Math.min(...years) : 'From';
  $('#to').placeholder = years.length ? Math.max(...years) : 'To';
  $('#genres').innerHTML = count('genres').map(([g, n]) =>
    `<button type="button" class="chip" aria-pressed="false" data-g="${esc(g)}">${esc(g)} <small>${n}</small></button>`).join('');
  $('#lang').innerHTML = '<option value="">Any language</option>' +
    count('languages').map(([l, n]) => `<option value="${esc(l)}">${esc(l)} (${n})</option>`).join('');
  updateCount();
}

// Swap in a new list of films (own watchlist or shared list) and reset the page.
function setFilms(list, hint = HINT) {
  films = list; last = null; genres.clear();
  $('#from').value = $('#to').value = $('#len').value = '';
  $('#skip').hidden = true;
  $('#where').textContent = '';
  $('#stage').classList.remove('on');
  $('#open').hidden = true;
  $('#hint').textContent = hint;
  $('#pick').textContent = 'Pick a film';
  $('#pick').disabled = !films.length;
  build();
}

function setMode(m) {
  $('#m-solo').setAttribute('aria-pressed', m === 'solo');
  $('#m-duo').setAttribute('aria-pressed', m === 'duo');
  $('#duo').hidden = m !== 'duo';
  if (m === 'solo') setFilms(soloFilms);
  else setFilms(sharedFilms, sharedFilms.length ? HINT : 'Enter two usernames and compare their watchlists.');
}

/* ---------- movie night ---------- */
async function api(path) {
  if (!WORKER_URL) throw new Error('Movie night needs the Worker address in app.js (see README).');
  const r = await fetch(WORKER_URL.trim().replace(/\/+$/, '') + path);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

function known(slug) {
  const s = soloMap.get(slug);
  if (s && 'tmdb' in s && 'runtime' in s) return s;
  try { const c = localStorage.getItem('rg2:' + slug); if (c) return JSON.parse(c); } catch {}
  return null;
}

async function details(slugs) {
  const out = []; let i = 0, done = 0;
  async function run() {
    while (i < slugs.length) {
      const slug = slugs[i++];
      let f = known(slug);
      if (!f) {
        try {
          f = await api('/film?slug=' + encodeURIComponent(slug));
          try { localStorage.setItem('rg2:' + slug, JSON.stringify(f)); } catch {}
        } catch { f = { slug, title: nice(slug), year: null, genres: [], languages: [], image: null, runtime: null, tmdb: null }; }
      }
      out.push(f);
      say(`Loading film details… ${++done}/${slugs.length}`);
    }
  }
  await Promise.all([run(), run(), run(), run()]);
  return out;
}

async function compare() {
  const a = clean($('#userA').value), b = clean($('#userB').value);
  if (!a || !b) { say('Enter both usernames.'); return; }
  if (a.toLowerCase() === b.toLowerCase()) { say('Enter two different usernames.'); return; }
  $('#compare').disabled = true;
  say('Reading both watchlists…');
  try {
    const [A, B] = await Promise.all([api('/list?user=' + encodeURIComponent(a)), api('/list?user=' + encodeURIComponent(b))]);
    const inB = new Set(B.slugs);
    const shared = A.slugs.filter((s) => inB.has(s));
    if (!shared.length) {
      sharedFilms = [];
      setFilms([], 'No films in common.');
      say(`${a} has ${A.slugs.length} films and ${b} has ${B.slugs.length}, but none overlap.`);
      return;
    }
    sharedFilms = await details(shared);
    setFilms(sharedFilms);
    say(`${shared.length} films are on both watchlists (${a}: ${A.slugs.length}, ${b}: ${B.slugs.length}).`);
  } catch (e) {
    say(e.message);
  } finally {
    $('#compare').disabled = false;
  }
}

/* ---------- own watchlist ---------- */
async function load() {
  try {
    const r = await fetch('data/watchlist.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const d = await r.json();
    soloFilms = (d.films || []).map((f) => ({ ...f, genres: f.genres || [], languages: f.languages || [] }));
    soloMap = new Map(soloFilms.filter((f) => !f.incomplete).map((f) => [f.slug, f]));
    if (d.updated) $('#updated').textContent = 'Watchlist updated ' + new Date(d.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    if (!soloFilms.length) $('#hint').textContent = 'The watchlist file is empty. Run the “Update watchlist” action once (see README).';
    else if ($('#m-solo').getAttribute('aria-pressed') === 'true') setFilms(soloFilms);
  } catch {
    $('#hint').textContent = 'Could not load data/watchlist.json.';
  }
}

$('#genres').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  const on = b.getAttribute('aria-pressed') !== 'true';
  b.setAttribute('aria-pressed', on);
  on ? genres.add(b.dataset.g) : genres.delete(b.dataset.g);
  updateCount();
});
['#from', '#to', '#lang', '#len'].forEach((s) => $(s).addEventListener('input', updateCount));
$('#clear').addEventListener('click', () => {
  genres.clear();
  document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  $('#from').value = $('#to').value = $('#lang').value = $('#len').value = '';
  updateCount();
});
$('#pick').addEventListener('click', pick);
$('#m-solo').addEventListener('click', () => setMode('solo'));
$('#m-duo').addEventListener('click', () => setMode('duo'));
$('#compare').addEventListener('click', compare);
['#userA', '#userB'].forEach((s) => $(s).addEventListener('keydown', (e) => { if (e.key === 'Enter') compare(); }));
/* ---------- where to watch ---------- */
const whereCache = new Map();
async function loadWhere(f) {
  const box = $('#where');
  if (!WORKER_URL || !f.tmdb) return;
  const key = f.tmdb + country;
  box.innerHTML = '<div>Checking where to watch…</div>';
  try {
    if (!whereCache.has(key)) whereCache.set(key, api(`/watch?id=${f.tmdb}&country=${country}`));
    const d = await whereCache.get(key);
    if (last !== f || $('#open').hidden) return;
    const row = (label, list) => list.length ? `<div><b>${label}</b>${list.map(esc).join(', ')}</div>` : '';
    box.innerHTML = (row('Stream', d.stream) + row('Rent', d.rent) + row('Buy', d.buy)) ||
      `<div>Not available to stream, rent or buy in ${esc(COUNTRIES[country])}.</div>`;
    if (/^https:\/\//.test(d.link || '')) box.innerHTML += `<div><a href="${esc(d.link)}" target="_blank" rel="noopener">More on JustWatch</a></div>`;
  } catch {
    whereCache.delete(key);
    if (last === f) box.innerHTML = '<div>Where to watch is unavailable right now.</div>';
  }
}

$('#country').innerHTML = Object.entries(COUNTRIES).map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
$('#country').value = country;
$('#country').addEventListener('change', (e) => {
  country = e.target.value;
  try { localStorage.setItem('rg:country', country); } catch {}
  if (last && !$('#open').hidden) loadWhere(last);
});
$('#skip').addEventListener('click', () => {
  if (last) { hidden.add(last.slug); saveHidden(); updateCount(); }
  pick();
});
$('#unhide').addEventListener('click', () => { hidden.clear(); saveHidden(); updateCount(); });
load();
