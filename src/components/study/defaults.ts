import type { DeckConfig } from '../../types';

/**
 * The deck settings the scheduler falls back to, mirrored here so a settings
 * form can show real numbers before anything has been saved. The main process
 * (electron/srs.js) is the authority — these are the same values, for display.
 */
export const srsDefaults: Required<Pick<DeckConfig, 'newPerDay' | 'reviewsPerDay' | 'reverse'>> = {
  newPerDay: 20,
  reviewsPerDay: 200,
  /** One card per word unless a deck asks for the reverse too. */
  reverse: false,
};
