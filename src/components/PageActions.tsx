import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLayout } from '../layout';

/**
 * Where a pane's action bar is allowed to live. App.tsx renders one slot inside
 * each pane and puts it here.
 *
 * Per pane rather than per screen on purpose: panes stack on a phone, and a
 * single bar bolted to the bottom of the window would belong to whichever page
 * happened to render last while sitting under the other one. A slot inside the
 * pane means each page's controls stay attached to the page they act on.
 */
export const PaneSlot = createContext<HTMLElement | null>(null);

/**
 * The cluster of buttons a page keeps in its header — New, star, edit, the view
 * switcher, the date stepper.
 *
 * On the desktop this renders exactly where it is written and nothing changes.
 * On a narrow screen the row is the first thing to break: five or six controls
 * beside a title do not fit in 390px, and they were spilling off the right edge.
 * So they move to the foot of the pane, within reach of a thumb, and scroll
 * sideways if there are still too many.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const { narrow } = useLayout();
  const slot = useContext(PaneSlot);
  if (!narrow || !slot) return <>{children}</>;
  return createPortal(<div className="page-action-bar">{children}</div>, slot);
}
