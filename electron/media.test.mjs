// Media (movies, TV shows, books & comics) is a builtin object type plus two
// small lookups: search for a cover, and download the one that's picked. The
// type seeding is exercised against a real vault; the lookups are exercised
// against a stubbed `fetch` so the suite never touches the network.

import { createRequire } from 'node:module';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');
const media = require('./media.js');

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-media-'));
const file = path.join(vault, 'test.db');
const api = dbmod.api;

before(() => {
  dbmod.initDb(file);
  dbmod.seedFlavor('personal');
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(vault, { recursive: true, force: true });
});

test('Media ships as a builtin type with the fields the tracker needs', () => {
  const type = api['types:list']().find((t) => t.id === 'media');
  assert.ok(type, 'the type exists');
  assert.equal(type.builtin, true);
  const ids = type.properties.map((p) => p.id);
  for (const id of ['kind', 'status', 'rating', 'cover', 'genre', 'started', 'finished']) assert.ok(ids.includes(id), id);
  // Replaced by Started/Finished — a watch/read date is what this tracker is for.
  assert.ok(!ids.includes('year'));
  assert.ok(!ids.includes('creator'));
  // Dropped for duplicating the note body every object already has.
  assert.ok(!ids.includes('comments'));
});

test('dropCommentsProp erases the field from the type and from every object that had written one', () => {
  // Puts the vault back into the "before this migration ran" shape: the type
  // carries Comments again, and one object has actually used it.
  const type = api['types:list']().find((t) => t.id === 'media');
  const withComments = [...type.properties, { id: 'comments', name: 'Comments', kind: 'longtext' }];
  api['types:update']({ id: 'media', patch: { properties: withComments } });
  const withNote = api['objects:create']({ typeId: 'media', title: 'Old entry', props: { kind: 'Movie', comments: 'loved it' } });
  const withoutNote = api['objects:create']({ typeId: 'media', title: 'No comment', props: { kind: 'Movie' } });

  // `runOnce` only ever fires the real migration once per vault, so the
  // function itself is exercised directly here, against a raw connection to
  // the same file — the same way db.js's own migrate() calls it.
  const { DatabaseSync } = require('node:sqlite');
  dbmod.closeDb();
  const raw = new DatabaseSync(file);
  media.dropCommentsProp(raw);
  raw.close();
  dbmod.initDb(file);

  const migrated = dbmod.api['types:list']().find((t) => t.id === 'media');
  assert.ok(!migrated.properties.some((p) => p.id === 'comments'), 'gone from the type');

  const a = dbmod.api['objects:get'](withNote.id);
  assert.ok(!('comments' in a.props), 'erased from the object, not just orphaned');
  assert.equal(a.props.kind, 'Movie', 'its other data is untouched');

  const b = dbmod.api['objects:get'](withoutNote.id);
  assert.equal(b.props.kind, 'Movie', 'an object that never had one is left alone');
});

test('reopening the vault does not duplicate the type or reset a rename', () => {
  assert.equal(api['types:list']().filter((t) => t.id === 'media').length, 1);
  // A user could have renamed it — the migration running again on the next
  // launch must not clobber that.
  api['types:update']({ id: 'media', patch: { name: 'My Watchlist' } });
  dbmod.closeDb();
  dbmod.initDb(file);
  const types = dbmod.api['types:list']().filter((t) => t.id === 'media');
  assert.equal(types.length, 1);
  assert.equal(types[0].name, 'My Watchlist');
});

test('an object can be created against the Media type like any other', () => {
  const o = api['objects:create']({ typeId: 'media', title: 'Arrival', props: { kind: 'Movie', status: 'Finished', rating: 5 } });
  assert.equal(o.typeId, 'media');
  assert.equal(o.props.rating, 5);
  const fetched = api['objects:get'](o.id);
  assert.equal(fetched.title, 'Arrival');
});

// ---------- cover search & fetch, network stubbed ----------

let originalFetch;
let calls;

beforeEach(() => {
  originalFetch = global.fetch;
  calls = [];
});

afterEach(() => {
  global.fetch = originalFetch;
});

const jsonResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  headers: new Map([['content-type', 'application/json']]),
  json: async () => body,
});

