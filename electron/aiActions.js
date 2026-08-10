// What the model is actually asked, kept out of the UI.
//
// The on-device model is small — around three billion parameters — which shapes
// every line below. It follows short, blunt instructions well and drifts on long
// ones, and left to itself it will happily preface a rewrite with "Sure! Here's
// a friendlier version:". Hence the repeated "reply with X only": that sentence
// is doing real work, not being polite.

/**
 * @typedef {object} AiAction
 * @property {string} id
 * @property {string} label     shown in the selection toolbar
 * @property {string} icon      an `Icon` name from src/components/Icons.tsx
 * @property {string} instructions
 * @property {(text: string) => string} prompt
 * @property {number} [temperature]
 * @property {boolean} [appends] true when the reply extends the selection rather than replacing it
 */

const WRITER = 'You are a careful editor. Reply with the rewritten text only — no preamble, no quotes, no explanation.';

/** @type {AiAction[]} */
const ACTIONS = [
  {
    id: 'improve',
    label: 'Improve writing',
    icon: 'sparkles',
    instructions: WRITER,
    prompt: (t) => `Rewrite this so it reads better. Keep the meaning, the language and roughly the length.\n\n${t}`,
    temperature: 0.4,
  },
  {
    id: 'fix',
    label: 'Fix spelling & grammar',
    icon: 'check',
    instructions: WRITER,
    prompt: (t) =>
      `Correct the spelling, grammar and punctuation. Change nothing else — keep the wording and the tone exactly as they are.\n\n${t}`,
    temperature: 0.1,
  },
  {
    id: 'shorten',
    label: 'Make shorter',
    icon: 'minus',
    instructions: WRITER,
    prompt: (t) => `Rewrite this to be noticeably shorter while keeping every important point.\n\n${t}`,
    temperature: 0.3,
  },
  {
    id: 'lengthen',
    label: 'Expand',
    icon: 'plus',
    instructions: WRITER,
    prompt: (t) => `Expand this with more detail and explanation, in the same voice.\n\n${t}`,
    temperature: 0.5,
  },
  {
    id: 'summarize',
    label: 'Summarise',
    icon: 'quote',
    instructions: 'You summarise text. Reply with the summary only — no preamble, no title.',
    prompt: (t) => `Summarise this in two or three sentences.\n\n${t}`,
    temperature: 0.3,
  },
  {
    id: 'bullets',
    label: 'To bullet points',
    icon: 'list',
    instructions:
      'You restructure text into bullet points. Reply with the bullets only, one per line, each starting with "- ". No preamble, no heading.',
    // Without the last sentence the small model reliably signs off with one
    // final bullet restating the whole input.
    prompt: (t) =>
      `Turn this into a short list of bullet points, one point per bullet. Do not add a bullet that repeats the whole passage.\n\n${t}`,
    temperature: 0.3,
  },
  {
    id: 'continue',
    label: 'Continue writing',
    icon: 'pencil',
    instructions:
      'You continue a piece of writing. Reply with the continuation only — do not repeat any of the text you were given.',
    prompt: (t) => `Continue this naturally, in the same voice, for a paragraph or so.\n\n${t}`,
    temperature: 0.6,
    appends: true,
  },
];

/* ------------------------------------------------------------------ *
 * Turning a plain-English request into the search bar's own syntax
 * ------------------------------------------------------------------ */

/** The windows `due:`, `edited:` and `created:` accept — see parseQuery in db.js. */
const DUE = ['today', 'tomorrow', 'week', 'month', 'overdue'];
const PAST = ['today', 'yesterday', 'week', 'month'];

/** Enough tags to cover what anyone actually searches for, without filling the context window. */
const MAX_TAGS = 40;

/**
 * Builds the request for "find me…". The schema is assembled from the vault
 * itself, so `type` and `tag` can only come back as names that exist — the model
 * is not trusted to remember them, it is prevented from inventing them.
 */
