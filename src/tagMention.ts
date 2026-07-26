import Mention from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import { api } from './api';
import { suggestionRenderer } from './suggestionPopup';
import type { MentionEntry } from './types';

interface TagEntry extends MentionEntry {
  create?: boolean;
}

const insertTag = (editor: any, id: string, label: string) =>
  editor
    .chain()
    .focus()
    .insertContent([{ type: 'tagMention', attrs: { id, label } }, { type: 'text', text: ' ' }])
    .run();

/**
 * `#` autocompletes existing tags and offers to create the typed one. Tags are
 * ordinary objects of the builtin `tag` type, so they link, backlink, and show
 * up in the graph exactly like everything else.
 */
const tagSuggestion: any = {
  char: '#',
  pluginKey: new PluginKey('tagMention'),

  items: async ({ query }: { query: string }): Promise<TagEntry[]> => {
    const name = query.trim();
    const found = (await api.tags.search(name)) as TagEntry[];
    const exact = found.some((t) => (t.title || '').toLowerCase() === name.toLowerCase());
    if (!name || exact) return found;
    return [...found, { id: '', typeId: 'tag', title: name, subtitle: 'Create new tag', create: true } as TagEntry];
  },

  command: ({ editor, range, props }: any) => {
    const item = props as TagEntry;
    if (!item.create) {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'tagMention', attrs: { id: item.id, label: item.title } },
          { type: 'text', text: ' ' },
        ])
        .run();
      return;
    }
    // Creating needs a round-trip, so clear the typed text first, then insert the
    // real node once the tag exists (and has an id to link to).
    editor.chain().focus().deleteRange(range).run();
    api.tags.ensure(item.title).then((tag) => {
      if (tag) insertTag(editor, tag.id, tag.title);
    });
  },

  render: suggestionRenderer({ emptyLabel: 'Type a name to create a tag' }),
};

export const TagMention = Mention.extend({
  name: 'tagMention',
}).configure({
  HTMLAttributes: { class: 'tag-chip' },
  renderText: ({ node }: any) => `#${node.attrs.label}`,
  renderHTML: ({ node }: any) => ['span', { class: 'tag-chip', 'data-id': node.attrs.id }, `#${node.attrs.label}`],
  suggestion: tagSuggestion,
});
