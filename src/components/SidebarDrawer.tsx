import { AnimatePresence, motion } from 'motion/react';
import { softSpring } from '../motion';
import { Sidebar } from './Sidebar';

/**
 * The sidebar on a narrow screen: a drawer that comes in from the **right**.
 *
 * Right rather than left because that is the side the hand holding the phone is
 * already on — a left drawer on a 390px screen asks for a thumb stretch across
 * the whole width, every time.
 *
 * <Sidebar> itself is untouched; only its container changes. That is the point
 * of doing this here rather than inside it: one component, two mounts, and no
 * `if (mobile)` running down the middle of the navigation.
 */
export function SidebarDrawer({
  open,
  onClose,
  onSearch,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  onSearch: () => void;
  onAsk?: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drawer-backdrop"
            className="drawer-backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          {/* Two elements, one for each job. A `drag` takes ownership of the
              axis it is given, so putting the gesture on the same element that
              slides in would leave the entrance animation stalled part-way. The
              outer panel slides; the inner one is what the finger moves. */}
          <motion.div
            key="drawer"
            className="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={softSpring}
          >
            <motion.div
              className="drawer-drag"
              // Throwing it back towards its own edge closes it. It springs
              // home on its own if the throw wasn't decisive enough.
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 0.5 }}
              dragSnapToOrigin
              onDragEnd={(_e, info) => {
                if (info.offset.x > 90 || info.velocity.x > 500) onClose();
              }}
            >
              {/* `pinned` draws the collapse arrow the right way round: from in
                  here the button's job is to put the drawer away. */}
              <Sidebar pinned onSearch={onSearch} onAsk={onAsk} onCollapse={onClose} />
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
