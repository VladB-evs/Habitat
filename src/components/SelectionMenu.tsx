import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Icon } from './Icons';

interface Item {
  id: string;
  label: string;
  icon?: string;
  text?: string;
  swatch?: string;
  active?: boolean;
  run: () => void;
}

const TEXT_COLORS = [
  { id: 'default', label: 'Default', color: '' },
  { id: 'blue', label: 'Blue', color: '#2a78d6' },
  { id: 'green', label: 'Green', color: '#1baf7a' },
  { id: 'yellow', label: 'Yellow', color: '#eda100' },
  { id: 'orange', label: 'Orange', color: '#eb6834' },
  { id: 'red', label: 'Red', color: '#e34948' },
  { id: 'violet', label: 'Violet', color: '#8b7bea' },
];

const HIGHLIGHTS = [
  { id: 'none', label: 'No highlight', color: '' },
  { id: 'h-yellow', label: 'Yellow highlight', color: '#f7e0a3' },
  { id: 'h-green', label: 'Green highlight', color: '#bfe8d4' },
  { id: 'h-blue', label: 'Blue highlight', color: '#c3dcf7' },
  { id: 'h-pink', label: 'Pink highlight', color: '#f5cede' },
];

/**
 * Toolbar that floats above the current text selection. Clickable by default;
 * ⌘/ hands it keyboard focus so the arrows move through it instead of the text.
 */
