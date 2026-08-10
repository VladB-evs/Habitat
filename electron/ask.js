// Answering questions about the vault: "summarise my daily note two days ago",
// "what did I do on the 5th of August", "do I have anything about the lease?"
//
// The model is the last step here, not the first. Everything that can be worked
// out is worked out in code — which day "two days ago" means, which notes are
// worth reading — and the model only ever sees text that is already in front of
// it, with the question. It is never asked to remember, to count back, or to
// know what it wasn't shown.
//
// That division is deliberate. A three-billion-parameter model is a good writer
// and an unreliable calculator, and its context window holds roughly four
// thousand tokens — nothing like a vault. Retrieval has to be exact because the
// model can't check it.

/* ------------------------------------------------------------------ *
 * Which day is being asked about
 * ------------------------------------------------------------------ */

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const key = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (k) => new Date(k + 'T12:00:00');
const shift = (k, days) => {
  const d = dateOf(k);
  d.setDate(d.getDate() + days);
  return key(d);
};

/** How the answer names the day back to the user — "yesterday" beats "2026-08-07". */
function label(from, to, today) {
  if (from !== to) return `${pretty(from)} – ${pretty(to)}`;
  if (from === today) return 'today';
  if (from === shift(today, -1)) return 'yesterday';
  if (from === shift(today, 1)) return 'tomorrow';
  return pretty(from);
}

const pretty = (k) =>
  dateOf(k).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Finds the day or span a question is about, or null when it names none.
 *
 * Deliberately conservative: an unrecognised phrase returns null and the
 * question falls through to a text search, which is a worse answer than the
 * right date but a much better one than the wrong date.
 */
