// Media tracker — movies, TV shows, books and comics, kept as one builtin
// object type so mentions, relations, search and backlinks all treat an entry
// exactly like any other object. Only the poster wall, the cover picker and
// the two lookups below are bespoke; properties, templates and the object
// page itself are the same machinery every other type gets.

const MEDIA_TYPE = 'media';

/** The one genre vocabulary every source's own tags get normalized into (see `genresIn`). */
const GENRE_OPTIONS = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'Non-fiction'];

const MEDIA_PROPS = [
  { id: 'kind', name: 'Kind', kind: 'select', options: ['Movie', 'TV Show', 'Book', 'Comic'] },
  { id: 'status', name: 'Status', kind: 'select', options: ['Want to', 'In progress', 'Finished', 'Dropped'] },
  { id: 'rating', name: 'Rating', kind: 'rating' },
  { id: 'cover', name: 'Cover', kind: 'file' },
  { id: 'genre', name: 'Genre', kind: 'multiselect', options: GENRE_OPTIONS },
  // A movie is watched in one sitting — Finished doubles as "watched on" and
  // the renderer hides Started for that kind. A show or a book has both ends.
  { id: 'started', name: 'Started', kind: 'date' },
  { id: 'finished', name: 'Finished', kind: 'date' },
];

/** Adds the type once, the same way every other builtin type is seeded — safe to call on every boot. */
function ensureMediaType(db, now) {
  if (db.prepare('SELECT id FROM types WHERE id = ?').get(MEDIA_TYPE)) return;
  db.prepare(
    'INSERT INTO types (id, name, emoji, color, properties, builtin, starred, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)'
  ).run(MEDIA_TYPE, 'Media', 'film', '#e34948', JSON.stringify(MEDIA_PROPS), now());
}

/**
 * Swaps in the current property list wholesale — used once, when By/Year were
 * dropped for Started/Finished. Any value already sitting in an object's
 * `props` under a property that no longer exists is simply orphaned data, the
 * same way removing a property by hand from any type leaves it.
 */
function migrateMediaProps(db) {
  if (!db.prepare('SELECT id FROM types WHERE id = ?').get(MEDIA_TYPE)) return;
  db.prepare('UPDATE types SET properties = ? WHERE id = ?').run(JSON.stringify(MEDIA_PROPS), MEDIA_TYPE);
}

/**
 * Comments duplicated the note body every object already has, so — unlike
 * By/Year, which were just left as orphaned data on the object — this one
 * actually erases the column's worth of text from every object's stored
 * `props`, not only from the type's property list.
 */
function dropCommentsProp(db) {
  migrateMediaProps(db);
  const upd = db.prepare('UPDATE objects SET props = ? WHERE id = ?');
  for (const row of db.prepare('SELECT id, props FROM objects WHERE type_id = ?').all(MEDIA_TYPE)) {
    let props;
    try {
      props = JSON.parse(row.props || '{}');
    } catch {
      continue;
    }
    if (!('comments' in props)) continue;
    delete props.comments;
    upd.run(JSON.stringify(props), row.id);
  }
}

// Wikimedia's API asks for a descriptive user-agent with a way to reach the
// operator, and rate-limits generic ones harder — see
// https://meta.wikimedia.org/wiki/User-Agent_policy.
const UA = { 'user-agent': 'Habitat/1.0 (personal desktop app, single-user cover lookup; no server)' };

/** Long enough for a slow source, short enough that a dead one doesn't hang the dialog. */
const TIMEOUT_MS = 12000;

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every lookup goes through here, because "it didn't work" was being reported
 * to the user as "check your connection" no matter what actually happened —
 * and the connection was rarely the problem. The failures seen in practice:
 *
 *   ECONNRESET from Open Library, roughly one search in three, and gone on an
 *     immediate retry.
 *   429 from Wikimedia, which used to be self-inflicted (see wikiSearch) and
 *     means wait a moment, not that the network is down.
 *   A throttled Wikimedia answering 200 with prose instead of JSON, which blew
 *     up in the JSON parse and looked like a connection failure too.
 *
 * The thrown message is a code the renderer maps to something a person can act
 * on. `json()` rather than `text()` + parse, so the tests' mocked responses
 * keep working.
 */
