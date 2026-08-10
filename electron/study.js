// Study — notes, decks, flashcards and the review log.
//
// Everything here lives in its own tables and nowhere else. Study does not
// create object types, does not write objects, and does not show up in the
// sidebar's type list: what you make in this tab stays in this tab. The one
// thread back to the vault is optional — a card cut from a note in the editor
// remembers which object it came from, so it can offer a link back.
//
// Cards get their own table rather than being objects because there can be tens
// of thousands of them, they carry scheduling state nothing else has, and the
// only question ever asked of them is "what is due now" — which wants an index,
// not a scan over parsed JSON.

const { randomUUID } = require('crypto');
const srs = require('./srs');

const uid = () => randomUUID().replace(/-/g, '').slice(0, 16);
const now = () => Date.now();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'deck',
  color TEXT NOT NULL DEFAULT '#7d4bd8',
  lang TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS study_notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  props TEXT NOT NULL DEFAULT '{}',
  deck_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  obj_id TEXT,
  note_id TEXT,
  kind TEXT NOT NULL DEFAULT 'basic',
  front TEXT NOT NULL DEFAULT '',
  back TEXT NOT NULL DEFAULT '',
  hint TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'new',
  due INTEGER NOT NULL DEFAULT 0,
  interval REAL NOT NULL DEFAULT 0,
  ease REAL NOT NULL DEFAULT 2.5,
  step INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  suspended INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  ms INTEGER NOT NULL DEFAULT 0,
  interval REAL NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  before TEXT NOT NULL DEFAULT '{}'
);
`;

/**
 * Indexes, kept apart from the tables and run *after* the column migrations.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so a
 * vault made by an earlier build keeps its old columns — and an index over a
 * column added since would be asked for before the ALTER that adds it, which
 * fails the whole statement and takes the app down on open. Tables first,
 * columns second, indexes last.
 */
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
CREATE INDEX IF NOT EXISTS idx_cards_obj ON cards(obj_id);
CREATE INDEX IF NOT EXISTS idx_cards_note ON cards(note_id);
CREATE INDEX IF NOT EXISTS idx_reviews_day ON reviews(day);
CREATE INDEX IF NOT EXISTS idx_reviews_card ON reviews(card_id);
`;

const json = (s, fallback) => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
};

/** The local day a review happened on, for the streak and the heat map. */
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const startOfDay = (ts) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function parseDeck(r) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    color: r.color,
    lang: r.lang,
    config: json(r.config, {}),
    createdAt: r.created_at,
  };
}

function parseNote(r) {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    /** Optional and free-form: subject, class, whatever the note wants naming. */
    props: json(r.props, {}),
    deckId: r.deck_id || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function parseCard(r) {
  return {
    id: r.id,
    deckId: r.deck_id,
    objId: r.obj_id || null,
    noteId: r.note_id || null,
    kind: r.kind,
    front: r.front,
    back: r.back,
    hint: r.hint,
    extra: json(r.extra, {}),
    state: r.state,
    due: r.due,
    interval: r.interval,
    ease: r.ease,
    step: r.step,
    reps: r.reps,
    lapses: r.lapses,
    suspended: !!r.suspended,
    lastAt: r.last_at,
    createdAt: r.created_at,
  };
}

/**
 * Pull front/back pairs out of a block of text, so a page of class notes becomes
 * a deck without anyone retyping it. Four shapes are understood, in this order:
 * an explicit Q:/A: pair, a sentence with {{braces}} around the part to hide, a
 * tab-separated pair, and one line split by a separator.
 *
 * Headings, bullets and ordinary prose are skipped rather than mangled — a note
 * is mostly writing, and only some of its lines are ever cards.
 */
function parseCards(text) {
  const out = [];
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    // A bullet is still a card if what follows the marker is a pair.
    const line = lines[i].replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '');

    const q = line.match(/^(?:q|question|front)\s*[:.\-]\s*(.+)$/i);
    if (q) {
      const next = (lines[i + 1] || '').replace(/^[-*•]\s+/, '');
      const a = next.match(/^(?:a|answer|back)\s*[:.\-]\s*(.+)$/i);
      if (a) {
        out.push({ kind: 'basic', front: q[1].trim(), back: a[1].trim() });
        i++;
        continue;
      }
    }

    // A cloze wins over a separator: "Paris {{is}} the capital" is one card with
    // a gap in it, not a pair split on the space.
    if (/\{\{[^}]+\}\}/.test(line)) {
      const answer = [...line.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1].trim()).join(', ');
      out.push({ kind: 'cloze', front: line.replace(/\{\{([^}]+)\}\}/g, '[…]'), back: answer, extra: { source: line } });
      continue;
    }

    // A markdown heading is a section title, not a question.
    if (/^#{1,6}\s/.test(line)) continue;
    // A lone "Q:" with no answer under it isn't a card — and must not be read as
    // a colon-separated pair with "Q" on the front.
    if (/^(?:q|a|question|answer|front|back)\s*[:.\-]/i.test(line)) continue;

    const split =
      line.match(/^([^\t]+?)\t+(.+)$/) ||
      line.match(/^(.+?)\s+(?:—|–|-{1,2}|=|:)\s+(.+)$/) ||
      line.match(/^([^:]{1,80}):\s*(.+)$/);
    if (split && split[1].trim() && split[2].trim()) {
      out.push({ kind: 'basic', front: split[1].trim(), back: split[2].trim() });
    }
  }
  return out;
}