function extractDates(question, today) {
  const q = ` ${String(question || '').toLowerCase()} `;
  const span = (from, to = from) => ({ from, to, label: label(from, to, today) });

  // Relative, in rough order of how specific the phrase is — "the day before
  // yesterday" has to be tried before "yesterday" or it matches the wrong half.
  if (/\bday before yesterday\b/.test(q)) return span(shift(today, -2));
  if (/\bday after tomorrow\b/.test(q)) return span(shift(today, 2));
  if (/\byesterday\b/.test(q)) return span(shift(today, -1));
  if (/\btomorrow\b/.test(q)) return span(shift(today, 1));
  if (/\btoday\b|\btonight\b|\bthis morning\b|\bthis afternoon\b/.test(q)) return span(today);

  const ago = q.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week|month)s?\s+ago\b/);
  if (ago) {
    const n = NUMBER_WORDS[ago[1]] ?? Number(ago[1]);
    if (Number.isFinite(n) && n > 0 && n < 400) {
      if (ago[2] === 'day') return span(shift(today, -n));
      // A week or a month ago is a stretch of days, not one of them — nobody
      // means the single date exactly thirty days back.
      if (ago[2] === 'week') return span(shift(today, -7 * n), shift(today, -7 * (n - 1)));
      return span(shift(today, -30 * n), shift(today, -30 * (n - 1)));
    }
  }

  if (/\blast week\b|\bpast week\b|\bthis week\b/.test(q)) return span(shift(today, -7), today);
  if (/\blast month\b|\bpast month\b/.test(q)) return span(shift(today, -30), today);

  // "last tuesday", "on friday" — always the one just gone, never the one coming.
  const named = q.match(/\b(?:last|on|this|)\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (named) {
    const want = DAYS.indexOf(named[1]);
    for (let back = 1; back <= 7; back++) {
      const k = shift(today, -back);
      if (dateOf(k).getDay() === want) return span(k);
    }
  }

  // An explicit day: 2026-08-05.
  const iso = q.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return span(`${iso[1]}-${iso[2]}-${iso[3]}`);

  // "5 August", "the 5th of August", "August 5th", with an optional year.
  const months = MONTHS.join('|');
  const dayFirst = q.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${months})\\b(?:\\s+(\\d{4}))?`));
  const monthFirst = q.match(new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`));
  const found = dayFirst
    ? { day: Number(dayFirst[1]), month: MONTHS.indexOf(dayFirst[2]), year: dayFirst[3] }
    : monthFirst
      ? { day: Number(monthFirst[2]), month: MONTHS.indexOf(monthFirst[1]), year: monthFirst[3] }
      : null;

  if (found && found.day >= 1 && found.day <= 31) {
    let year = found.year ? Number(found.year) : dateOf(today).getFullYear();
    const made = new Date(year, found.month, found.day, 12);
    // Guard against a date that rolled over — 31 February becomes 3 March.
    if (made.getMonth() !== found.month) return null;
    // Without a year, a date in the future almost certainly means last year:
    // people ask what they did, not what they will do.
    if (!found.year && key(made) > today) {
      made.setFullYear(year - 1);
    }
    return span(key(made));
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * What the model is allowed to read
 * ------------------------------------------------------------------ */

/**
 * The whole context budget, in characters. Roughly a thousand tokens of notes,
 * which leaves the rest of the window for the question and a full answer.
 */
const CONTEXT_CHARS = 3600;
/** Past this many sources the model starts blurring them together. */
const MAX_SOURCES = 5;

const STOPWORDS = new Set([
  'a', 'about', 'all', 'am', 'an', 'and', 'any', 'anything', 'are', 'around', 'as', 'at', 'be', 'been', 'before',
  'concerning', 'did', 'do', 'does', 'find', 'for', 'from', 'get', 'give', 'got', 'had', 'has', 'have', 'how',
  'i', 'in', 'is', 'it', 'its', 'me', 'mention', 'mentioned', 'my', 'note', 'notes', 'of', 'on', 'or', 'page',
  'pages', 'regarding', 'said', 'say', 'show', 'some', 'something', 'summarise', 'summarize', 'summary', 'tell',
  'that', 'the', 'their', 'there', 'these', 'they', 'this', 'those', 'to', 'told', 'was', 'were', 'what', 'when',
  'where', 'which', 'who', 'why', 'with', 'write', 'wrote', 'you', 'your',
]);

/**
 * The words worth searching for. Dropping the scaffolding of the question — "do
 * I have any pages regarding" — matters because every one of those words would
 * otherwise be matched against the notes and drown the two that mean anything.
 */
function keywords(question) {
  return String(question || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}'-]+/u)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Words that only carried the date. Once `extractDates` has read them they are
 * spent — left in the subject, "do I have any tasks today" ends up asking what
 * the notes say *about today*, and the answer is that they do not mention it.
 */
const TEMPORAL = new Set([
  'today', 'tonight', 'tomorrow', 'yesterday', 'day', 'days', 'week', 'weeks', 'month', 'months',
  'ago', 'last', 'past', 'this', 'morning', 'afternoon', 'evening', 'night',
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
]);


/**
 * "movies" and "movie" are the same word to a person, and should be to the type
 * list. English being what it is, both plural rules are tried and a match on
 * either counts — "movies" wants the -s rule, "stories" wants the -ies one, and
 * guessing wrong on either silently loses the type.
 */
function forms(word) {
  const w = String(word).toLowerCase();
  const out = new Set([w]);
  if (w.endsWith('s')) out.add(w.slice(0, -1));
  if (w.endsWith('ies')) out.add(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) out.add(w.slice(0, -2));
  return out;
}

const alike = (a, b) => [...forms(a)].some((x) => forms(b).has(x));

/**
 * The kind of thing a question is about, when it names one: "any tasks today",
 * "what movies did I watch", "which books am I reading".
 *
 * This is what makes the difference between searching the text of notes and
 * searching the vault. Asking for movies finds nothing by text — the word
 * "movie" appears nowhere in a list of films — but it is exactly a type.
 */
function matchType(question, types = []) {
  const words = String(question || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  // Longest name first, so "Daily Note" wins over "Note" when both would fit.
  return (
    [...types]
      .sort((a, b) => String(b.name).length - String(a.name).length)
      .find((t) => {
        const parts = String(t.name || '').toLowerCase().split(/\s+/).filter(Boolean);
        return parts.length > 0 && parts.every((part) => words.some((w) => alike(w, part)));
      }) || null
  );
}

/**
 * "Do I have any pages about the lease?" is a yes/no question only on the
 * surface — answered as one it comes back "Yes, there are notes about the
 * lease", which the list of sources already said, better.
 *
 * Asking the model more firmly doesn't fix it; a model this size answers the
 * question in front of it. So the question is rewritten before it gets there.
 * What the user typed is what stays on screen — this is only what the model is
 * handed.
 */
const EXISTENCE = [
  /^\s*(?:do|does|did|have)\s+(?:i|we)\s+(?:have|got|write|written|note[d]?|save[d]?)\b/i,
  /^\s*(?:is|are)\s+there\s+(?:any|anything)\b/i,
  /^\s*(?:any|anything)\b/i,
  /^\s*(?:show|find|list)\s+(?:me\s+)?(?:any|all|my)?\b/i,
];

function focus(question, { type = null, subject = [], dated = false } = {}) {
  if (!EXISTENCE.some((re) => re.test(question))) return question;

  // "Do I have any tasks today" names a kind and nothing else. Rewritten as
  // "what do these notes say about tasks" it comes back "two tasks are due
  // today" — true, and missing the only part worth having. What's wanted is
  // which ones.
  // Replacing the question outright loses too much — a bare "name each one" has
  // nothing to be about, and the model answers that nothing matches. Keeping the
  // question and appending the instruction holds both.
  if (type && !subject.length) return `${question.replace(/\s*\?\s*$/, '')}? Name each one.`;

  // Otherwise the subject is whatever the question was about — literally, after
  // the word "about". Failing that, the words left once the scaffolding is gone.
  const about = question.match(/\b(?:about|on|regarding|concerning|mentioning|to do with)\s+(.+?)\s*\??$/i);
  const topic = (about ? about[1] : subject.join(' '))
    .replace(/^(?:the|a|an|my)\s+/i, '')
    .split(/\s+/)
    // "…about the lease today" was already narrowed to today by the retrieval.
    .filter((w) => w && !(dated && TEMPORAL.has(w.toLowerCase())))
    .join(' ')
    .trim();
  return topic ? `What do these notes say about ${topic}?` : question;
}

/** Share the budget out, so one long note can't crowd every other one off. */
function trim(sources, budget = CONTEXT_CHARS) {
  if (!sources.length) return [];
  const each = Math.max(300, Math.floor(budget / sources.length));
  return sources.map((s) => {
    const text = String(s.text || '').replace(/\s+/g, ' ').trim();
    return { ...s, text: text.length > each ? text.slice(0, each) + '…' : text };
  });
}

/**
 * Builds the request. `lookup` is the vault, injected so this stays testable
 * without a database: `onDates({from,to})` and `search(words)` both return
 * objects carrying flattened `text`.
 */
function askRequest({ question, today, lookup, types = [] }) {
  const asked = String(question || '').trim();
  if (!asked) return { error: 'Ask a question first.' };

  const dates = extractDates(asked, today);
  const type = matchType(asked, types);
  const words = keywords(asked);
  // Words that only named the type carry no meaning of their own — "any tasks
  // about the lease" should search for the lease among tasks, not for "tasks".
  const subject = words.filter((w) => {
    // The kind and the date are both already expressed as exact constraints;
    // matching them again as text would narrow the answer to notes that happen
    // to contain the words "task" or "today".
    if (type && String(type.name).toLowerCase().split(/\s+/).some((part) => alike(w, part))) return false;
    if (dates && (TEMPORAL.has(w) || /^\d+(?:st|nd|rd|th)?$/.test(w))) return false;
    return true;
  });

  // A named day is an exact answer to "which things", so it wins over searching.
  // Falling back to a text search when that day is empty would answer a
  // different question than the one that was asked.
  let sources = dates
    ? lookup.onDates({ ...dates, typeId: type?.id })
    : lookup.search({ words: subject, typeId: type?.id });

  // "What movies did I watch" leaves "watch" as the subject, and no film has
  // that word in it. A named kind is an exact constraint, so when the words
  // inside it match nothing, the kind itself is still the answer — the question
  // was about movies. Note this only applies without a date: "any tasks
  // tomorrow" with nothing due must say so, not list every task there is.
  if (!sources.length && type && !dates) sources = lookup.ofType(type.id);

  if (!sources.length) {
    const kind = type ? String(type.name).toLowerCase() : null;
    return {
      error: dates
        ? `Nothing${kind ? ` of kind “${kind}”` : ''} is filed under ${dates.label}.`
        : `Nothing in the vault looks related to that.`,
      dates,
    };
  }

  sources = trim(sources.slice(0, MAX_SOURCES));

  // What each thing is, and its properties, matter as much as its text: "do I
  // have any tasks today" is answered by the titles and statuses of tasks, and
  // most tasks have no body at all.
  const notes = sources
    .map((s, i) => {
      const head = [s.typeName, s.dateKey ? pretty(s.dateKey) : null].filter(Boolean).join(', ');
      return [
        `[${i + 1}] ${s.title || 'Untitled'}${head ? ` (${head})` : ''}`,
        s.detail || null,
        s.text || null,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  return {
    dates,
    type: type ? { id: type.id, name: type.name } : null,
    sources: sources.map(({ id, title, typeId, dateKey }) => ({ id, title, typeId, dateKey })),
    request: {
      // "Only" and "say so" are the two load-bearing words. Without them the
      // model fills gaps from its own training, which in a notes app reads as
      // the app making things up about your life.
      instructions:
        'You answer questions about the notes you are given, and nothing else. Use only what is in them. ' +
        'If they do not answer the question, say so plainly in one sentence. ' +
        // "Do I have anything about the lease?" is a yes/no question only on the
        // surface. Answered as one it comes back "Yes, there are notes about the
        // lease", which the user could already see from the list of sources.
        'When asked whether the notes mention something, say what they actually say about it rather than only yes or no. ' +
        // Short structured notes — a couple of tasks with their properties — tempt
        // the model into copying the numbered blocks back before answering. But
        // told simply not to list anything it goes the other way and reports
        // "two tasks are due today" without saying which, which is worse. Both
        // halves of this sentence are holding one of those failures down.
        'Name the things you are talking about, but never reproduce the numbered blocks or their property lines. ' +
        'Reply in one or two plain sentences, as if speaking to the person whose notes these are. ' +
        // The retrieval already answered "which ones" exactly. Left to judge for
        // itself the model compares the dates it can see against a "today" it
        // has no way to know, and concludes there are no tasks today while
        // holding two of them. Saying the filtering is done removes the question.
        'Everything you have been given already matches what was asked, including its dates — do not check them or rule anything out. ' +
        'Be brief and concrete. Do not invent names, dates or numbers. Do not add a preamble.',
      prompt: `Notes:\n\n${notes}\n\nQuestion: ${focus(asked, { type, subject, dated: !!dates })}`,
      // Near-greedy: this is a question about facts, and the variation a warmer
      // setting buys is variation in how completely the notes get reported.
      temperature: 0.1,
    },
  };
}

module.exports = { extractDates, keywords, matchType, focus, askRequest, CONTEXT_CHARS, MAX_SOURCES };