async function ask(url, { retries = 1, headers = UA } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      if (attempt < retries) {
        await pause(400);
        continue;
      }
      throw new Error(e?.name === 'TimeoutError' ? 'media:timeout' : 'media:offline');
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) {
        await pause(800);
        continue;
      }
      throw new Error(res.status === 429 ? 'media:busy' : 'media:down');
    }
    if (!res.ok) throw new Error('media:down');
    try {
      return await res.json();
    } catch {
      if (attempt < retries) {
        await pause(800);
        continue;
      }
      throw new Error('media:busy');
    }
  }
}

// A source's own tags rarely line up with GENRE_OPTIONS verbatim — TVmaze says
// "Science-Fiction", Wikipedia's categories say "science fiction action
// films" or "animated comedy films", Open Library's subjects say "Science-fiction".
// Matching by substring against synonyms per option catches these without
// needing a source-specific mapping for each.
const GENRE_SYNONYMS = {
  'Animation': ['animation', 'animated', 'anime'],
  'Romance': ['romance', 'romantic'],
  'Sci-Fi': ['sci-fi', 'science fiction', 'science-fiction'],
  'Non-fiction': ['non-fiction', 'nonfiction', 'documentary'],
};

/** Every GENRE_OPTIONS member mentioned anywhere in `tags`, in a fixed, predictable order. */
function genresIn(tags) {
  const hay = (tags || []).filter(Boolean).join(' | ').toLowerCase();
  return GENRE_OPTIONS.filter((g) => [g.toLowerCase(), ...(GENRE_SYNONYMS[g] || [])].some((w) => hay.includes(w)));
}

// ---------- movies ----------
//
// iTunes's `media=movie` filter turned out to come back empty for every query
// (Apple wound the movie store down without ever erroring on it), and even an
// unfiltered search over its catalogue is missing whole studios — Disney and
// Marvel titles never sold through iTunes simply aren't in it. Wikipedia has
// an article and an infobox poster for essentially every released film, needs
// no key, and has no meaningful quota for how rarely a person picks a cover.

const WIKI_SEARCH = 'https://en.wikipedia.org/w/api.php';

/**
 * Titles, their one-line description and their poster, in a single request.
 *
 * This used to be one search followed by a `page/summary` call per candidate —
 * nine requests fired at Wikimedia at once for one keystroke's worth of
 * searching. That is exactly the shape their rate limiter exists to stop, and
 * it worked: the burst got the address throttled, and the *next* search's very
 * first call came back 429, which the UI reported as "check your connection".
 *
 * `pageimages` rides along with the search instead, so a movie search is one
 * request that cannot throttle itself. `pilicense=any` matters — a film poster
 * is non-free, and the default of free-licensed images only returns nothing at
 * all for essentially every film.
 */
async function wikiSearch(term, bias) {
  const queryText = [term, bias].filter(Boolean).join(' ').trim();
  const q = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search',
    gsrsearch: queryText, gsrlimit: '50',
    prop: 'pageterms|pageimages', piprop: 'thumbnail', pithumbsize: '400', pilimit: '50', pilicense: 'any',
  });
  const data = await ask(`${WIKI_SEARCH}?${q}`);
  return Object.values(data.query?.pages || {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ title: p.title, description: p.terms?.description?.[0] || '', image: p.thumbnail?.source || null }));
}

/** "The Avengers (2012 film)" reads better on a card as just "The Avengers". */
const stripDisambiguation = (title) => title.replace(/\s*\([^)]*\)\s*$/, '');

/**
 * Gives higher priority to exact title matches (e.g. "The Kingdom" when searching "Kingdom")
 * over titles that only contain the search query as a substring (e.g. "Aquaman and the Lost Kingdom").
 */
