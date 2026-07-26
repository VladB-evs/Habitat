import { ReactRenderer } from '@tiptap/react';
import type { MentionListHandle } from './components/MentionList';
import MentionList from './components/MentionList';

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

  const roomBelow = window.innerHeight - r.bottom - edge;
  const roomAbove = r.top - edge;
  const top =
    roomBelow >= h || roomBelow >= roomAbove
      ? Math.min(r.bottom + gap, window.innerHeight - h - edge)
      : r.top - h - gap;

  popup.style.left = Math.max(edge, Math.min(r.left, window.innerWidth - w - edge)) + 'px';
  popup.style.top = Math.max(edge, top) + 'px';
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

    const cleanup = () => {
      popup?.remove();
      component?.destroy();
      popup = null;
      component = null;
    };

    return {
      onStart: (props: any) => {
        component = new ReactRenderer(MentionList, { props: { ...props, ...extraProps }, editor: props.editor });
        popup = document.createElement('div');
        popup.className = 'mention-popup';
        popup.appendChild(component.element);
        document.body.appendChild(popup);
        setVisible(props.items);
        place(props.clientRect);
      },
      onUpdate: (props: any) => {
        component?.updateProps({ ...props, ...extraProps });
        setVisible(props.items);
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