// iTunes's movie search was tried first — its `media=movie` filter came back
// empty for every query, and even unfiltered it never carries whole studios
// (Disney/Marvel titles never sold on iTunes just aren't in its catalogue).
// Wikipedia has an infobox poster for essentially every released film instead.
// It is one request: the search ranks candidates by relevance and carries each
// one's short description and its thumbnail together. It used to be that search
// plus a `page/summary` call per candidate, which fired nine requests at once
// and got the address rate-limited — see wikiSearch.
test('searching a Movie gets titles, descriptions and posters from one Wikipedia request', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      query: {
        pages: {
          1: {
            index: 1,
            title: 'Arrival (2016 film)',
            terms: { description: ['2016 film directed by Denis Villeneuve'] },
            thumbnail: { source: 'https://x/arrival-poster.jpg' },
          },
          // Wikipedia search mixes in things that are not the film itself —
          // these must not come back as results.
          2: { index: 2, title: 'Arrival (Kongos album)', terms: { description: ['2012 studio album'] }, thumbnail: { source: 'https://x/album.jpg' } },
          3: { index: 3, title: 'Arrival of a Train', terms: {} },
        },
      },
    });
  };
  const res = await media.searchCovers({ kind: 'Movie', query: 'Arrival' });
  assert.equal(res.length, 1);
  assert.equal(res[0].title, 'Arrival'); // disambiguation stripped for display
  assert.equal(res[0].year, 2016);
  assert.equal(res[0].image, 'https://x/arrival-poster.jpg');
  assert.equal(calls.length, 1, 'one request, not one per candidate');
  // A poster is non-free, so the free-licence default finds nothing at all.
  assert.ok(calls[0].includes('pilicense=any'));
});

test('a Movie candidate the search carries no thumbnail for is dropped, not shown broken', async () => {
  global.fetch = async () =>
    jsonResponse({ query: { pages: { 1: { index: 1, title: 'Some Film', terms: { description: ['a film'] } } } } });
  assert.deepEqual(await media.searchCovers({ kind: 'Movie', query: 'x' }), []);
});

test('a transient reset is retried rather than reported as a dead connection', async () => {
  let n = 0;
  global.fetch = async () => {
    if (++n === 1) throw Object.assign(new Error('fetch failed'), { name: 'TypeError' });
    return jsonResponse([{ show: { id: 7, name: 'The Wire', premiered: '2002-06-02', image: { original: 'https://x/o.jpg' } } }]);
  };
  const res = await media.searchCovers({ kind: 'TV Show', query: 'wire' });
  assert.equal(n, 2, 'retried once');
  assert.equal(res.length, 1);
});

test('a rate-limited source says so, rather than blaming the connection', async () => {
  global.fetch = async () => jsonResponse({}, false, 429);
  await assert.rejects(media.searchCovers({ kind: 'TV Show', query: 'x' }), /media:busy/);
});

test('a source answering 200 with prose instead of JSON reads as busy, not as an outage', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => {
      throw new SyntaxError('Unexpected token Y');
    },
  });
  await assert.rejects(media.searchCovers({ kind: 'Movie', query: 'x' }), /media:busy/);
});

test('searching a TV Show hits TVmaze', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse([{ show: { id: 7, name: 'The Wire', premiered: '2002-06-02', network: { name: 'HBO' }, image: { original: 'https://x/o.jpg', medium: 'https://x/m.jpg' } } }]);
  };
  const res = await media.searchCovers({ kind: 'TV Show', query: 'The Wire' });
  assert.equal(res[0].title, 'The Wire');
  assert.equal(res[0].image, 'https://x/o.jpg');
  assert.match(calls[0], /tvmaze\.com\/search\/shows/);
});

test('searching a Book hits Open Library and builds its cover URL from the id', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      docs: [{ key: '/works/OL1W', title: 'Dune', author_name: ['Frank Herbert'], first_publish_year: 1965, cover_i: 12345 }],
    });
  };
  const res = await media.searchCovers({ kind: 'Book', query: 'Dune' });
  assert.equal(res[0].title, 'Dune');
  assert.equal(res[0].image, 'https://covers.openlibrary.org/b/id/12345-L.jpg');
  assert.match(calls[0], /openlibrary\.org\/search\.json/);
});

test('a Book result with no cover is dropped rather than shown blank', async () => {
  global.fetch = async () =>
    jsonResponse({ docs: [{ key: '/works/OL2W', title: 'No Cover Edition' }] });
  assert.deepEqual(await media.searchCovers({ kind: 'Book', query: 'x' }), []);
});

test('Comic routes to the same Open Library search as Book', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({ docs: [] });
  };
  await media.searchCovers({ kind: 'Comic', query: 'Watchmen' });
  assert.match(calls[0], /openlibrary\.org\/search\.json/);
});

test('an empty query never reaches the network', async () => {
  global.fetch = async () => {
    throw new Error('should not be called');
  };
  assert.deepEqual(await media.searchCovers({ kind: 'Movie', query: '  ' }), []);
});