function rankMovieHit(title, term) {
  const clean = stripDisambiguation(title).toLowerCase().trim();
  const t = term.toLowerCase().trim();
  const tBare = t.replace(/^the\s+/, '');
  const cleanBare = clean.replace(/^the\s+/, '');

  if (clean === t) return 0;
  if (cleanBare === tBare) return 1;
  if (cleanBare.startsWith(tBare)) return 2;
  if (clean.includes(t)) return 3;
  return 4;
}

async function searchWiki(term, bias, kindWords) {
  let rawHits = await wikiSearch(term, bias);
  let hits = rawHits.filter((h) => {
    const text = `${h.title} ${h.description}`.toLowerCase();
    return kindWords.some((w) => text.includes(w));
  });

  // If searching with the bias (e.g. "film") found nothing, try the bare term
  if (hits.length === 0 && bias) {
    rawHits = await wikiSearch(term, '');
    hits = rawHits.filter((h) => {
      const text = `${h.title} ${h.description}`.toLowerCase();
      return kindWords.some((w) => text.includes(w));
    });
  }

  return hits
    .filter((h) => h.image)
    .map((h) => {
      const text = `${h.description} ${h.title}`;
      const yearMatch = text.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? Number(yearMatch[0]) : null;
      return {
        id: h.title,
        title: stripDisambiguation(h.title),
        subtitle: h.description || stripDisambiguation(h.title),
        year,
        creator: null,
        image: h.image,
        _rank: rankMovieHit(h.title, term),
      };
    })
    .sort((a, b) => {
      if (a._rank !== b._rank) return a._rank - b._rank;
      return (b.year || 0) - (a.year || 0);
    })
    .slice(0, 30)
    .map(({ _rank, ...rest }) => rest);
}

const searchMovie = (term) => searchWiki(term, 'film', ['film', 'movie']);

// ---------- The Movie Database (TMDb) ----------

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

const TMDB_GENRES = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Non-fiction', // Documentary
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi', // Science Fiction
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action',
  10762: 'Family',
  10765: 'Sci-Fi',
};

let kvGetter = null;
let kvSetter = null;

function getActiveTmdbKey() {
  const envKey = process.env.TMDB_API_KEY ? process.env.TMDB_API_KEY.trim() : null;
  if (envKey) return envKey;
  if (typeof kvGetter === 'function') {
    const val = kvGetter('tmdb_api_key');
    if (val && typeof val === 'string' && val.trim()) return val.trim();
  }
  return null;
}

function maskKey(key) {
  if (!key) return null;
  if (key.length <= 8) return '••••' + key.slice(-2);
  return key.slice(0, 4) + '••••••••' + key.slice(-4);
}

function tmdbHeaders(key) {
  const isBearer = key.startsWith('eyJ') || key.length > 50;
  return isBearer ? { ...UA, authorization: `Bearer ${key}` } : UA;
}

function tmdbUrl(path, key, params = {}) {
  const isBearer = key.startsWith('eyJ') || key.length > 50;
  const q = new URLSearchParams(params);
  if (!isBearer) q.set('api_key', key);
  return `${TMDB_BASE}${path}?${q}`;
}

async function searchTmdbMovie(term, key) {
  const url = tmdbUrl('/search/movie', key, { query: term, include_adult: 'false', page: '1' });
  const data = await ask(url, { headers: tmdbHeaders(key) });
  return (data.results || [])
    .filter((m) => m.poster_path)
    .slice(0, 10)
    .map((m) => {
      const year = m.release_date ? Number(m.release_date.slice(0, 4)) : null;
      const genreNames = (m.genre_ids || []).map((id) => TMDB_GENRES[id]).filter(Boolean).slice(0, 2).join(' · ');
      return {
        id: `tmdb:${m.id}`,
        title: m.title || m.original_title,
        subtitle: [year, genreNames].filter(Boolean).join(' · ') || m.overview || '',
        year,
        creator: null,
        image: `${TMDB_IMAGE_BASE}${m.poster_path}`,
      };
    });
}

