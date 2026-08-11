import { ReactRenderer } from '@tiptap/react';
import type { MentionListHandle } from './components/MentionList';
import MentionList from './components/MentionList';
import { viewport } from './util';

/**
 * Pins a caret popup below the cursor, flipping it above when the bottom of the
 * window is too close — a slash menu at the last line stays fully visible.
 */
export function placePopup(popup: HTMLElement | null, clientRect: (() => DOMRect | null) | null | undefined) {
  const r = clientRect?.();
  if (!r || !popup) return;
  const w = popup.offsetWidth || 300;
  const h = popup.offsetHeight || 240;
  const gap = 6;
  const edge = 8;

  // Measured against the visible viewport, not the window: with a soft keyboard
  // up the window still counts the rows the keyboard is sitting on, and a menu
  // clamped to it lands underneath the keyboard. These are the caret popups, so
  // the keyboard is always up when they matter.
  const v = viewport();
  const vTop = v.top + edge;
  const vBottom = v.top + v.height - edge;

  const roomBelow = vBottom - r.bottom;
  const roomAbove = r.top - vTop;
  const top = roomBelow >= h || roomBelow >= roomAbove ? Math.min(r.bottom + gap, vBottom - h) : r.top - h - gap;

  popup.style.left = Math.max(v.left + edge, Math.min(r.left, v.left + v.width - w - edge)) + 'px';
  popup.style.top = Math.max(vTop, top) + 'px';
}

/**
 * The floating list shared by @-mentions and #-tags: mounts MentionList outside
 * the React tree (TipTap renders suggestions imperatively) and keeps it pinned
 * to the caret.
 */
export function suggestionRenderer(
  extraProps: Record<string, unknown> = {},
  { hideWhenEmpty = false }: { hideWhenEmpty?: boolean } = {}
) {
  return () => {
    let component: ReactRenderer<MentionListHandle> | null = null;
    let popup: HTMLDivElement | null = null;

    // With allowSpaces the suggestion stays open while you keep typing, so a
    // menu with nothing in it is hidden rather than left hovering over the text.
    const setVisible = (items: unknown) => {
      if (!popup || !hideWhenEmpty) return;
      popup.style.display = Array.isArray(items) && items.length === 0 ? 'none' : '';
    };

    const place = (clientRect: (() => DOMRect | null) | null | undefined) => placePopup(popup, clientRect);

    // The caret hasn't moved but the room around it has: the keyboard sliding
    // up is exactly the moment a popup placed a frame earlier ends up behind
    // it. Held so the same rect can be re-measured against the new viewport.
    let lastRect: (() => DOMRect | null) | null | undefined = null;
    const reflow = () => place(lastRect);

    const cleanup = () => {
      visualViewport?.removeEventListener('resize', reflow);
      visualViewport?.removeEventListener('scroll', reflow);
      popup?.remove();
      component?.destroy();
      popup = null;
      component = null;
      lastRect = null;
    };

    return {
      onStart: (props: any) => {
        component = new ReactRenderer(MentionList, { props: { ...props, ...extraProps }, editor: props.editor });
        popup = document.createElement('div');
        popup.className = 'mention-popup';
        popup.appendChild(component.element);
        document.body.appendChild(popup);
        setVisible(props.items);
        lastRect = props.clientRect;
        place(props.clientRect);
        visualViewport?.addEventListener('resize', reflow);
        visualViewport?.addEventListener('scroll', reflow);
      },
      onUpdate: (props: any) => {
        component?.updateProps({ ...props, ...extraProps });
        setVisible(props.items);
        lastRect = props.clientRect;
        place(props.clientRect);
      },
      onKeyDown: (props: any) => {
        if (props.event.key === 'Escape') {
          cleanup();
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: cleanup,
    };
  };
}