test('downloadCover refuses anything that is not http(s) or not an image', async () => {
  await assert.rejects(() => media.downloadCover('file:///etc/passwd'), /web address/);

  global.fetch = async () => ({ ok: true, status: 200, headers: new Map([['content-type', 'text/html']]), arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(() => media.downloadCover('https://x/not-an-image'), /not an image/);
});

test('downloadCover hands back the bytes and mime of a real image response', async () => {
  const bytes = new TextEncoder().encode('pretend-jpeg-bytes');
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'image/jpeg']]),
    arrayBuffer: async () => bytes.buffer,
  });
  const { buffer, mime } = await media.downloadCover('https://x/cover.jpg');
  assert.equal(mime, 'image/jpeg');
  assert.equal(buffer.length, bytes.length);
});

test('media:fetchCover stores the download through addFile and returns its reference plus genre', async () => {
  const bytes = new TextEncoder().encode('pretend-jpeg-bytes');
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('tvmaze.com/shows/')) return jsonResponse({ genres: ['Drama', 'Crime'] });
    return { ok: true, status: 200, headers: new Map([['content-type', 'image/jpeg']]), arrayBuffer: async () => bytes.buffer };
  };
  const { file, genre } = await api['media:fetchCover']({ url: 'https://x/cover.jpg', name: 'The Wire.jpg', kind: 'TV Show', id: '7' });
  assert.match(file.hash, /^[a-f0-9]{64}$/);
  assert.equal(file.mime, 'image/jpeg');
  assert.equal(api['files:get'](file.hash).hash, file.hash);
  assert.deepEqual(genre, ['Crime', 'Drama']);
});

// ---------- genre, fetched once a cover is picked ----------

test('a TV Show genre lookup normalizes TVmaze\'s own tags against the fixed vocabulary', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({ genres: ['Science-Fiction', 'Reality'] }); // "Reality" has no home in GENRE_OPTIONS
  };
  const genre = await media.genresFor('TV Show', '7');
  assert.deepEqual(genre, ['Sci-Fi']);
  assert.match(calls[0], /tvmaze\.com\/shows\/7$/);
});

test('an animated Movie or TV Show normalizes "animated" and "anime" tags to Animation', async () => {
  global.fetch = async () => {
    return jsonResponse({
      query: { pages: { 1: { categories: [{ title: 'Category:2024 American computer-animated films' }] } } },
    });
  };
  const movieGenre = await media.genresFor('Movie', 'Some Film (2024 film)');
  assert.deepEqual(movieGenre, ['Animation']);

  global.fetch = async () => {
    return jsonResponse({ genres: ['Anime', 'Action'] });
  };
  const tvGenre = await media.genresFor('TV Show', '123');
  assert.deepEqual(tvGenre, ['Action', 'Animation']);
});

test('a Movie whose film indicator or year is only in its title is matched and cleaned', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      query: {
        pages: {
          1: {
            index: 1,
            title: 'The Kingdom (2024 Philippine film)',
            terms: { description: ['directed by Michael Tuviera'] },
            thumbnail: { source: 'https://x/kingdom.jpg' },
          },
        },
      },
    });
  };
  const res = await media.searchCovers({ kind: 'Movie', query: 'Kingdom' });
  assert.equal(res.length, 1);
  assert.equal(res[0].title, 'The Kingdom');
  assert.equal(res[0].year, 2024);
  assert.equal(res[0].image, 'https://x/kingdom.jpg');
});

test('searchWiki ranks exact and prefixed title matches higher than substring mentions', async () => {
  global.fetch = async () => {
    return jsonResponse({
      query: {
        pages: {
          1: {
            index: 1,
            title: 'Aquaman and the Lost Kingdom',
            terms: { description: ['2023 superhero film'] },
            thumbnail: { source: 'https://x/aquaman.jpg' },
          },
          2: {
            index: 2,
            title: 'The Kingdom (2024 Philippine film)',
            terms: { description: ['2024 Filipino film'] },
            thumbnail: { source: 'https://x/kingdom2024.jpg' },
          },
          3: {
            index: 3,
            title: 'Kingdom (2019 film)',
            terms: { description: ['2019 Japanese film'] },
            thumbnail: { source: 'https://x/kingdom2019.jpg' },
          },
        },
      },
    });
  };
  const res = await media.searchCovers({ kind: 'Movie', query: 'Kingdom' });
  assert.equal(res.length, 3);
  assert.equal(res[0].title, 'Kingdom');
  assert.equal(res[1].title, 'The Kingdom');
  assert.equal(res[1].year, 2024);
  assert.equal(res[2].title, 'Aquaman and the Lost Kingdom');
});

