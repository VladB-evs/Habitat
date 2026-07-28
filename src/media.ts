import { Node, mergeAttributes } from '@tiptap/core';
import type { FileRef } from './types';
import { api } from './api';

/** Where the renderer reads a stored file from — streamed by the main process. */
export const fileUrl = (ref: { hash: string; ext?: string }) => `habitat://file/${ref.hash}${ref.ext || ''}`;

export const isImage = (mime?: string) => /^image\//.test(String(mime || ''));

export function prettySize(bytes: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** An image's real size, so the block can hold its shape before the bytes arrive. */
function measure(file: File): Promise<{ width: number | null; height: number | null }> {
  if (!isImage(file.type)) return Promise.resolve({ width: null, height: null });
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null });
    };
    img.src = url;
  });
}

/** Store dropped or pasted files, in order, skipping any that fail. */
export async function storeFiles(list: ArrayLike<File>): Promise<FileRef[]> {
  const out: FileRef[] = [];
  for (const file of Array.from(list)) {
    try {
      const { width, height } = await measure(file);
      const data = new Uint8Array(await file.arrayBuffer());
      out.push(await api.files.add({ name: file.name || 'pasted', mime: file.type, data, width, height }));
    } catch (err) {
      console.error('could not store', file.name, err);
    }
  }
  return out;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    media: {
      insertMedia: (refs: FileRef | FileRef[]) => ReturnType;
    };
  }
}

/**
 * An attachment as a block of its own: an atom, so it behaves as one thing
 * rather than a run of text, and draggable, so it can be picked up by its handle
 * and dropped anywhere else in the note. Everything needed to draw it lives in
 * the attributes, which keeps rendering free of lookups and makes the document
 * readable on its own.
 */
export const Media = Node.create({
  name: 'media',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      hash: { default: null },
      name: { default: '' },
      mime: { default: '' },
      ext: { default: '' },
      size: { default: 0 },
      width: { default: null },
      height: { default: null },
      caption: { default: '' },
      /** Percentage of the column an image takes, so a screenshot needn't dominate. */
      scale: { default: 100 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-media]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const { hash, ext, name } = HTMLAttributes as Record<string, string>;
    return ['div', mergeAttributes({ 'data-media': hash, 'data-name': name }), ['img', { src: fileUrl({ hash, ext }), alt: name }]];
  },

  addCommands() {
    return {
      insertMedia:
        (refs) =>
        ({ commands }) => {
          const list = Array.isArray(refs) ? refs : [refs];
          return commands.insertContent(
            list.map((ref) => ({ type: 'media', attrs: { ...ref, caption: '', scale: 100 } }))
          );
        },
    };
  },
});