export function SelectionMenu({ editor }: { editor: Editor | null }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [colorOpen, setColorOpen] = useState(false);
  const [navMode, setNavMode] = useState(false);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  // Keyboard mode moves focus onto a toolbar button, which blurs the editor —
  // the visibility check has to know that so it doesn't hide the menu.
  const navRef = useRef(false);
  navRef.current = navMode;

  const place = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const a = editor.view.coordsAtPos(from);
    const b = editor.view.coordsAtPos(to);
    const width = ref.current?.offsetWidth ?? 320;
    const height = ref.current?.offsetHeight ?? 44;
    const centre = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2;
    const above = Math.min(a.top, b.top) - height - 8;
    setPos({
      left: Math.max(8, Math.min(centre - width / 2, window.innerWidth - width - 8)),
      // Flip below the selection when it's too close to the top of the window.
      top: above < 8 ? Math.max(a.bottom, b.bottom) + 8 : above,
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { empty } = editor.state.selection;
      const show = !empty && (editor.isFocused || navRef.current);
      setVisible((was) => {
        if (!show && was) {
          setColorOpen(false);
          setNavMode(false);
        }
        return show;
      });
      if (show) place();
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    editor.on('focus', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      editor.off('focus', update);
    };
  }, [editor, place]);

  // Re-measure once the toolbar has rendered at its real size.
  useEffect(() => {
    if (visible) place();
  }, [visible, colorOpen, place]);

  useEffect(() => {
    if (navMode) btns.current[index]?.focus();
  }, [navMode, index]);

  const items: Item[] = [];
  if (editor) {
    const chain = () => editor.chain().focus();
    const mark = (id: string, label: string, icon: string, name: string, run: () => void) =>
      items.push({ id, label, icon, active: editor.isActive(name), run });

    mark('bold', 'Bold', 'bold', 'bold', () => chain().toggleBold().run());
    mark('italic', 'Italic', 'italic', 'italic', () => chain().toggleItalic().run());
    mark('underline', 'Underline', 'underline', 'underline', () => chain().toggleUnderline().run());
    mark('strike', 'Strikethrough', 'strike', 'strike', () => chain().toggleStrike().run());
    mark('code', 'Inline code', 'code', 'code', () => chain().toggleCode().run());

    items.push({
      id: 'color',
      label: 'Colour',
      icon: 'palette',
      active: colorOpen,
      run: () => setColorOpen((v) => !v),
    });

    items.push({ id: 'p', label: 'Text', text: 'T', active: editor.isActive('paragraph'), run: () => chain().setParagraph().run() });
    for (const level of [1, 2, 3] as const) {
      items.push({
        id: 'h' + level,
        label: `Heading ${level}`,
        icon: 'h' + level,
        active: editor.isActive('heading', { level }),
        run: () => chain().toggleHeading({ level }).run(),
      });
    }
    items.push({ id: 'bullet', label: 'Bullet list', icon: 'list', active: editor.isActive('bulletList'), run: () => chain().toggleBulletList().run() });
    items.push({ id: 'ordered', label: 'Numbered list', icon: 'list-ordered', active: editor.isActive('orderedList'), run: () => chain().toggleOrderedList().run() });
    items.push({ id: 'todo', label: 'To-do list', icon: 'list-todo', active: editor.isActive('taskList'), run: () => chain().toggleTaskList().run() });
    items.push({ id: 'quote', label: 'Quote', icon: 'quote', active: editor.isActive('blockquote'), run: () => chain().toggleBlockquote().run() });
    items.push({ id: 'codeblock', label: 'Code block', icon: 'code-block', active: editor.isActive('codeBlock'), run: () => chain().toggleCodeBlock().run() });
    items.push({ id: 'clear', label: 'Clear formatting', icon: 'eraser', run: () => chain().unsetAllMarks().clearNodes().run() });

    if (colorOpen) {
      for (const c of TEXT_COLORS) {
        items.push({
          id: 'c-' + c.id,
          label: c.label,
          swatch: c.color || 'text',
          active: c.color ? editor.isActive('textStyle', { color: c.color }) : false,
          run: () => (c.color ? chain().setColor(c.color).run() : chain().unsetColor().run()),
        });
      }
      for (const h of HIGHLIGHTS) {
        items.push({
          id: h.id,
          label: h.label,
          swatch: h.color || 'none',
          active: h.color ? editor.isActive('highlight', { color: h.color }) : false,
          run: () => (h.color ? chain().toggleHighlight({ color: h.color }).run() : chain().unsetHighlight().run()),
        });
      }
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!visible) return;
      // ⌘/ moves control into the toolbar (and back out).
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setNavMode((v) => {
          if (v) editor?.commands.focus();
          else setIndex(0);
          return !v;
        });
        return;
      }
      if (!navMode) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setNavMode(false);
        setColorOpen(false);
        editor?.commands.focus();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        items[index]?.run();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible, navMode, items, index, editor]);

  if (!editor || !visible) return null;

  return (
    <div ref={ref} className={'sel-menu' + (navMode ? ' nav' : '')} style={pos} onMouseDown={(e) => e.preventDefault()}>
      <div className="sel-row">
        {items.slice(0, colorOpen ? items.length - TEXT_COLORS.length - HIGHLIGHTS.length : items.length).map((it, i) => (
          <button
            key={it.id}
            ref={(el) => {
              btns.current[i] = el;
            }}
            className={'sel-btn' + (it.active ? ' on' : '') + (navMode && i === index ? ' cursor' : '')}
            title={it.label}
            aria-label={it.label}
            onClick={it.run}
          >
            {it.icon ? <Icon name={it.icon} size={14} /> : <span className="sel-text">{it.text}</span>}
          </button>
        ))}
      </div>

      {colorOpen && (
        <div className="sel-colors">
          {items.slice(items.length - TEXT_COLORS.length - HIGHLIGHTS.length).map((it, j) => {
            const i = items.length - TEXT_COLORS.length - HIGHLIGHTS.length + j;
            const isText = j < TEXT_COLORS.length;
            return (
              <button
                key={it.id}
                ref={(el) => {
                  btns.current[i] = el;
                }}
                className={
                  'sel-swatch' + (isText ? ' text' : '') + (it.active ? ' on' : '') + (navMode && i === index ? ' cursor' : '')
                }
                title={it.label}
                aria-label={it.label}
                onClick={it.run}
                style={it.swatch && it.swatch !== 'text' && it.swatch !== 'none' ? { background: it.swatch } : undefined}
              >
                {isText ? <span style={{ color: it.swatch === 'text' ? 'var(--text)' : it.swatch }}>A</span> : null}
                {it.swatch === 'none' && <Icon name="x" size={11} />}
              </button>
            );
          })}
        </div>
      )}

      <span className="sel-hint">{navMode ? '↔ move · ↵ apply · esc exit' : '⌘/ to use arrows'}</span>
    </div>
  );
}
