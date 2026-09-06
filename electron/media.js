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

// A source's own tags rarely line up with GENRE_OPTIONS verbatim — TVmaze says
// "Science-Fiction", Wikipedia's categories say "science fiction action
// films", Open Library's subjects say "Science-fiction" or "Science fiction,
// general". Matching by substring against a couple of spellings per option
// catches all three without needing a source-specific mapping for each.
const GENRE_SYNONYMS = { 'Sci-Fi': ['sci-fi', 'science fiction', 'science-fiction'], 'Non-fiction': ['non-fiction', 'nonfiction', 'documentary'] };

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
const WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

/**
 * Titles plus their one-line description, ranked by relevance — one request,
 * `pageterms` riding along with the search so the kind can be filtered on
 * this side before anything is spent fetching a thumbnail for it.
 */
async function wikiSearch(term, bias) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search',
    gsrsearch: `${term} ${bias}`, gsrlimit: '10', prop: 'pageterms',
  });
  const res = await fetch(`${WIKI_SEARCH}?${q}`, { headers: UA });
  if (!res.ok) throw new Error(`Wikipedia said ${res.status}`);
  const data = await res.json();
  return Object.values(data.query?.pages || {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ title: p.title, description: p.terms?.description?.[0] || '' }));
}

/** The infobox image Wikipedia itself picked as the page's lead image — a poster, almost always. */
async function wikiThumb(title) {
  const res = await fetch(WIKI_SUMMARY + encodeURIComponent(title.replace(/ /g, '_')), { headers: UA });
  if (!res.ok) return null;
  const data = await res.json();
  return data.thumbnail?.source || null;
}

/** "The Avengers (2012 film)" reads better on a card as just "The Avengers". */
const stripDisambiguation = (title) => title.replace(/\s*\([^)]*\)\s*$/, '');

async function searchWiki(term, bias, kindWords) {
  const hits = (await wikiSearch(term, bias)).filter((h) => kindWords.some((w) => h.description.toLowerCase().includes(w)));
  const top = hits.slice(0, 8);
  const withThumbs = await Promise.all(top.map(async (h) => ({ ...h, image: await wikiThumb(h.title) })));
  return withThumbs
    .filter((h) => h.image)
    .map((h) => ({
      id: h.title,
      title: stripDisambiguation(h.title),
      subtitle: h.description,
      year: h.description.match(/\b(19|20)\d{2}\b/)?.[0] ? Number(h.description.match(/\b(19|20)\d{2}\b/)[0]) : null,
      creator: null,
      image: h.image,
    }));
}

const searchMovie = (term) => searchWiki(term, 'film', ['film', 'movie']);

async function searchTv(term) {
  const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(term)}`, { headers: UA });
  if (!res.ok) throw new Error(`TVmaze said ${res.status}`);
  const data = await res.json();
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
  const res = await fetch(
    `https://openlibrary.org/search.json?limit=10&fields=key,title,author_name,first_publish_year,cover_i&q=${encodeURIComponent(term)}`,
    { headers: UA }
  );
  if (!res.ok) throw new Error(`Open Library said ${res.status}`);
  const data = await res.json();
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

/** One search, routed by kind — the three sources needed to cover the four kinds this module tracks. */
async function searchCovers({ kind, query } = {}) {
  const term = String(query || '').trim();
  if (!term) return [];
  if (kind === 'TV Show') return searchTv(term);
  if (kind === 'Book' || kind === 'Comic') return searchBook(term);
  return searchMovie(term);
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
  const res = await fetch(`${WIKI_SEARCH}?${q}`, { headers: UA });
  if (!res.ok) return [];
  const data = await res.json();
  const page = Object.values(data.query?.pages || {})[0];
  return genresIn((page?.categories || []).map((c) => c.title));
}

async function tvGenres(id) {
  const res = await fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(id)}`, { headers: UA });
  if (!res.ok) return [];
  const data = await res.json();
  return genresIn(data.genres);
}

/** `id` is the Open Library work key from the search result, e.g. "/works/OL893414W". */
async function bookGenres(id) {
  if (!/^\/works\/\w+$/.test(String(id || ''))) return [];
  const res = await fetch(`https://openlibrary.org${id}.json`, { headers: UA });
  if (!res.ok) return [];
  const data = await res.json();
  return genresIn(data.subjects);
}

async function genresFor(kind, id) {
  if (!id) return [];
  try {
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
  const res = await fetch(url, { headers: UA });
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
function channels({ addFile }) {
  return {
    'media:searchCovers': (payload) => searchCovers(payload || {}),
    'media:fetchCover': async ({ url, name, kind, id } = {}) => {
      const [{ buffer, mime }, genre] = await Promise.all([downloadCover(url), genresFor(kind, id)]);
      return { file: addFile(buffer, name || 'cover.jpg', mime), genre };
    },
  };
}

module.exports = { MEDIA_TYPE, MEDIA_PROPS, GENRE_OPTIONS, ensureMediaType, migrateMediaProps, dropCommentsProp, channels, searchCovers, downloadCover, genresFor };
