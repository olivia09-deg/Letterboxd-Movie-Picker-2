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
  const foot = (html.match(/class="text-link text-footer"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || html;
  const rt = (foot.match(/([\d,]+)(?:&nbsp;|\s)*mins?\b/) || [])[1];
  const runtime = rt ? +rt.replace(/,/g, '') : null;
  const tm = html.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  const tmdb = tm && tm[1] === 'movie' ? +tm[2] : null;
  return { slug, title: ogTitle.replace(/\s*\(\d{4}\)\s*$/, ''), year, genres: links('genre'), languages: links('language'), image: og('image') || null, runtime, tmdb };
}

async function watch(id, country, key) {
  if (!key) throw Object.assign(new Error('TMDB key is not set on the Worker.'), { status: 501 });
  if (!/^\d{1,9}$/.test(id || '') || !/^[A-Z]{2}$/.test(country || '')) throw Object.assign(new Error('Bad request.'), { status: 400 });
  const res = await fetch(`https://api.themoviedb.org/3/movie/${id}/watch/providers?api_key=${key}`, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw Object.assign(new Error('TMDB request failed (' + res.status + ').'), { status: 502 });
  const d = ((await res.json()).results || {})[country] || {};
  const names = (a) => (a || []).map((p) => p.provider_name);
  return { country, link: d.link || null, stream: uniq([...names(d.flatrate), ...names(d.free), ...names(d.ads)]), rent: names(d.rent), buy: names(d.buy) };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    url.pathname = url.pathname.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
    try {
      if (url.pathname === '/list') return out(await list(url.searchParams.get('user')));
      if (url.pathname === '/film') return out(await film(url.searchParams.get('slug')));
      if (url.pathname === '/watch') return out(await watch(url.searchParams.get('id'), url.searchParams.get('country'), env.TMDB_KEY));
      return out({ error: 'Not found.' }, 404);
    } catch (e) {
      return out({ error: e.message }, e.status || 500);
    }
  },
};