function searchRequest({ text, types = [], tags = [] }) {
  const typeNames = types.map((t) => String(t.name || '').toLowerCase()).filter(Boolean);
  // A tag is only reachable by its title, and the query bar splits on spaces, so
  // `tag:reading list` would parse as a tag plus a stray word. Tags that can't be
  // written aren't offered — better than letting the model pick one that then
  // silently searches for something else.
  const tagNames = tags
    .map((t) => String(t.title || '').toLowerCase())
    .filter((name) => name && !/\s/.test(name))
    .slice(0, MAX_TAGS);

  // Order matters more than it looks: guided generation fills the fields in the
  // order they are declared, so every filter is decided before `words` is
  // written. Declared the other way round, the model commits to "tasks" as text
  // to match and only then notices it should have set the type instead.
  const properties = [];

  if (typeNames.length) {
    properties.push({
      name: 'type',
      type: 'enum',
      values: typeNames,
      optional: true,
      description: 'The kind of thing being asked for, when the request names one.',
    });
  }
  if (tagNames.length) {
    properties.push({
      name: 'tag',
      type: 'enum',
      values: tagNames,
      optional: true,
      description: 'A tag the request asks for, when it names one.',
    });
  }

  properties.push(
    {
      name: 'due',
      type: 'enum',
      values: DUE,
      optional: true,
      description: 'Only when the request is about a deadline — when something is due.',
    },
    {
      name: 'edited',
      type: 'enum',
      values: PAST,
      optional: true,
      description: 'Only when the request is about when something was last written or changed.',
    },
    {
      name: 'created',
      type: 'enum',
      values: PAST,
      optional: true,
      description: 'Only when the request is about when something was first made.',
    },
    {
      name: 'pinned',
      type: 'boolean',
      optional: true,
      description: 'True only when the request asks for pinned things.',
    },
    {
      name: 'words',
      type: 'string',
      optional: true,
      // The field the model keeps getting wrong: left alone it echoes back
      // "tasks" or "overdue", which then has to match as literal text and finds
      // nothing. The filters above already carry that meaning.
      description:
        'Only the subject matter to look for in the text, e.g. "calendar" or "dentist". Never the kind of thing, never a date, never the word pinned. Leave out entirely when the request names no subject.',
    }
  );

  // Worked examples rather than more rules: a model this size follows a pattern
  // it can see far better than a policy it has to apply. Each one is a mistake
  // it made without them — echoing the kind as text, inventing a type for a bare
  // subject, reading "wrote" as a deadline.
  const examples = [
    ['tasks about the calendar due this week', '{"type":"task","due":"week","words":"calendar"}'],
    ['dentist appointment', '{"words":"dentist appointment"}'],
    ['what did I write yesterday', '{"edited":"yesterday"}'],
    ['pinned books', '{"type":"book","pinned":true}'],
  ]
    .map(([q, a]) => `Request: ${q}\n${a}`)
    .join('\n');

  return {
    instructions:
      'You turn a request into search filters for a personal notes app. Set only the fields the request actually asks for; leave every other field out. Never guess.\n\n' +
      examples,
    prompt: `Request: ${text}`,
    temperature: 0.1,
    schema: { name: 'Query', type: 'object', properties },
  };
}

/** `tasks` and `task` are the same word to a person, and to the type resolver. */
const sameWord = (a, b) => {
  const norm = (v) => String(v).toLowerCase().replace(/s$/, '');
  return norm(a) === norm(b);
};

/**
 * The model's JSON, back as something the search bar can show and the user can
 * edit — `type:task due:week calendar`. Building the same string a person would
 * have typed keeps the feature honest: what it did is visible, and wrong is one
 * keystroke from right.
 */
function searchQuery(result, { types = [], tags = [] } = {}) {
  const parts = [];
  /** Whatever the query bar can actually carry: one token, no spaces. */
  const writable = (...candidates) =>
    candidates.map((c) => String(c || '').toLowerCase()).find((c) => c && !/\s/.test(c)) || null;

  // Types resolve by id as readily as by name, and an id is always one token —
  // so "Daily Note" comes back as `type:daily` instead of `type:daily note`,
  // which the query bar would have read as a type plus a loose word.
  const matchedType = result.type ? types.find((t) => sameWord(t.name, result.type)) : null;
  const type = matchedType ? writable(matchedType.id, matchedType.name) : null;
  const matchedTag = result.tag ? tags.find((t) => sameWord(t.title, result.tag)) : null;
  const tag = matchedTag ? writable(matchedTag.title) : null;

  if (type) parts.push(`type:${type}`);
  if (tag) parts.push(`tag:${tag}`);
  if (DUE.includes(result.due)) parts.push(`due:${result.due}`);
  if (PAST.includes(result.edited)) parts.push(`edited:${result.edited}`);
  if (PAST.includes(result.created)) parts.push(`created:${result.created}`);
  if (result.pinned === true) parts.push('is:pinned');

  // Words that only restate a filter would be matched as literal text and find
  // nothing, so they come out however firmly the instructions asked for them not
  // to be there.
  const noise = new Set(
    [
      ...DUE,
      ...PAST,
      'pinned',
      'overdue',
      // Both what the model said and what it resolved to: "Daily Note" is picked
      // as `daily`, but the word it would echo into the text is "note".
      ...(matchedType ? [matchedType.id, ...String(matchedType.name).split(/\s+/)] : []),
      ...(matchedTag ? [matchedTag.title] : []),
    ].filter(Boolean)
  );
  const words = String(result.words || '')
    .split(/\s+/)
    .filter((w) => w && ![...noise].some((n) => sameWord(n, w)));

  return [...parts, ...words].join(' ').trim();
}

const byId = new Map(ACTIONS.map((a) => [a.id, a]));

/** The catalogue the toolbar renders — prompts stay on this side. */
const list = () => ACTIONS.map(({ id, label, icon, appends }) => ({ id, label, icon, appends: !!appends }));

/** Build a request for the model, or null when the id isn't one of ours. */
function build(actionId, text) {
  const action = byId.get(actionId);
  if (!action) return null;
  return {
    instructions: action.instructions,
    prompt: action.prompt(text),
    temperature: action.temperature,
  };
}

module.exports = { ACTIONS, list, build, searchRequest, searchQuery };
