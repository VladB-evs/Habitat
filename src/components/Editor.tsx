import { useEffect, useRef, useState } from 'react';
import { Extension } from '@tiptap/core';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import type { Editor as EditorType } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Mention from '@tiptap/extension-mention';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Mathematics } from '@tiptap/extension-mathematics';
import { createLowlight, common } from 'lowlight';
import 'katex/dist/katex.min.css';
import { useApp } from '../store';
import { BlockHandle } from '../blockHandle';
import { Clipboard } from '../clipboard';
import { EmojiPicker } from '../emoji';
import { mentionSuggestion } from '../mention';
import { loadEmoji } from '../emoji';
import { SlashCommands } from '../slash';
import { TagMention } from '../tagMention';
import { Media, storeFiles } from '../media';
import { isSafeUrl, linkify, openLink } from '../links';
import { CodeBlockView } from './CodeBlockView';
import { MathBar } from './MathBar';
import { MentionChip } from './MentionChip';
import { MediaView } from './MediaView';
import { SelectionMenu } from './SelectionMenu';
import { TableMenu } from './TableMenu';

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
 * Highlighting replaces StarterKit's plain code block. The node keeps its name,
 * so `/code`, ⌘-shortcuts and every note written before this all still work —
 * they just gain colour, and a bar for picking the language.
 */
const lowlight = createLowlight(common);

const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight });

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

/**
 * Somewhere to click when the note ends in something you can't type your way
 * out of — a table, an image, a list, a code block, where Enter either does
 * nothing useful or belongs to the block itself. A note ending in ordinary
 * prose gets no gap, and nothing is written to the document until you click.
 */
function KeepWriting({ editor }: { editor: EditorType | null }) {
  const [needed, setNeeded] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const check = () => {
      const last = editor.state.doc.lastChild;
      // A code block is a textblock too, but Enter inside one only adds a line.
      const canTypeOn = !!last && last.isTextblock && last.type.name !== 'codeBlock';
      setNeeded(!!last && !canTypeOn);
    };
    check();
    editor.on('transaction', check);
    return () => {
      editor.off('transaction', check);
    };
  }, [editor]);

  if (!editor || !needed || !editor.isEditable) return null;

  return (
    <div
      className="editor-tail"
      title="Click to keep writing"
      onClick={() =>
        editor.chain().insertContentAt(editor.state.doc.content.size, { type: 'paragraph' }).focus('end').run()
      }
    />
  );
}

export function Editor({
  content,
  placeholder,
  onSave,
  /** The object being edited, so a flashcard cut from this note remembers where it came from. */
  objectId,
}: {
  content: any;
  placeholder?: string;
  onSave: (json: any) => void;
  objectId?: string;
}) {
  const { openObject } = useApp();
  const [wrap, setWrap] = useState<HTMLElement | null>(null);
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
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      CodeBlock,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      // Inline maths: `$…$` renders through KaTeX, and shows its source again
      // whenever the caret is inside it. It stays plain text in the document,
      // so search, Markdown copy and the MCP tools need to know nothing.
      //
      // The regex is tighter than the extension's default, which happily turns
      // "$5 for $10" into an equation: the maths may not start or end with a
      // space, and a closing `$` followed by a digit is a price, not a sum.
      Mathematics.configure({
        regex: /\$([^\s$][^$]*?[^\s$]|[^\s$])\$(?!\d)/g,
        katexOptions: { throwOnError: false },
      }),
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
      /**
       * Links open through the main process, never in this window, so a note can
       * never navigate the app away from itself. `validate` is the gate on what a
       * stored href may be — imported and shared notes are not trusted content.
       */
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: ['http', 'https', 'mailto', 'tel'],
        validate: isSafeUrl,
        HTMLAttributes: { rel: 'noreferrer nofollow', target: '_blank' },
      }),
    ],
    // Bare URLs in notes written before links existed become clickable on the way
    // in, without rewriting what's stored. See linkify().
    content: content ? linkify(content) : undefined,
    onCreate: ({ editor }) => {
      editorRef.current = editor;
      // Warm the emoji table in the background so the first ':' is instant.
      loadEmoji();
    },
    editorProps: {
      // Note bodies are prose, so they opt back in to the spell checker the body turns off.
      attributes: { spellcheck: 'true' },
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
    // The wrapper is what the grip in the margin is positioned against.
    <div className="editor-wrap" ref={setWrap}>
      <EditorContent editor={editor} className="editor" />
      <KeepWriting editor={editor} />
      <BlockHandle editor={editor} container={wrap} />
      <MathBar editor={editor} />
      <TableMenu editor={editor} />
      <SelectionMenu editor={editor} objectId={objectId} />
    </div>
  );
}
