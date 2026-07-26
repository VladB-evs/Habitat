import { useEffect, useRef } from 'react';
import { Extension } from '@tiptap/core';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Mention from '@tiptap/extension-mention';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import { useApp } from '../store';
import { EmojiPicker } from '../emoji';
import { mentionSuggestion } from '../mention';
import { loadEmoji } from '../emoji';
import { SlashCommands } from '../slash';
import { TagMention } from '../tagMention';
import { MentionChip } from './MentionChip';
import { SelectionMenu } from './SelectionMenu';

/**
 * Leaving a list should land you in ordinary body text. Enter on an empty item
 * lifts out of the list (TipTap only does this for some list types), and Escape
 * leaves the list from anywhere — both end up as a plain top-level paragraph
 * rather than a paragraph still carrying the list's indent.
 */
const ExitList = Extension.create({
  name: 'exitList',
  addKeyboardShortcuts() {
    const leave = ({ editor }: { editor: any }) => {
      const kinds = ['listItem', 'taskItem'];
      if (!kinds.some((k) => editor.isActive(k))) return false;
      return editor
        .chain()
        .focus()
        .liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem')
        .setParagraph()
        .run();
    };

    return {
      Enter: ({ editor }) => (editor.state.selection.$from.parent.content.size === 0 ? leave({ editor }) : false),
      Escape: leave,
    };
  },
});

/**
 * Object mentions render through a React node view so each chip can show its type
 * icon, tick tasks off in place, and preview the object on hover.
 */
const ObjectMention = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** Set by `/task`: the chip opens with its title field focused. */
      draft: { default: false, rendered: false },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(MentionChip, { as: 'span' });
  },
});

export function Editor({ content, placeholder, onSave }: { content: any; placeholder?: string; onSave: (json: any) => void }) {
  const { openObject } = useApp();
  const openRef = useRef(openObject);
  openRef.current = openObject;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<any>(null);

  const editorRef = useRef<any>(null);
  const flush = () => {
    if (pending.current) {
      onSaveRef.current(pending.current);
      pending.current = null;
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flushRef.current();
    },
    []
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: placeholder || "Write something… '@' links an object, '/' runs a command, ':' picks an emoji",
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ObjectMention.configure({
        HTMLAttributes: { class: 'mention' },
        renderText: ({ node }: any) => `@${node.attrs.label}`,
        renderHTML: ({ node }: any) => ['span', { class: 'mention', 'data-id': node.attrs.id }, `${node.attrs.label}`],
        suggestion: mentionSuggestion,
      }),
      TagMention,
      SlashCommands,
      EmojiPicker,
      ExitList,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
    ],
    content: content || undefined,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      // Warm the emoji table in the background so the first ':' is instant.
      loadEmoji();
    },
    editorProps: {
      // Object mentions handle their own clicks in the node view; tags still go through here.
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name === 'tagMention' && node.attrs.id) {
          openRef.current(node.attrs.id);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      pending.current = editor.getJSON();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushRef.current(), 500);
    },
  });

  return (
    <>
      <EditorContent editor={editor} className="editor" />
      <SelectionMenu editor={editor} />
    </>
  );
}