async function searchTmdbTv(term, key) {
  const url = tmdbUrl('/search/tv', key, { query: term, include_adult: 'false', page: '1' });
  const data = await ask(url, { headers: tmdbHeaders(key) });
  return (data.results || [])
    .filter((s) => s.poster_path)
    .slice(0, 10)
    .map((s) => {
      const year = s.first_air_date ? Number(s.first_air_date.slice(0, 4)) : null;
      const genreNames = (s.genre_ids || []).map((id) => TMDB_GENRES[id]).filter(Boolean).slice(0, 2).join(' · ');
      return {
        id: `tmdb_tv:${s.id}`,
        title: s.name || s.original_name,
        subtitle: [year, genreNames].filter(Boolean).join(' · ') || s.overview || '',
        year,
        creator: null,
        image: `${TMDB_IMAGE_BASE}${s.poster_path}`,
      };
    });
}

async function tmdbMovieGenres(id, key) {
  if (!key) return [];
  const tmdbId = String(id).replace(/^tmdb:/, '');
  const url = tmdbUrl(`/movie/${tmdbId}`, key);
  const data = await ask(url, { headers: tmdbHeaders(key) });
  return genresIn((data.genres || []).map((g) => g.name));
}

async function tmdbTvGenres(id, key) {
  if (!key) return [];
  const tmdbId = String(id).replace(/^tmdb_tv:/, '');
  const url = tmdbUrl(`/tv/${tmdbId}`, key);
  const data = await ask(url, { headers: tmdbHeaders(key) });
  return genresIn((data.genres || []).map((g) => g.name));
}

async function searchMovieWithFallback(term, tmdbKey) {
  if (tmdbKey) {
    try {
      const results = await searchTmdbMovie(term, tmdbKey);
      if (results.length > 0) return results;
    } catch {
      // Fall through to Wikipedia
    }
  }
  return searchMovie(term);
}

async function searchTvWithFallback(term, tmdbKey) {
  if (tmdbKey) {
    try {
      const results = await searchTmdbTv(term, tmdbKey);
      if (results.length > 0) return results;
    } catch {
      // Fall through to TVmaze
    }
  }
  return searchTv(term);
}

