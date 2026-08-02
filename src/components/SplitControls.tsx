import { motion } from 'motion/react';
import { useApp } from '../store';
import { Icon } from './Icons';

/**
 * Split right / split down, rendered inside each page's own header row rather
 * than floating over the page's top-right corner, where they sat on top of
 * whatever the page happened to put there.
 *
 * Single pane only: once there are two, the pane bar carries these controls
 * along with the close button, and a second copy in the page would be noise.
 */
export function SplitControls() {
  const { panes, split } = useApp();
  if (panes.length > 1) return null;

  return (
    <span className="split-controls">
      <motion.button
        className="icon-btn"
        onClick={() => split('row')}
        aria-label="Split right"
        title="Split right"
        whileHover={{ scale: 1.12 }}
        whileTap={{ scale: 0.9 }}
      >
        <Icon name="columns" size={15} />
      </motion.button>
      <motion.button
        className="icon-btn"
        onClick={() => split('col')}
        aria-label="Split down"
        title="Split down"
        whileHover={{ scale: 1.12 }}
        whileTap={{ scale: 0.9 }}
      >
        <Icon name="rows" size={15} />
      </motion.button>
    </span>
  );
}
