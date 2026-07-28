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
import { Clipboard } from '../clipboard';
import { EmojiPicker } from '../emoji';
import { mentionSuggestion } from '../mention';
import { loadEmoji } from '../emoji';
import { SlashCommands } from '../slash';
import { TagMention } from '../tagMention';
import { Media, storeFiles } from '../media';
import { MentionChip } from './MentionChip';
import { MediaView } from './MediaView';
import { SelectionMenu } from './SelectionMenu';

/**
 * Getting out of a list should be effortless: Enter on the empty item you just
 * made steps out of it, Backspace at the start of an item does the same, and
 * Escape drops back to body text from any depth of nesting. One step at a time,
 * so leaving a nested list outdents before it exits.
 *
 * Each shortcut has to report the key as handled once it has lifted anything:
 * a TipTap chain dispatches its transaction even when a later command in it
 * comes back false, and returning false then lets the list's own Enter run on
 * the state from before the lift — which is what used to put the bullet back.
 */
const ExitList = Extension.create({
  name: 'exitList',
  addKeyboardShortcuts() {
    const itemKind = (editor: any): string | null =>
      editor.isActive('taskItem') ? 'taskItem' : editor.isActive('listItem') ? 'listItem' : null;

    /** One level out of the list, or false when there's no list to leave. */
    const lift = (editor: any) => {
      const kind = itemKind(editor);
      return kind ? editor.commands.liftListItem(kind) : false;
    };

    /** All the way out, however deep. */
    const leave = ({ editor }: { editor: any }) => {
      let left = false;
      for (let i = 0; i < 10 && itemKind(editor); i++) {
        if (!lift(editor)) break;
        left = true;
      }
      return left;
    };

    return {
      Enter: ({ editor }) => editor.state.selection.$from.parent.content.size === 0 && lift(editor),
      Backspace: ({ editor }) => {
        const { empty, $from } = editor.state.selection;
        // Only from the very start of an item's first line — anywhere else
        // Backspace is ordinary editing, and joining into the item above is right.
        if (!empty || $from.parentOffset !== 0 || $from.index($from.depth - 1) !== 0) return false;
        return lift(editor);
      },
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

/** The node lives in media.ts; its look is a React view, like mention chips. */
const MediaBlock = Media.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MediaView);
  },
});

/**
 * Files arriving by paste or drop are stored first, then inserted at the point
 * they landed. Returning true keeps ProseMirror from also inserting whatever
 * text representation the drag carried.
 */
function takeFiles(editor: any, list: FileList | null | undefined, at?: number) {
  const files = list ? Array.from(list) : [];
  if (!files.length) return false;
  storeFiles(files).then((refs) => {
    if (!refs.length) return;
    const chain = editor.chain().focus();
    if (typeof at === 'number') chain.setTextSelection(at);
    chain.insertMedia(refs).run();
  });
  return true;
}

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
      MediaBlock,
      SlashCommands,
      EmojiPicker,
      ExitList,
      Clipboard,
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
      handlePaste: (view, event) => takeFiles(editorRef.current, event.clipboardData?.files),
      handleDrop: (view, event: any) => {
        // Dragging a media block within the note is ProseMirror's own business;
        // only files coming from outside are ours to store.
        if (!event.dataTransfer?.files?.length) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        return takeFiles(editorRef.current, event.dataTransfer.files, at);
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