async function searchTv(term) {
  const data = await ask(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(term)}`);
  return (data || [])
    .map((r) => r.show)
    .filter((s) => s?.image?.original || s?.image?.medium)
    .slice(0, 10)
    .map((s) => ({
      id: String(s.id),
      title: s.name,
      subtitle: [s.network?.name || s.webChannel?.name, s.premiered?.slice(0, 4)].filter(Boolean).join(' · '),
      year: s.premiered ? Number(s.premiered.slice(0, 4)) : null,
      creator: s.network?.name || s.webChannel?.name || null,
      image: s.image.original || s.image.medium,
    }));
}

// Google Books' anonymous quota is shared across everyone hitting it without a
// key and is easy to exhaust from a single IP — it failed outright while this
// was being tested. Open Library carries its own cover images, has no quota
// on search, and needs no key either.
async function searchBook(term) {
  const data = await ask(
    `https://openlibrary.org/search.json?limit=10&fields=key,title,author_name,first_publish_year,cover_i&q=${encodeURIComponent(term)}`
  );
  return (data.docs || [])
    .filter((d) => d.cover_i)
    .map((d) => ({
      id: String(d.key || d.cover_i),
      title: d.title,
      subtitle: [d.author_name?.join(', '), d.first_publish_year].filter(Boolean).join(' · '),
      year: d.first_publish_year || null,
      creator: d.author_name?.join(', ') || null,
      image: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`,
    }));
}

/** One search, routed by kind — TMDb when key is available, falling back to Wikipedia/TVmaze, plus Open Library for books and comics. */
async function searchCovers({ kind, query, tmdbKey } = {}) {
  const term = String(query || '').trim();
  if (!term) return [];
  const key = tmdbKey || getActiveTmdbKey();
  if (kind === 'TV Show') return searchTvWithFallback(term, key);
  if (kind === 'Book' || kind === 'Comic') return searchBook(term);
  return searchMovieWithFallback(term, key);
}

// ---------- genre, fetched once a cover is actually picked ----------
//
// Every search result carries none of this — it would mean a lookup per
// candidate on screen for a value only the one actually chosen ever needs.
// One extra request at pick time gets it for whichever result that turns out
// to be, keyed by the same `id` the search result already carried.

/** The categories on a movie's own Wikipedia page — a genre lives in several of them at once. */
async function movieGenres(title) {
  const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'categories', cllimit: '50', titles: title });
  const data = await ask(`${WIKI_SEARCH}?${q}`);
  const page = Object.values(data.query?.pages || {})[0];
  return genresIn((page?.categories || []).map((c) => c.title));
}

async function tvGenres(id) {
  const data = await ask(`https://api.tvmaze.com/shows/${encodeURIComponent(id)}`);
  return genresIn(data.genres);
}

/** `id` is the Open Library work key from the search result, e.g. "/works/OL893414W". */
async function bookGenres(id) {
  if (!/^\/works\/\w+$/.test(String(id || ''))) return [];
  const data = await ask(`https://openlibrary.org${id}.json`);
  return genresIn(data.subjects);
}

async function genresFor(kind, id, tmdbKey = null) {
  if (!id) return [];
  const key = tmdbKey || getActiveTmdbKey();
  try {
    if (String(id).startsWith('tmdb:')) return await tmdbMovieGenres(id, key);
    if (String(id).startsWith('tmdb_tv:')) return await tmdbTvGenres(id, key);
    if (kind === 'TV Show') return await tvGenres(id);
    if (kind === 'Book' || kind === 'Comic') return await bookGenres(id);
    return await movieGenres(id);
  } catch {
    // A cover is still worth saving even when the genre lookup itself fails.
    return [];
  }
}

const MAX_COVER_BYTES = 12 * 1024 * 1024;

/**
 * Downloads a chosen cover and hands back its bytes. Nothing here touches the
 * database — the caller already owns turning bytes into a stored file.
 */
async function downloadCover(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('not a web address');
  let res;
  try {
    res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(e?.name === 'TimeoutError' ? 'media:timeout' : 'media:offline');
  }
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const mime = res.headers.get('content-type') || 'image/jpeg';
  if (!/^image\//.test(mime)) throw new Error('that link is not an image');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('the image came back empty');
  if (buffer.length > MAX_COVER_BYTES) throw new Error('that cover is too large');
  return { buffer, mime };
}

/**
 * IPC surface. `addFile(buffer, name, mime)` is the same store-then-remember
 * step `files:add` uses — passed in rather than duplicated, so a downloaded
 * cover lands in the files table exactly the way a pasted image does. The
 * genre lookup runs alongside the download rather than after it — whichever
 * finishes last is however long picking a cover ever takes.
 */
function channels({ addFile, getKv, setKv }) {
  if (getKv) kvGetter = getKv;
  if (setKv) kvSetter = setKv;
  return {
    'media:searchCovers': (payload) => searchCovers(payload || {}),
    'media:fetchCover': async ({ url, name, kind, id } = {}) => {
      const [{ buffer, mime }, genre] = await Promise.all([downloadCover(url), genresFor(kind, id)]);
      return { file: addFile(buffer, name || 'cover.jpg', mime), genre };
    },
    'media:tmdbStatus': () => {
      const key = getActiveTmdbKey();
      return { hasKey: Boolean(key), maskedKey: maskKey(key) };
    },
    'media:setTmdbKey': ({ key } = {}) => {
      const clean = typeof key === 'string' ? key.trim() : '';
      if (typeof kvSetter === 'function') {
        kvSetter('tmdb_api_key', clean || null);
      }
      const active = getActiveTmdbKey();
      return { hasKey: Boolean(active), maskedKey: maskKey(active) };
    },
  };
}

module.exports = {
  MEDIA_TYPE,
  MEDIA_PROPS,
  GENRE_OPTIONS,
  ensureMediaType,
  migrateMediaProps,
  dropCommentsProp,
  channels,
  searchCovers,
  downloadCover,
  genresFor,
  searchTmdbMovie,
  searchTmdbTv,
  tmdbMovieGenres,
  tmdbTvGenres,
  getActiveTmdbKey,
  maskKey,
};
