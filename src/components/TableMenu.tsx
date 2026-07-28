import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Icon } from './Icons';

interface Item {
  id: string;
  label: string;
  /** Row and column buttons read better as text — four similar grid icons don't. */
  text?: string;
  icon?: string;
  run: () => void;
  danger?: boolean;
}

/**
 * The controls a table needs, floating over its top-left corner while the caret
 * is inside one. Columns and rows are added after whichever cell you're in, so
 * where it lands is where you were looking.
 */
export function TableMenu({ editor }: { editor: Editor | null }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const put = (next: { left: number; top: number } | null) =>
      // Called on every transaction, so a keystroke inside a cell must not
      // re-render the bar just to put it back where it already was.
      setPos((was) => (was?.left === next?.left && was?.top === next?.top ? was : next));

    if (!editor?.isActive('table')) return put(null);
    // The wrapper the caret sits in, so the bar follows the right table.
    const cell = editor.view.domAtPos(editor.state.selection.from).node as HTMLElement;
    const table = (cell.nodeType === 1 ? cell : cell.parentElement)?.closest('table');
    if (!table) return put(null);
    const box = table.getBoundingClientRect();
    const height = ref.current?.offsetHeight ?? 36;
    put({ left: Math.max(8, box.left), top: Math.max(8, box.top - height - 8) });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    place();
    editor.on('selectionUpdate', place);
    editor.on('transaction', place);
    // The bar hangs off the table, so it has to move when the page does.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      editor.off('selectionUpdate', place);
      editor.off('transaction', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [editor, place]);

  if (!editor || !pos) return null;

  const chain = () => editor.chain().focus();
  const items: Item[] = [
    { id: 'col-after', label: 'Add column', text: '+Col', run: () => chain().addColumnAfter().run() },
    { id: 'col-del', label: 'Delete column', text: '−Col', run: () => chain().deleteColumn().run() },
    { id: 'row-after', label: 'Add row', text: '+Row', run: () => chain().addRowAfter().run() },
    { id: 'row-del', label: 'Delete row', text: '−Row', run: () => chain().deleteRow().run() },
    { id: 'header', label: 'Toggle header row', icon: 'table', run: () => chain().toggleHeaderRow().run() },
    { id: 'merge', label: 'Merge or split cells', icon: 'grid', run: () => chain().mergeOrSplit().run() },
    { id: 'delete', label: 'Delete table', icon: 'trash', danger: true, run: () => chain().deleteTable().run() },
  ];

  return (
    <div ref={ref} className="table-menu" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.preventDefault()}>
      {items.map((it) => (
        <button
          key={it.id}
          className={'sel-btn' + (it.danger ? ' danger' : '')}
          title={it.label}
          aria-label={it.label}
          onClick={it.run}
        >
          {it.icon ? <Icon name={it.icon} size={14} /> : <span className="sel-text small">{it.text}</span>}
        </button>
      ))}
    </div>
  );
}