test('a Book genre lookup reads the Open Library work by its key', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({ subjects: ['Science fiction', 'American literature'] });
  };
  const genre = await media.genresFor('Book', '/works/OL893414W');
  assert.deepEqual(genre, ['Sci-Fi']);
  assert.match(calls[0], /openlibrary\.org\/works\/OL893414W\.json/);
});

test('a Book genre lookup refuses an id that is not a work key, without touching the network', async () => {
  global.fetch = async () => {
    throw new Error('should not be called');
  };
  assert.deepEqual(await media.genresFor('Book', '12345'), []);
});

test('a Movie genre lookup reads the Wikipedia page\'s own categories', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      query: { pages: { 1: { categories: [{ title: 'Category:2012 science fiction action films' }, { title: 'Category:Films directed by Joss Whedon' }] } } },
    });
  };
  const genre = await media.genresFor('Movie', 'The Avengers (2012 film)');
  assert.deepEqual(genre, ['Action', 'Sci-Fi']);
});

test('a failed genre lookup does not sink the whole cover fetch', async () => {
  assert.deepEqual(await media.genresFor('TV Show', ''), []);
  global.fetch = async () => {
    throw new Error('network is down');
  };
  assert.deepEqual(await media.genresFor('Movie', 'x'), []);
});

// ---------- TMDB (The Movie Database) tests ----------

test('searchTmdbMovie hits the TMDb movie search endpoint with api_key and extracts fields', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      results: [
        {
          id: 123456,
          title: 'The Kingdom',
          release_date: '2024-12-25',
          genre_ids: [28, 12],
          poster_path: '/poster123.jpg',
        },
      ],
    });
  };
  const results = await media.searchTmdbMovie('Kingdom', 'my_test_key_123');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'tmdb:123456');
  assert.equal(results[0].title, 'The Kingdom');
  assert.equal(results[0].year, 2024);
  assert.equal(results[0].image, 'https://image.tmdb.org/t/p/w500/poster123.jpg');
  assert.match(calls[0], /api\.themoviedb\.org\/3\/search\/movie/);
  assert.match(calls[0], /api_key=my_test_key_123/);
});

test('searchTmdbMovie uses Authorization Bearer header for JWT tokens', async () => {
  let authHeader = null;
  global.fetch = async (url, opts) => {
    calls.push(String(url));
    authHeader = opts?.headers?.authorization;
    return jsonResponse({ results: [] });
  };
  const longToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456ghi789jkl012mno345pqr678stu901';
  await media.searchTmdbMovie('Kingdom', longToken);
  assert.equal(authHeader, `Bearer ${longToken}`);
  assert.ok(!calls[0].includes('api_key='));
});

test('searchCovers uses TMDb when key is available and falls back to Wikipedia when empty', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    const u = String(url);
    if (u.includes('api.themoviedb.org')) {
      return jsonResponse({ results: [] }); // empty TMDb result triggers fallback
    }
    return jsonResponse({
      query: {
        pages: {
          1: {
            index: 1,
            title: 'Kingdom (2019 film)',
            terms: { description: ['2019 Japanese film'] },
            thumbnail: { source: 'https://x/wiki.jpg' },
          },
        },
      },
    });
  };
  const results = await media.searchCovers({ kind: 'Movie', query: 'Kingdom', tmdbKey: 'dummy_key' });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Kingdom');
  assert.equal(results[0].image, 'https://x/wiki.jpg');
  assert.ok(calls.some((c) => c.includes('api.themoviedb.org')));
  assert.ok(calls.some((c) => c.includes('en.wikipedia.org')));
});

test('genresFor with tmdb: prefix fetches TMDb movie details and maps genres', async () => {
  global.fetch = async (url) => {
    calls.push(String(url));
    return jsonResponse({
      genres: [
        { id: 16, name: 'Animation' },
        { id: 878, name: 'Science Fiction' },
      ],
    });
  };
  const genres = await media.genresFor('Movie', 'tmdb:99999', 'test_key');
  assert.deepEqual(genres, ['Animation', 'Sci-Fi']);
  assert.match(calls[0], /api\.themoviedb\.org\/3\/movie\/99999/);
});

test('tmdbStatus and setTmdbKey manage the key in kv and mask it', async () => {
  const setRes = await api['media:setTmdbKey']({ key: 'test_secret_api_key_456' });
  assert.equal(setRes.hasKey, true);
  assert.match(setRes.maskedKey, /^test.*••••.*\_456$/);

  const status = await api['media:tmdbStatus']();
  assert.equal(status.hasKey, true);
  assert.equal(status.maskedKey, setRes.maskedKey);

  // Clear key
  const clearRes = await api['media:setTmdbKey']({ key: '' });
  assert.equal(clearRes.hasKey, false);
  assert.equal(clearRes.maskedKey, null);
});

