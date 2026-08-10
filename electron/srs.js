// The scheduler: SM-2 with learning steps, the shape Anki made familiar.
//
// Pure functions over a card and an answer — no database, no clock of its own.
// Everything it needs (the time, the randomness for fuzz) is passed in, so the
// same answer always produces the same schedule and the whole thing can be
// checked without a vault.
//
// Ratings are 1 Again, 2 Hard, 3 Good, 4 Easy.

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const AGAIN = 1;
const HARD = 2;
const GOOD = 3;
const EASY = 4;

/**
 * Deck settings. Times in the two step lists are minutes; everything else is
 * days or a multiplier.
 */
const DEFAULTS = {
  /** Where a new card goes before it earns a place in the review pile. */
  learningSteps: [1, 10],
  /** Where a review card goes after it is forgotten. */
  relearnSteps: [10],
  graduatingInterval: 1,
  easyInterval: 4,
  startingEase: 2.5,
  /** Floor on ease — below this a card comes back so often it never settles. */
  minEase: 1.3,
  easyBonus: 1.3,
  hardFactor: 1.2,
  /** What a lapse leaves of the old interval once the card is relearned. */
  lapseMultiplier: 0,
  maxInterval: 36500,
  newPerDay: 20,
  reviewsPerDay: 200,
};

const config = (deck) => ({ ...DEFAULTS, ...(deck || {}) });

/** A brand new card, before it has ever been shown. */
function newCard(now = Date.now()) {
  return {
    state: 'new',
    due: now,
    interval: 0,
    ease: DEFAULTS.startingEase,
    step: 0,
    reps: 0,
    lapses: 0,
    lastAt: null,
  };
}

const clampEase = (e, cfg) => Math.max(cfg.minEase, Math.round(e * 100) / 100);

const clampInterval = (days, cfg) => Math.min(cfg.maxInterval, Math.max(1, days));

/**
 * Spread intervals so cards learned together don't come back together forever.
 * Anything under three days is left alone — there is no room to spread it, and a
 * one-day card moving to two would be a real change rather than a nudge.
 */
function fuzz(days, rand) {
  if (days < 3) return days;
  const spread = Math.max(1, Math.round(days * 0.05));
  return days + Math.round((rand() * 2 - 1) * spread);
}

/** The interval a review card earns for an answer, before fuzz. */
function reviewInterval(card, rating, cfg) {
  const prior = Math.max(1, card.interval || 1);
  if (rating === HARD) return prior * cfg.hardFactor;
  if (rating === GOOD) return prior * card.ease;
  return prior * card.ease * cfg.easyBonus;
}

/**
 * Answer a card. Returns the fields that change — the caller writes them and
 * keeps the rest of the row as it was.
 */
function schedule(card, rating, deckConfig, now = Date.now(), rand = Math.random) {
  const cfg = config(deckConfig);
  const learn = cfg.learningSteps.length ? cfg.learningSteps : DEFAULTS.learningSteps;
  const relearn = cfg.relearnSteps.length ? cfg.relearnSteps : DEFAULTS.relearnSteps;

  const base = {
    reps: (card.reps || 0) + 1,
    lapses: card.lapses || 0,
    ease: card.ease || cfg.startingEase,
    lastAt: now,
  };

  /** Out of learning and into the review pile, on the given interval. */
  const graduateTo = (days) => {
    const interval = clampInterval(fuzz(days, rand), cfg);
    return { ...base, state: 'review', step: 0, interval, due: now + interval * DAY };
  };

  if (card.state === 'new' || card.state === 'learning') {
    if (rating === EASY) return graduateTo(cfg.easyInterval);
    if (rating === AGAIN) return { ...base, state: 'learning', step: 0, interval: 0, due: now + learn[0] * MINUTE };
    if (rating === HARD) {
      // Hard repeats the step it is on rather than moving forward — a card you
      // only just about remembered has not been learned.
      const at = Math.min(card.step || 0, learn.length - 1);
      return { ...base, state: 'learning', step: at, interval: 0, due: now + learn[at] * MINUTE };
    }
    // Good: on to the next step, or out of learning altogether.
    const next = (card.state === 'new' ? 0 : card.step || 0) + 1;
    if (next >= learn.length) return graduateTo(cfg.graduatingInterval);
    return { ...base, state: 'learning', step: next, interval: 0, due: now + learn[next] * MINUTE };
  }

  if (card.state === 'review') {
    if (rating === AGAIN) {
      const ease = clampEase(base.ease - 0.2, cfg);
      // What's left of the interval is kept for when it graduates again, so a
      // card that was on a six-month cycle doesn't restart from scratch.
      const kept = Math.max(1, Math.round((card.interval || 1) * cfg.lapseMultiplier));
      return {
        ...base,
        state: 'relearning',
        step: 0,
        ease,
        lapses: base.lapses + 1,
        interval: kept,
        due: now + relearn[0] * MINUTE,
      };
    }
    const ease =
      rating === HARD ? clampEase(base.ease - 0.15, cfg) : rating === EASY ? clampEase(base.ease + 0.15, cfg) : base.ease;
    const interval = clampInterval(fuzz(reviewInterval(card, rating, cfg), rand), cfg);
    return { ...base, ease, state: 'review', step: 0, interval, due: now + interval * DAY };
  }

  // relearning
  if (rating === AGAIN) return { ...base, state: 'relearning', step: 0, due: now + relearn[0] * MINUTE };
  if (rating === HARD) {
    const at = Math.min(card.step || 0, relearn.length - 1);
    return { ...base, state: 'relearning', step: at, due: now + relearn[at] * MINUTE };
  }
  if (rating === EASY) return graduateTo(Math.max(1, card.interval || 1) + 1);
  const next = (card.step || 0) + 1;
  if (next >= relearn.length) return graduateTo(Math.max(1, card.interval || 1));
  return { ...base, state: 'relearning', step: next, due: now + relearn[next] * MINUTE };
}

/** "10m", "3d", "1.2mo" — how long until a card comes back, said briefly. */
function humanGap(ms) {
  if (ms < MINUTE) return '<1m';
  if (ms < 60 * MINUTE) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.round(ms / (60 * MINUTE))}h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(days / 30 < 10 ? 1 : 0)}mo`;
  return `${(days / 365).toFixed(days / 365 < 10 ? 1 : 0)}y`;
}

/**
 * What each button would do, for the four labels under a card. Fuzz is taken out
 * here — a preview that disagreed with itself between renders would be worse
 * than one that is a few percent off.
 */
function preview(card, deckConfig, now = Date.now()) {
  const steady = () => 0.5;
  const out = {};
  for (const rating of [AGAIN, HARD, GOOD, EASY]) {
    const next = schedule(card, rating, deckConfig, now, steady);
    out[rating] = humanGap(Math.max(0, next.due - now));
  }
  return out;
}

/** Whether a card is waiting to be seen at this moment. */
const isDue = (card, now = Date.now()) => !card.suspended && card.due <= now;

module.exports = { schedule, preview, newCard, humanGap, isDue, DEFAULTS, config, AGAIN, HARD, GOOD, EASY, DAY, MINUTE };
