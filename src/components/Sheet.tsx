import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { softSpring } from '../motion';

/**
 * A bottom sheet: the touch answer to an anchored popover.
 *
 * A popover works on the desktop because it can sit beside the thing it belongs
 * to and the pointer is already there. On a phone there is often no room beside
 * anything, and the finger that opened it is covering the spot — so the panel
 * comes up from the bottom instead, where the thumb already is.
 *
 * Built here rather than in the overlay phase because RowActions needs it. The
 * overlay work then only has to route the existing popover, modal and palette
 * families through this, rather than inventing a second one.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Optional heading. A sheet of plain actions usually reads fine without one. */
  title?: string;
  children: ReactNode;
}) {
  // Escape closes it, same as every other layer in the app — a phone can have a
  // keyboard attached, and this costs one listener.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="sheet-backdrop"
            className="sheet-backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          />
          {/* Same split as the drawer: the outer element slides, the inner one
              is what the finger drags. A `drag` owns its axis, and sharing one
              element leaves the exit animation fighting the gesture. */}
          <motion.div
            key="sheet"
            className="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={softSpring}
          >
            <motion.div
              className="sheet-drag"
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              dragSnapToOrigin
              onDragEnd={(_e, info) => {
                if (info.offset.y > 80 || info.velocity.y > 500) onClose();
              }}
            >
              {/* The grab handle is the affordance for the drag — without it the
                  gesture is undiscoverable, and the sheet looks like it can only
                  be dismissed by whatever is inside it. */}
              <div className="sheet-grip" />
              {title && <h3 className="sheet-title">{title}</h3>}
              <div className="sheet-body">{children}</div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
