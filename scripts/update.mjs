// Reads a public Letterboxd watchlist and writes data/watchlist.json.
// Usage: LB_USER=yourname node scripts/update.mjs
import { readFile, writeFile } from 'node:fs/promises';

const USER = process.env.LB_USER;
if (!USER) { console.error('Set LB_USER to your Letterboxd username.'); process.exit(1); }

const OUT = 'data/watchlist.json';
const UA = 'Mozilla/5.0 (compatible; watchlist-picker/1.0)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = (a) => [...new Set(a)];
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const nice = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const stub = (slug) => ({ slug, title: nice(slug), year: null, genres: [], languages: [], image: null, runtime: null, tmdb: null, incomplete: true });

async function get(url) {
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' } });
    if (res.ok) return res.text();
    if (res.status === 404) return null;
    await sleep(1500 * i);
  }
  throw new Error('Request failed: ' + url);
}

async function listSlugs() {
  const slugs = [];
  for (let p = 1; p < 200; p++) {
    const html = await get(`https://letterboxd.com/${USER}/watchlist/page/${p}/`);
    if (!html) break;
    const fresh = uniq([...html.matchAll(/data-(?:item|film)-slug="([^"]+)"/g)]
      .map((m) => m[1])).filter((s) => !slugs.includes(s));
    if (!fresh.length) break;
    slugs.push(...fresh);
    await sleep(500);
  }
  return slugs;
}

async function details(slug) {
  const html = await get(`https://letterboxd.com/film/${slug}/`);
  if (!html) return null;
  const og = (p) => (html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`)) || [])[1];
  const links = (kind) => uniq([...html.matchAll(
    new RegExp(`href="/films/${kind}/[^"/]+/"[^>]*>([^<]+)<`, 'g'))].map((m) => decode(m[1].trim())));
  const ogTitle = decode(og('title') || nice(slug));
  const year = +(html.match(/href="\/films\/year\/(\d{4})\//) || [])[1]
    || +(ogTitle.match(/\((\d{4})\)\s*$/) || [])[1] || null;
  const foot = (html.match(/class="text-link text-footer"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || html;
  const rt = (foot.match(/([\d,]+)(?:&nbsp;|\s)*mins?\b/) || [])[1];
  const runtime = rt ? +rt.replace(/,/g, '') : null;
  const tm = html.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  const tmdb = tm && tm[1] === 'movie' ? +tm[2] : null;
  return {
    slug,
    title: ogTitle.replace(/\s*\(\d{4}\)\s*$/, ''),
    year,
    genres: links('genre'),
    languages: links('language'),
    image: og('image') || null,
    runtime,
    tmdb,
  };
}

let old = {};
try {
  const prev = JSON.parse(await readFile(OUT, 'utf8'));
  old = Object.fromEntries((prev.films || []).map((f) => [f.slug, f]));
} catch {}

const slugs = await listSlugs();
if (!slugs.length) {
  console.error('No films found. Is the watchlist public and the username right? Keeping the old file.');
  process.exit(1);
}

const films = [];
for (const slug of slugs) {
  if (old[slug] && !old[slug].incomplete && 'runtime' in old[slug] && 'tmdb' in old[slug]) { films.push(old[slug]); continue; } // already known
  try { films.push((await details(slug)) || stub(slug)); }
  catch (e) { console.warn(e.message); films.push(stub(slug)); }
  await sleep(700);
}

if (Object.keys(old).length && JSON.stringify(Object.values(old)) === JSON.stringify(films)) { console.log('No changes.'); process.exit(0); }

await writeFile(OUT, JSON.stringify({ user: USER, updated: new Date().toISOString(), films }, null, 1));
console.log(`Saved ${films.length} films.`);
