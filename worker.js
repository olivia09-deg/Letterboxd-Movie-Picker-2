// Cloudflare Worker: reads public Letterboxd pages for the Reel Good site.
//   /list?user=NAME   -> { user, slugs: [...] }   (watchlist film ids)
//   /film?slug=SLUG   -> { slug, title, year, genres, languages, image }
const UA = 'Mozilla/5.0 (compatible; reel-good/1.0)';
const HEAD = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
const uniq = (a) => [...new Set(a)];
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const nice = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const out = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEAD });

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en' }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error('Letterboxd refused the request (' + res.status + ').'), { status: 502 });
  return res.text();
}

async function list(user) {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(user || '')) throw Object.assign(new Error('That is not a valid username.'), { status: 400 });
  const slugs = [];
  for (let p = 1; p <= 40; p++) { // free plan allows 50 outgoing requests per call
    const html = await get(`https://letterboxd.com/${user}/watchlist/page/${p}/`);
    if (!html) break;
    const fresh = uniq([...html.matchAll(/data-(?:item|film)-slug="([^"]+)"/g)].map((m) => m[1])).filter((s) => !slugs.includes(s));
    if (!fresh.length) break;
    slugs.push(...fresh);
  }
  if (!slugs.length) throw Object.assign(new Error(`No films found for "${user}". Check the spelling and that the watchlist is public.`), { status: 404 });
  return { user, slugs };
}

async function film(slug) {
  if (!/^[a-z0-9-]{1,120}$/.test(slug || '')) throw Object.assign(new Error('Bad film id.'), { status: 400 });
  const html = await get(`https://letterboxd.com/film/${slug}/`);
  if (!html) throw Object.assign(new Error('Film not found.'), { status: 404 });
  const og = (p) => (html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`)) || [])[1];
  const links = (kind) => uniq([...html.matchAll(new RegExp(`href="/films/${kind}/[^"/]+/"[^>]*>([^<]+)<`, 'g'))].map((m) => decode(m[1].trim())));
  const ogTitle = decode(og('title') || nice(slug));
  const year = +(html.match(/href="\/films\/year\/(\d{4})\//) || [])[1] || +(ogTitle.match(/\((\d{4})\)\s*$/) || [])[1] || null;
  return { slug, title: ogTitle.replace(/\s*\(\d{4}\)\s*$/, ''), year, genres: links('genre'), languages: links('language'), image: og('image') || null };
}

export default {
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/list') return out(await list(url.searchParams.get('user')));
      if (url.pathname === '/film') return out(await film(url.searchParams.get('slug')));
      return out({ error: 'Not found.' }, 404);
    } catch (e) {
      return out({ error: e.message }, e.status || 500);
    }
  },
};
