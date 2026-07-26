import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import EmojiList, { EmojiListHandle } from './components/EmojiList';
import { placePopup } from './suggestionPopup';

export interface EmojiItem {
  char: string;
  name: string;
  keywords: string;
  group: number;
}

/**
 * The table is ~80KB, so it loads on first use rather than with the app. Until
 * then the picker simply has nothing to show, which is the same as no match.
 */
let EMOJIS: EmojiItem[] = [];
export let GROUP_NAMES: string[] = [];
let loading: Promise<void> | null = null;

export const emojiCount = () => EMOJIS.length;

export function loadEmoji(): Promise<void> {
  if (EMOJIS.length) return Promise.resolve();
  if (!loading)
    loading = import('./emojiData').then(({ EMOJI_GROUPS, EMOJI_TABLE }) => {
      GROUP_NAMES = EMOJI_GROUPS;
      EMOJIS = EMOJI_TABLE.trim()
        .split('\n')
        .map((line) => {
          const [char, name, keywords, group] = line.split('|');
          return { char, name, keywords: keywords ?? '', group: Number(group) || 0 };
        });
    });
  return loading;
}

/** Name matches rank above keyword matches, so ":cat" leads with 🐱 rather than a tagged one. */
export function searchEmoji(query: string): EmojiItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return EMOJIS;
  const starts: EmojiItem[] = [];
  const inName: EmojiItem[] = [];
  const inTags: EmojiItem[] = [];
  for (const e of EMOJIS) {
    if (e.name.startsWith(q)) starts.push(e);
    else if (e.name.includes(q)) inName.push(e);
    else if (e.keywords.includes(q)) inTags.push(e);
  }
  return [...starts, ...inName, ...inTags].slice(0, 400);
}

const suggestionConfig = {
  char: ':',
  pluginKey: new PluginKey('emojiPicker'),
  allowSpaces: false,

  items: async ({ query }: { query: string }): Promise<EmojiItem[]> => {
    await loadEmoji();
    return searchEmoji(query);
  },

  command: ({ editor, range, props }: any) => {
    editor.chain().focus().insertContentAt(range, (props as EmojiItem).char + ' ').run();
  },

  render: () => {
    let component: ReactRenderer<EmojiListHandle> | null = null;
    let popup: HTMLDivElement | null = null;

    // A stray colon (URLs, times) leaves the menu empty — hide it rather than
    // hovering an empty box over the text.
    const setVisible = (items: unknown) => {
      if (!popup) return;
      popup.style.display = Array.isArray(items) && items.length === 0 ? 'none' : '';
    };

    const cleanup = () => {
      popup?.remove();
      component?.destroy();
      popup = null;
      component = null;
    };

    return {
      onStart: (props: any) => {
        component = new ReactRenderer(EmojiList, { props, editor: props.editor });
        popup = document.createElement('div');
        popup.className = 'mention-popup emoji-popup';
        popup.appendChild(component.element);
        document.body.appendChild(popup);
        setVisible(props.items);
        placePopup(popup, props.clientRect);
      },
      onUpdate: (props: any) => {
        component?.updateProps(props);
        setVisible(props.items);
        placePopup(popup, props.clientRect);
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
  },
};

export const EmojiPicker = Extension.create({
  name: 'emojiPicker',
  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...suggestionConfig } as any)];
  },
});
