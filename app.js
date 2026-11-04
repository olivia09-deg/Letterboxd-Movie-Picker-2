const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let films = [], last = null, busy = false;
const genres = new Set();

function filtered() {
  const from = +$('#from').value || null, to = +$('#to').value || null, lang = $('#lang').value;
  return films.filter((f) =>
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
  const n = filtered().length;
  $('#count').textContent = `${n} of ${films.length} films match`;
}

function show(f) {
  $('#stage').classList.add('on');
  $('#title').textContent = f.title;
  $('#still').style.backgroundImage = f.image ? `url("${f.image}")` : 'none';
  $('#meta').innerHTML = [f.year, ...f.genres.slice(0, 3), ...f.languages.slice(0, 2)]
    .filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');
  $('#open').href = `https://letterboxd.com/film/${f.slug}/`;
  $('#open').hidden = false;
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
  let i = 0;
  const t = setInterval(() => {
    if (++i > 12) { clearInterval(t); busy = false; $('#stage').classList.remove('rolling'); show(w); return; }
    $('#title').textContent = pool[Math.floor(Math.random() * pool.length)].title;
  }, 70);
}

function build() {
  const years = films.map((f) => f.year).filter(Boolean);
  if (years.length) {
    $('#from').placeholder = Math.min(...years);
    $('#to').placeholder = Math.max(...years);
  }
  $('#genres').innerHTML = count('genres').map(([g, n]) =>
    `<button type="button" class="chip" aria-pressed="false" data-g="${esc(g)}">${esc(g)} <small>${n}</small></button>`).join('');
  $('#lang').innerHTML = '<option value="">Any language</option>' +
    count('languages').map(([l, n]) => `<option value="${esc(l)}">${esc(l)} (${n})</option>`).join('');
  updateCount();
}

async function load() {
  try {
    const r = await fetch('data/watchlist.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error();
    const d = await r.json();
    films = (d.films || []).map((f) => ({ ...f, genres: f.genres || [], languages: f.languages || [] }));
    if (!films.length) { $('#hint').textContent = 'The watchlist file is empty. Run the “Update watchlist” action once (see README).'; return; }
    if (d.updated) $('#updated').textContent = 'Watchlist updated ' + new Date(d.updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    build();
    $('#pick').disabled = false;
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
['#from', '#to', '#lang'].forEach((s) => $(s).addEventListener('input', updateCount));
$('#clear').addEventListener('click', () => {
  genres.clear();
  document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
  $('#from').value = $('#to').value = $('#lang').value = '';
  updateCount();
});
$('#pick').addEventListener('click', pick);
load();
