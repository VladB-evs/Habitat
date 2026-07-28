import { Extension } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import type { Fragment, Node as PMNode, Schema, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * What lands in the clipboard when you copy out of a note.
 *
 * ProseMirror's own plain text is every block joined by a blank line, so a list
 * comes out double-spaced and a blank line in the note becomes four newlines —
 * the "huge gaps" you get pasting into a chat or a plain text field. This
 * writes Markdown instead: headings keep their hashes, list items keep their
 * markers and sit on consecutive lines, and only real paragraph breaks get a
 * blank line between them.
 *
 * The HTML flavour is ProseMirror's, with the paragraph inside each list item
 * unwrapped: Word, Docs and Mail give that paragraph its own spacing, which is
 * the same gap again in a rich text editor.
 */

const MARKERS: Record<string, string> = { bold: '**', italic: '*', strike: '~~', code: '`' };

function marked(text: string, node: PMNode): string {
  if (!text.trim()) return text;
  let out = text;
  for (const mark of node.marks) {
    const m = MARKERS[mark.type.name];
    if (m) out = m + out + m;
  }
  return out;
}

/** Everything inside one block, as text: marks become Markdown, chips their label. */
function inlineText(node: PMNode): string {
  if (node.isText) return marked(node.text ?? '', node);
  const name = node.type.name;
  if (name === 'hardBreak') return '\n';
  if (name === 'mention') return `@${node.attrs.label ?? ''}`;
  if (name === 'tagMention') return `#${node.attrs.label ?? ''}`;
  if (name === 'media') return String(node.attrs.name || '');
  if (node.isLeaf) return '';
  let out = '';
  node.content.forEach((child) => {
    out += inlineText(child);
  });
  return out;
}

/** Indent every line but the first, so a wrapped or nested item stays under its marker. */
const hang = (text: string, pad: string) => text.split('\n').join('\n' + pad);

const prefix = (text: string, pad: string) =>
  text
    .split('\n')
    .map((l) => (l ? pad + l : pad.trimEnd()))
    .join('\n');

/** List items are tight — one line each, nested lists indented under their parent. */
function listText(list: PMNode, marker: (i: number, item: PMNode) => string): string {
  const lines: string[] = [];
  list.content.forEach((item, _offset, i) => {
    const mark = marker(i, item);
    const body = blocks(item.content).join('\n');
    lines.push(hang(mark + body, ' '.repeat(mark.length)));
  });
  return lines.join('\n');
}

function blockText(node: PMNode): string {
  const name = node.type.name;
  switch (name) {
    case 'heading':
      return `${'#'.repeat(node.attrs.level || 1)} ${inlineText(node)}`;
    case 'codeBlock':
      return '```' + (node.attrs.language || '') + '\n' + node.textContent + '\n```';
    case 'blockquote':
      return prefix(blocks(node.content).join('\n\n'), '> ');
    case 'horizontalRule':
      return '---';
    case 'bulletList':
      return listText(node, () => '- ');
    case 'orderedList':
      return listText(node, (i) => `${(node.attrs.start ?? 1) + i}. `);
    case 'taskList':
      return listText(node, (_i, item) => (item.attrs.checked ? '- [x] ' : '- [ ] '));
    default:
      return node.isTextblock ? inlineText(node) : blocks(node.content).join('\n\n');
  }
}

/**
 * The blocks of a fragment, empty ones dropped — a note's breathing room is
 * spacing, not content, and repeating it as blank lines is what makes pasted
 * text sprawl. A partial selection arrives as loose inline nodes; those join
 * back into one block.
 */
function blocks(fragment: Fragment): string[] {
  const out: string[] = [];
  let inline = '';
  const flush = () => {
    if (inline.trim()) out.push(inline);
    inline = '';
  };
  fragment.forEach((child) => {
    if (child.isInline) {
      inline += inlineText(child);
      return;
    }
    flush();
    const text = blockText(child);
    if (text.trim()) out.push(text);
  });
  flush();
  return out;
}

export const asMarkdown = (fragment: Fragment): string => blocks(fragment).join('\n\n');

/** ProseMirror's HTML, minus the paragraph wrapper inside list items. */
function htmlSerializer(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  const serializer = new DOMSerializer(base.nodes, base.marks);
  const serializeFragment = serializer.serializeFragment.bind(serializer);
  serializer.serializeFragment = ((fragment: any, options: any, target: any) => {
    const dom = serializeFragment(fragment, options, target);
    for (const li of Array.from((dom as DocumentFragment).querySelectorAll?.('li') ?? [])) {
      const first = li.firstElementChild;
      // Only the leading paragraph: a nested list after it keeps its own shape.
      if (first?.nodeName === 'P') first.replaceWith(...Array.from(first.childNodes));
    }
    return dom;
  }) as typeof serializer.serializeFragment;
  return serializer;
}

export const Clipboard = Extension.create({
  name: 'clipboard',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('clipboard'),
        props: {
          clipboardTextSerializer: (slice: Slice) => asMarkdown(slice.content),
          clipboardSerializer: htmlSerializer(this.editor.schema),
        },
      }),
    ];
  },
});