/** The first line with anything on it — what an untitled note is called. */
const titleFromBody = (body) => {
  const first = String(body || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^#{1,6}\s+/, '').trim())
    .find(Boolean);
  return (first || '').slice(0, 80);
};

function create(getDb) {
  const db = () => getDb();

  const getDeck = (id) => {
    const r = db().prepare('SELECT * FROM decks WHERE id = ?').get(String(id));
    return r ? parseDeck(r) : null;
  };

  const getCard = (id) => {
    const r = db().prepare('SELECT * FROM cards WHERE id = ?').get(String(id));
    return r ? parseCard(r) : null;
  };

  const getNote = (id) => {
    const r = db().prepare('SELECT * FROM study_notes WHERE id = ?').get(String(id));
    return r ? parseNote(r) : null;
  };

  const makeDeck = ({ name, icon, color, lang, config } = {}) => {
    const id = uid();
    db().prepare('INSERT INTO decks (id, name, icon, color, lang, config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, String(name || 'New deck').trim() || 'New deck', String(icon || 'deck'), String(color || '#7d4bd8'),
      String(lang || ''), JSON.stringify(config || {}), now()
    );
    return getDeck(id);
  };

  /** The deck a language's words go into, made the first time it's needed. */
  const deckForLang = (lang) => {
    const name = String(lang || '').trim();
    if (!name) {
      const plain = db().prepare("SELECT * FROM decks WHERE lang = '' AND name = 'Vocabulary'").get();
      return plain ? parseDeck(plain) : makeDeck({ name: 'Vocabulary', icon: 'languages' });
    }
    const found = db().prepare('SELECT * FROM decks WHERE lang = ?').get(name);
    return found ? parseDeck(found) : makeDeck({ name, lang: name, icon: 'languages' });
  };

  const insertCard = (deckId, card) => {
    const id = uid();
    const fresh = srs.newCard(now());
    db().prepare(
      `INSERT INTO cards (id, deck_id, obj_id, note_id, kind, front, back, hint, extra, state, due, interval, ease, step, reps, lapses, suspended, last_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`
    ).run(
      id, String(deckId), card.objId ? String(card.objId) : null, card.noteId ? String(card.noteId) : null,
      String(card.kind || 'basic'), String(card.front || ''), String(card.back || ''), String(card.hint || ''),
      JSON.stringify(card.extra || {}),
      fresh.state, fresh.due, fresh.interval, fresh.ease, fresh.step, fresh.reps, fresh.lapses,
      now()
    );
    return getCard(id);
  };

  /** Counts per deck, split the way the review screen shows them. */
  const countsFor = (deckId, at) => {
    const row = db()
      .prepare(
        `SELECT
           SUM(CASE WHEN state = 'new' THEN 1 ELSE 0 END) AS fresh,
           SUM(CASE WHEN state IN ('learning','relearning') AND due <= ? THEN 1 ELSE 0 END) AS learning,
           SUM(CASE WHEN state = 'review' AND due <= ? THEN 1 ELSE 0 END) AS due,
           COUNT(*) AS total
         FROM cards WHERE deck_id = ? AND suspended = 0`
      )
      .get(at, at, String(deckId));
    return { new: row.fresh || 0, learning: row.learning || 0, due: row.due || 0, total: row.total || 0 };
  };

  /**
   * How many cards this deck has *introduced* today — cards whose very first
   * review was today. Reviews of old cards don't count against the new-card
   * allowance, which is the whole point of having a separate one.
   */
  const introducedToday = (deckId, at) =>
    db()
      .prepare(
        `SELECT COUNT(*) AS c FROM (
           SELECT card_id, MIN(at) AS first_at FROM reviews WHERE deck_id = ? GROUP BY card_id
         ) WHERE first_at >= ?`
      )
      .get(String(deckId), startOfDay(at)).c || 0;

  return {
    // ---------- decks ----------

    'study:decks': () => {
      const at = now();
      return db()
        .prepare('SELECT * FROM decks ORDER BY created_at')
        .all()
        .map((r) => ({ ...parseDeck(r), counts: countsFor(r.id, at) }));
    },

    'study:deckCreate': (p) => makeDeck(p || {}),

    'study:deckPatch': ({ id, patch }) => {
      const deck = getDeck(id);
      if (!deck) return null;
      const p = patch || {};
      if (p.name !== undefined) db().prepare('UPDATE decks SET name = ? WHERE id = ?').run(String(p.name), id);
      if (p.icon !== undefined) db().prepare('UPDATE decks SET icon = ? WHERE id = ?').run(String(p.icon), id);
      if (p.color !== undefined) db().prepare('UPDATE decks SET color = ? WHERE id = ?').run(String(p.color), id);
      if (p.lang !== undefined) db().prepare('UPDATE decks SET lang = ? WHERE id = ?').run(String(p.lang), id);
      if (p.config !== undefined) {
        db().prepare('UPDATE decks SET config = ? WHERE id = ?').run(JSON.stringify({ ...deck.config, ...p.config }), id);
      }
      return getDeck(id);
    },

    /** Deleting a deck takes its cards and its reviews. Notes are left alone. */
    'study:deckDelete': (id) => {
      db().prepare('DELETE FROM reviews WHERE deck_id = ?').run(String(id));
      db().prepare('DELETE FROM cards WHERE deck_id = ?').run(String(id));
      db().prepare('UPDATE study_notes SET deck_id = NULL WHERE deck_id = ?').run(String(id));
      db().prepare('DELETE FROM decks WHERE id = ?').run(String(id));
      return true;
    },

    'study:overview': () => {
      const at = now();
      const decks = db()
        .prepare('SELECT * FROM decks ORDER BY created_at')
        .all()
        .map((r) => ({ ...parseDeck(r), counts: countsFor(r.id, at) }));

      const totals = decks.reduce(
        (acc, d) => ({
          new: acc.new + d.counts.new,
          learning: acc.learning + d.counts.learning,
          due: acc.due + d.counts.due,
          total: acc.total + d.counts.total,
        }),
        { new: 0, learning: 0, due: 0, total: 0 }
      );

      const notes = db()
        .prepare('SELECT * FROM study_notes ORDER BY updated_at DESC LIMIT 12')
        .all()
        .map((r) => {
          const note = parseNote(r);
          return {
            ...note,
            // The list shows a line of the writing, not the whole page.
            body: note.body.slice(0, 180),
            cards: db().prepare('SELECT COUNT(*) AS c FROM cards WHERE note_id = ?').get(note.id).c,
          };
        });

      const from = dayKey(at - 365 * srs.DAY);
      const history = db()
        .prepare('SELECT day, COUNT(*) AS n FROM reviews WHERE day >= ? GROUP BY day ORDER BY day')
        .all(from)
        .map((r) => ({ day: r.day, n: r.n }));

      const seen = new Set(history.map((h) => h.day));
      let streak = 0;
      // Today not being done yet must not break a streak that is still alive.
      for (let i = seen.has(dayKey(at)) ? 0 : 1; i < 400; i++) {
        if (!seen.has(dayKey(at - i * srs.DAY))) break;
        streak++;
      }

      const reviewedToday = db().prepare('SELECT COUNT(*) AS c FROM reviews WHERE day = ?').get(dayKey(at)).c;

      return { decks, notes, totals, history, streak, reviewedToday };
    },

    // ---------- notes ----------

    'study:notes': () =>
      db()
        .prepare('SELECT * FROM study_notes ORDER BY updated_at DESC')
        .all()
        .map((r) => {
          const note = parseNote(r);
          return {
            ...note,
            body: note.body.slice(0, 180),
            cards: db().prepare('SELECT COUNT(*) AS c FROM cards WHERE note_id = ?').get(note.id).c,
          };
        }),

    'study:noteGet': (id) => {
      const note = getNote(id);
      if (!note) return null;
      return { ...note, cards: db().prepare('SELECT COUNT(*) AS c FROM cards WHERE note_id = ?').get(note.id).c };
    },

    'study:noteCreate': ({ title, body, props, deckId } = {}) => {
      const id = uid();
      const t = now();
      db().prepare(
        'INSERT INTO study_notes (id, title, body, props, deck_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, String(title || ''), String(body || ''), JSON.stringify(props || {}), deckId ? String(deckId) : null, t, t);
      return getNote(id);
    },

    'study:notePatch': ({ id, patch }) => {
      const note = getNote(id);
      if (!note) return null;
      const p = patch || {};
      const body = p.body !== undefined ? String(p.body) : note.body;
      // An untitled note takes its name from its first line, so the list is
      // readable without anyone having to name anything.
      const title = p.title !== undefined ? String(p.title) : note.title;
      // Properties merge, so setting one never clears the others. An empty
      // string removes the key rather than leaving a blank chip behind.
      const props = { ...note.props, ...(p.props || {}) };
      for (const [k, v] of Object.entries(props)) if (v === '' || v === null) delete props[k];
      db().prepare('UPDATE study_notes SET title = ?, body = ?, props = ?, deck_id = ?, updated_at = ? WHERE id = ?').run(
        title, body, JSON.stringify(props),
        p.deckId !== undefined ? (p.deckId ? String(p.deckId) : null) : note.deckId, now(), id
      );
      return getNote(id);
    },

    'study:noteDelete': (id) => {
      // The cards outlive the note they came from — they have their own history
      // by now, and losing a term because its page was tidied away would be a
      // surprise. They simply stop pointing at anything.
      db().prepare('UPDATE cards SET note_id = NULL WHERE note_id = ?').run(String(id));
      db().prepare('DELETE FROM study_notes WHERE id = ?').run(String(id));
      return true;
    },

    /**
     * Read a note and offer what it could become. `dry` changes nothing, which
     * is what the preview runs on; without it the cards are made, skipping any
     * this note has already produced so a second pass only adds what is new.
     */
    'study:noteToCards': ({ noteId, deckId, deckName, dry }) => {
      const note = getNote(noteId);
      if (!note) return { cards: [], deck: null };
      const found = parseCards(note.body);
      if (dry) return { cards: found, deck: null };

      let deck = deckId ? getDeck(deckId) : null;
      if (!deck) deck = makeDeck({ name: String(deckName || note.title || titleFromBody(note.body) || 'New deck') });

      const already = new Set(
        db().prepare('SELECT front FROM cards WHERE note_id = ?').all(note.id).map((r) => r.front.toLowerCase())
      );
      const made = found
        .filter((c) => !already.has(c.front.toLowerCase()))
        .map((c) => insertCard(deck.id, { ...c, noteId: note.id }));

      db().prepare('UPDATE study_notes SET deck_id = ?, updated_at = ? WHERE id = ?').run(deck.id, now(), note.id);
      return { cards: made, deck: getDeck(deck.id) };
    },

    // ---------- reviewing ----------

    /**
     * The cards to show next, in the order they should come up. Learning cards
     * that are ready go first — they are the ones about to be forgotten — then
     * reviews, then as many new cards as the deck's daily allowance still has
     * room for. `deckId` omitted studies everything at once.
     */
    'study:queue': ({ deckId, limit = 60 } = {}) => {
      const at = now();
      const scope = deckId ? 'AND c.deck_id = ?' : '';
      const args = deckId ? [String(deckId)] : [];

      const learning = db()
        .prepare(
          `SELECT c.* FROM cards c WHERE c.suspended = 0 AND c.state IN ('learning','relearning') AND c.due <= ? ${scope}
            ORDER BY c.due LIMIT ?`
        )
        .all(at, ...args, limit)
        .map(parseCard);

      const due = db()
        .prepare(
          `SELECT c.* FROM cards c WHERE c.suspended = 0 AND c.state = 'review' AND c.due <= ? ${scope}
            ORDER BY c.due LIMIT ?`
        )
        .all(at, ...args, limit)
        .map(parseCard);

      // The new-card allowance is per deck, so studying everything at once
      // doesn't blow through a month of a language in one sitting.
      const decks = deckId ? [getDeck(deckId)].filter(Boolean) : db().prepare('SELECT * FROM decks').all().map(parseDeck);
      const fresh = [];
      for (const deck of decks) {
        const cfg = srs.config(deck.config);
        const room = Math.max(0, cfg.newPerDay - introducedToday(deck.id, at));
        if (!room) continue;
        fresh.push(
          ...db()
            .prepare("SELECT * FROM cards WHERE deck_id = ? AND suspended = 0 AND state = 'new' ORDER BY created_at LIMIT ?")
            .all(deck.id, room)
            .map(parseCard)
        );
      }

      const queue = [...learning, ...due, ...fresh].slice(0, limit);
      const configs = Object.fromEntries(decks.map((d) => [d.id, srs.config(d.config)]));
      return {
        cards: queue.map((c) => ({ ...c, preview: srs.preview(c, configs[c.deckId], at) })),
        counts: deckId ? countsFor(deckId, at) : null,
      };
    },

    'study:answer': ({ id, rating, ms = 0 }) => {
      const card = getCard(id);
      if (!card) return null;
      const deck = getDeck(card.deckId);
      const at = now();
      const next = srs.schedule(card, Number(rating), deck?.config, at);

      db().prepare(
        'UPDATE cards SET state = ?, due = ?, interval = ?, ease = ?, step = ?, reps = ?, lapses = ?, last_at = ? WHERE id = ?'
      ).run(
        next.state, Math.round(next.due), next.interval, next.ease, next.step, next.reps, next.lapses, next.lastAt, card.id
      );

      // The card as it stood before the answer travels with the review, so undo
      // is a restore rather than a guess at what the schedule used to be.
      const before = {
        state: card.state,
        due: card.due,
        interval: card.interval,
        ease: card.ease,
        step: card.step,
        reps: card.reps,
        lapses: card.lapses,
        lastAt: card.lastAt,
      };
      db().prepare(
        'INSERT INTO reviews (id, card_id, deck_id, rating, ms, interval, at, day, before) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(uid(), card.id, card.deckId, Number(rating), Number(ms) || 0, next.interval, at, dayKey(at), JSON.stringify(before));

      const updated = getCard(card.id);
      return { card: { ...updated, preview: srs.preview(updated, deck?.config, at) }, counts: countsFor(card.deckId, at) };
    },

    /** Take back the last answer — the card returns to exactly where it was. */
    'study:undo': () => {
      const last = db().prepare('SELECT * FROM reviews ORDER BY at DESC, rowid DESC LIMIT 1').get();
      if (!last) return null;
      const card = getCard(last.card_id);
      if (!card) return null;
      const was = json(last.before, null);
      const restored = was ?? { ...srs.newCard(card.createdAt), reps: Math.max(0, card.reps - 1) };

      db().prepare(
        'UPDATE cards SET state = ?, due = ?, interval = ?, ease = ?, step = ?, reps = ?, lapses = ?, last_at = ? WHERE id = ?'
      ).run(
        restored.state, Math.round(restored.due), restored.interval, restored.ease,
        restored.step, restored.reps, restored.lapses, restored.lastAt ?? null, card.id
      );
      db().prepare('DELETE FROM reviews WHERE id = ?').run(last.id);
      return getCard(card.id);
    },

    // ---------- cards ----------

    'study:cards': ({ deckId, q = '', limit = 500 } = {}) => {
      const needle = String(q || '').trim().toLowerCase();
      const rows = deckId
        ? db().prepare('SELECT * FROM cards WHERE deck_id = ? ORDER BY created_at DESC LIMIT ?').all(String(deckId), limit)
        : db().prepare('SELECT * FROM cards ORDER BY created_at DESC LIMIT ?').all(limit);
      const cards = rows.map(parseCard);
      return needle
        ? cards.filter((c) => c.front.toLowerCase().includes(needle) || c.back.toLowerCase().includes(needle))
        : cards;
    },

    'study:cardCreate': ({ deckId, front, back, hint, kind, objId, noteId }) => {
      if (!getDeck(deckId)) return null;
      return insertCard(deckId, { front, back, hint, kind: kind || 'basic', objId, noteId });
    },

    'study:cardPatch': ({ id, patch }) => {
      const card = getCard(id);
      if (!card) return null;
      const p = patch || {};
      if (p.front !== undefined) db().prepare('UPDATE cards SET front = ? WHERE id = ?').run(String(p.front), id);
      if (p.back !== undefined) db().prepare('UPDATE cards SET back = ? WHERE id = ?').run(String(p.back), id);
      if (p.hint !== undefined) db().prepare('UPDATE cards SET hint = ? WHERE id = ?').run(String(p.hint), id);
      if (p.deckId !== undefined) db().prepare('UPDATE cards SET deck_id = ? WHERE id = ?').run(String(p.deckId), id);
      if (p.suspended !== undefined) db().prepare('UPDATE cards SET suspended = ? WHERE id = ?').run(p.suspended ? 1 : 0, id);
      /** Put a card back at the start, forgetting everything it had earned. */
      if (p.reset) {
        const fresh = srs.newCard(now());
        db().prepare(
          'UPDATE cards SET state = ?, due = ?, interval = ?, ease = ?, step = 0, reps = 0, lapses = 0, last_at = NULL WHERE id = ?'
        ).run(fresh.state, fresh.due, fresh.interval, fresh.ease, id);
      }
      return getCard(id);
    },

    'study:cardDelete': (id) => {
      db().prepare('DELETE FROM reviews WHERE card_id = ?').run(String(id));
      db().prepare('DELETE FROM cards WHERE id = ?').run(String(id));
      return true;
    },

    /** Turn a block of text into cards. `dry` previews without writing anything. */
    'study:cardsFromText': ({ deckId, text, objId, noteId, dry }) => {
      const parsed = parseCards(text);
      if (dry) return parsed;
      if (!getDeck(deckId)) return [];
      return parsed.map((c) => insertCard(deckId, { ...c, objId, noteId }));
    },

    /**
     * Add a word. One card by default — term on the front, meaning on the back.
     * The deck's "ask both ways" setting adds the reverse, and it is off unless
     * asked for: two rows appearing for one word you typed once reads as a bug,
     * however useful the second one turns out to be.
     */
    'study:vocabAdd': ({ term, meaning, reading, example, language, deckId }) => {
      const front = String(term || '').trim();
      const back = String(meaning || '').trim();
      if (!front || !back) return null;

      const deck = deckId ? getDeck(deckId) || deckForLang(language) : deckForLang(language);
      const note = String(reading || '').trim();
      const extra = { reading: note, example: String(example || '').trim() };
      const hint = extra.example;

      const cards = [
        insertCard(deck.id, {
          kind: 'vocab',
          front,
          back: note ? `${back}\n${note}` : back,
          hint,
          extra: { ...extra, dir: 'recognition' },
        }),
      ];

      if (deck.config.reverse === true) {
        cards.push(
          insertCard(deck.id, {
            kind: 'vocab',
            front: back,
            back: note ? `${front}\n${note}` : front,
            hint,
            extra: { ...extra, dir: 'recall' },
          })
        );
      }

      return { deck: { ...deck, counts: countsFor(deck.id, now()) }, cards };
    },

    /** The languages already in use, so the entry form can offer them back. */
    'study:languages': () => {
      const fromDecks = db().prepare("SELECT DISTINCT lang FROM decks WHERE lang != ''").all().map((r) => r.lang);
      return [...new Set(fromDecks)].sort();
    },

    'study:history': ({ days = 120 } = {}) => {
      const from = dayKey(now() - days * srs.DAY);
      return db()
        .prepare(
          `SELECT day, COUNT(*) AS n, SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS again
             FROM reviews WHERE day >= ? GROUP BY day ORDER BY day`
        )
        .all(from)
        .map((r) => ({ day: r.day, n: r.n, again: r.again || 0 }));
    },
  };
}

/**
 * A card cut from a note in the vault loses its link when that object goes, but
 * not itself — it has its own review history by now. Study owns no objects, so
 * this is the whole of its interest in the rest of the app.
 */
function forgetObject(db, objectId) {
  db.prepare('UPDATE cards SET obj_id = NULL WHERE obj_id = ?').run(String(objectId));
  return 0;
}

module.exports = { SCHEMA, INDEXES, create, forgetObject, parseCards, titleFromBody };
