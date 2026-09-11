import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import { spring } from '../motion';
import { Icon } from './Icons';

/**
 * Five, always — a mood board isn't a place to fine-tune a number, it's a
 * one-tap "here's roughly how today went". The score is what makes that
 * useful later: a future graph over days/months/years just needs a number per
 * day, and this is the only place that number gets decided. No emoji on
 * purpose — these are the app's own line icons, in the app's own colors, not
 * borrowed glyphs that render differently on every platform.
 */
export const MOODS = [
  { score: 1, label: 'Awful', icon: 'angry', color: '#e5484d' },
  { score: 2, label: 'Bad', icon: 'frown', color: '#f2994a' },
  { score: 3, label: 'Okay', icon: 'meh', color: '#e0b400' },
  { score: 4, label: 'Good', icon: 'smile', color: '#6fcf97' },
  { score: 5, label: 'Great', icon: 'laugh', color: '#1baf7a' },
] as const;

export function moodMeta(score: number | undefined) {
  return MOODS.find((m) => m.score === score);
}

export function MoodPicker({ value, onPick }: { value?: number; onPick: (score: number | null) => void }) {
  return (
    <div className="mood-row" role="radiogroup" aria-label="Daily mood">
      {MOODS.map((m) => {
        const on = value === m.score;
        return (
          <motion.button
            key={m.score}
            type="button"
            role="radio"
            aria-checked={on}
            className={'mood-btn' + (on ? ' on' : '')}
            style={{ '--mood-color': m.color } as CSSProperties}
            // Tapping your current mood again clears it — the same low-friction
            // "didn't mean to log that" undo as everything else in the app.
            onClick={() => onPick(on ? null : m.score)}
            whileTap={{ scale: 0.94 }}
            transition={spring}
            title={on ? `${m.label} (click to clear)` : m.label}
            aria-label={m.label}
          >
            {on && (
              <motion.span
                layoutId="mood-sel"
                className="mood-sel"
                transition={spring}
              />
            )}
            <motion.span
              className="mood-icon-wrap"
              animate={{ scale: on ? 1.1 : 1 }}
              transition={spring}
            >
              <Icon name={m.icon} size={18} />
            </motion.span>
            <span className="mood-label">{m.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
