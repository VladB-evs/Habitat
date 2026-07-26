import type { Transition, Variants } from 'motion/react';

/** One spring for anything that moves in the layout — panes, panels, cards. */
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 };

/** A softer one for larger surfaces that travel further. */
export const softSpring: Transition = { type: 'spring', stiffness: 280, damping: 32 };

export const snap: Transition = { duration: 0.14, ease: [0.22, 1, 0.36, 1] };

/** Popovers, menus and hover cards: grow out of their anchor. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: -4 },
  shown: { opacity: 1, scale: 1, y: 0, transition: spring },
  gone: { opacity: 0, scale: 0.97, y: -2, transition: { duration: 0.1 } },
};

/** Modal cards over a dimmed backdrop. */
export const dialogIn: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 12 },
  shown: { opacity: 1, scale: 1, y: 0, transition: softSpring },
  gone: { opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.12 } },
};

/** Page content swapping inside a pane. */
export const pageIn: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  gone: { opacity: 0, y: -6, transition: { duration: 0.1 } },
};

/** Lists that deal themselves in: parent gets `stagger`, children get `dealtIn`. */
export const stagger: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
};

export const dealtIn: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.985 },
  shown: { opacity: 1, y: 0, scale: 1, transition: spring },
};
