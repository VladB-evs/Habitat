import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { api } from '../api';
import { isSafeUrl, withScheme } from '../links';
import type { AiAction } from '../types';
import { Icon } from './Icons';
import { MakeCard } from './study/MakeCard';

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

/**
 * Highlights are translucent rather than pastel: the text keeps whatever colour
 * it already has, so a marked phrase stays readable in both themes instead of
 * being forced to near-black on a pale block.
 */
const HIGHLIGHTS = [
  { id: 'none', label: 'No highlight', color: '' },
  { id: 'h-yellow', label: 'Yellow highlight', color: 'rgba(237, 161, 0, 0.34)' },
  { id: 'h-green', label: 'Green highlight', color: 'rgba(46, 178, 122, 0.32)' },
  { id: 'h-blue', label: 'Blue highlight', color: 'rgba(64, 140, 214, 0.32)' },
  { id: 'h-violet', label: 'Violet highlight', color: 'rgba(139, 123, 234, 0.34)' },
  { id: 'h-pink', label: 'Pink highlight', color: 'rgba(226, 96, 150, 0.30)' },
  { id: 'h-orange', label: 'Orange highlight', color: 'rgba(235, 104, 52, 0.30)' },
];

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The model answers in plain text, so its paragraphs and its "- " lines have to
 * become real nodes before they go into the document — otherwise a list arrives
 * as one paragraph full of hyphens.
 */
function toHtml(text: string): string {
  const out: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    out.push('<ul>' + bullets.map((b) => `<li><p>${escapeHtml(b)}</p></li>`).join('') + '</ul>');
    bullets = [];
  };
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    if (bullet) bullets.push(bullet[1]);
    else {
      flush();
      if (trimmed) out.push(`<p>${escapeHtml(trimmed)}</p>`);
    }
  }
  flush();
  return out.join('') || '<p></p>';
}

/**
 * Toolbar that floats above the current text selection: select something and
 * every button is there to be clicked. Hovering one names it, since a row of
 * small icons is only obvious to whoever drew it.
 */
export function SelectionMenu({ editor, objectId }: { editor: Editor | null; objectId?: string }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  /**
   * True when the toolbar sits under the selection instead of over it. The tip
   * goes on the far side from the text either way, so naming a tool never hides
   * what it would act on.
   */
  const [flipped, setFlipped] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  /** The selected text, taken when the flashcard panel opens rather than when it saves. */
  const [cardText, setCardText] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  /** Read inside the visibility check, which runs from editor events and not on render. */
  const linkOpenRef = useRef(false);
  linkOpenRef.current = linkOpen;
  /** Same reason: typing an answer blurs the editor, and the bar must stay put. */
  const cardOpenRef = useRef(false);
  cardOpenRef.current = cardOpen;
  const [linkDraft, setLinkDraft] = useState('');
  const [tip, setTip] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  /**
   * True while the keyboard is inside the toolbar. Focusing a button blurs the
   * editor, and the visibility check reads `editor.isFocused` — so without this
   * the bar would vanish the instant it was reached.
   *
   * The ref is written before the state and not derived from it during render.
   * Blurring the editor dispatches a transaction, the visibility check runs from
   * that transaction, and it would otherwise read a ref still one render behind
   * — hiding the toolbar in the same tick the keyboard arrived in it.
   */
  const [navigating, setNavigating] = useState(false);
  const navigatingRef = useRef(false);
  const setNav = useCallback((on: boolean) => {
    navigatingRef.current = on;
    setNavigating(on);
  }, []);

  /** Empty until the on-device model answers for itself; no model, no button. */
  const [aiActions, setAiActions] = useState<AiAction[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRun, setAiRun] = useState<{ id: string; action: AiAction } | null>(null);
  const [aiText, setAiText] = useState('');
  const [aiError, setAiError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const aiOpenRef = useRef(false);
  aiOpenRef.current = aiOpen || !!aiRun;
  /**
   * Where the reply goes. Kept in a ref and mapped through every transaction:
   * the user is free to keep typing while the model writes, and a position
   * captured before that typing would otherwise land in the wrong place.
   */
  const rangeRef = useRef<{ from: number; to: number } | null>(null);
  const sourceRef = useRef('');
  /** Deltas arrive for whichever run is current; a cancelled one's are ignored. */
  const runIdRef = useRef('');

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
    // Flip below the selection when it's too close to the top of the window.
    const under = above < 8;
    setFlipped(under);
    setPos({
      left: Math.max(8, Math.min(centre - width / 2, window.innerWidth - width - 8)),
      top: under ? Math.max(a.bottom, b.bottom) + 8 : above,
    });
  }, [editor]);

  /* ---------- driving the toolbar from the keyboard ---------- */

  /**
   * Asked of the DOM rather than tracked in an array, so the colour swatches,
   * the model's actions and its Replace/Discard buttons are all in the ring the
   * moment their panel opens — no second list to keep in step.
   */
  const focusables = useCallback(
    () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-sel-item]') ?? []),
    []
  );

  /**
   * Which item is lit, from the moment the toolbar appears.
   *
   * This is a highlight, not real browser focus, and that distinction is the
   * whole design: the editor keeps focus underneath, so typing still replaces
   * the selection, Shift-Arrow still adjusts it and ⌘B still works. Only the
   * few keys the toolbar needs are taken from the editor.
   */
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(0);
  cursorRef.current = cursor;
  /** The selection Escape was pressed on, so the bar stays away until it changes. */
  const dismissedAt = useRef('');
  /** Which button opened the panel that's showing, so closing it lands back there. */
  const openedFrom = useRef(-1);

  const moveCursor = useCallback(
    (delta: number) => {
      const n = focusables().length;
      // Wraps, because a toolbar is a ring: past the last button is the first.
      if (n) setCursor((c) => (c + delta + n) % n);
    },
    [focusables]
  );

  /**
   * Enter runs whatever is lit. When that opens a panel — the colours, the
   * model's list of actions — the highlight moves to the first item that
   * appeared, which is where the eye already went.
   */
  const activate = useCallback(() => {
    const before = focusables();
    const el = before[cursorRef.current];
    if (!el) return;
    const from = cursorRef.current;
    el.click();
    requestAnimationFrame(() => {
      const after = focusables();
      const opened = after.findIndex((node) => !before.includes(node));
      if (opened !== -1) openedFrom.current = from;
      setCursor(opened !== -1 ? opened : Math.min(from, Math.max(after.length - 1, 0)));
    });
  }, [focusables]);

  /** A fresh selection is a fresh toolbar: back to the first item. */
  useEffect(() => {
    if (visible) setCursor(0);
  }, [visible]);

  /**
   * The highlight is written onto the DOM after each render rather than threaded
   * through every button. The row, the swatches and the model's two panels are
   * four separate lists; this way opening one puts its items in the ring without
   * any of them needing to know the highlight exists.
   */
  const litIndex = useRef(-1);
  useEffect(() => {
    const els = focusables();
    // Real focus wins when the user has tabbed in — two rings would be a lie.
    const at = visible && !navigating ? Math.min(cursor, els.length - 1) : -1;
    els.forEach((el, i) => el.classList.toggle('nav', i === at));
    if (litIndex.current === at) return;
    litIndex.current = at;
    if (at === -1) return;
    const el = els[at];
    setTip(el?.getAttribute('aria-label') || el?.textContent?.trim() || '');
    el?.scrollIntoView?.({ block: 'nearest' });
  });

  /* ---------- and with real focus, for anyone tabbing through ---------- */

  const step = useCallback(
    (delta: number) => {
      const els = focusables();
      if (!els.length) return;
      const at = els.indexOf(document.activeElement as HTMLElement);
      const next = at === -1 ? (delta > 0 ? 0 : els.length - 1) : (at + delta + els.length) % els.length;
      els[next]?.focus();
    },
    [focusables]
  );

  const leaveToolbar = useCallback(() => {
    setNav(false);
    setTip('');
    // Puts the caret back exactly where it was — the selection was never lost,
    // only unfocused.
    editor?.commands.focus();
  }, [editor, setNav]);

  /**
   * Tab takes real focus rather than the highlight. The highlight is enough for
   * a sighted user, but a screen reader follows focus and nothing else, so the
   * toolbar has to be reachable that way too.
   */
  useEffect(() => {
    if (!editor || !visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!editor.view.dom.contains(document.activeElement)) return;
      const els = focusables();
      if (!els.length) return;
      e.preventDefault();
      setNav(true);
      (e.shiftKey ? els[els.length - 1] : els[0]).focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor, visible, focusables, setNav]);

  /**
   * Applying a mark focuses the editor, which would throw real focus out of the
   * toolbar after a single button. Wrapping the handler puts it back so bold,
   * then italic, then a heading is three keystrokes and no re-entry.
   */
  const stay = (run: () => void) => (e: React.MouseEvent<HTMLElement>) => {
    const button = e.currentTarget;
    // Mouse clicks never focus these buttons — the toolbar swallows mousedown to
    // keep the editor focused — so this is true only when Tab brought us here.
    const viaKeyboard = navigatingRef.current;
    run();
    if (!viaKeyboard) return;
    // TipTap restores editor focus a tick later, so taking it back has to happen
    // after that rather than before, or the editor simply wins.
    requestAnimationFrame(() => {
      if (!button.isConnected) return;
      setNav(true);
      button.focus();
    });
  };

  const onToolbarKey = (e: React.KeyboardEvent) => {
    // The link field is a text input; inside it every one of these keys means
    // what it normally means, and Escape is already the field's own business.
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        step(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        step(-1);
        break;
      case 'Home':
        e.preventDefault();
        focusables()[0]?.focus();
        break;
      case 'End': {
        e.preventDefault();
        const els = focusables();
        els[els.length - 1]?.focus();
        break;
      }
      // Both ways out. Tab never walks within the toolbar — one press leaves it,
      // which is what a toolbar is meant to do.
      case 'Tab':
      case 'Escape':
        e.preventDefault();
        leaveToolbar();
        break;
    }
  };

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to, empty } = editor.state.selection;
      // Escape dismisses the toolbar for this selection only — move or remake the
      // selection and it comes back, which is what a second thought looks like.
      const key = `${from}:${to}`;
      if (dismissedAt.current && dismissedAt.current !== key) dismissedAt.current = '';
      // Typing a link means the editor is blurred and the selection may be empty,
      // yet the toolbar is exactly what's being used — so the form outranks both.
      const show =
        dismissedAt.current !== key &&
        (linkOpenRef.current ||
          aiOpenRef.current ||
          cardOpenRef.current ||
          navigatingRef.current ||
          (!empty && editor.isFocused));
      setVisible((was) => {
        if (!show && was) {
          setColorOpen(false);
          setLinkOpen(false);
          setCardOpen(false);
          setTip('');
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

  // Re-measure once the toolbar has rendered at its real size. The reply grows
  // the panel line by line, so this runs on every delta too.
  useEffect(() => {
    if (visible) place();
  }, [visible, colorOpen, aiOpen, aiRun, aiText, aiError, place]);

  // Ask the model whether it's there. A Mac without Apple Intelligence, or a
  // build without the helper, simply never grows the button.
  useEffect(() => {
    let alive = true;
    api.ai
      .availability()
      .then(async (state) => {
        if (!alive || !state.available) return;
        const actions = await api.ai.actions();
        if (!alive) return;
        setAiActions(actions);
        // Loading the model takes about a second; spend it now, not on the click.
        api.ai.prewarm();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => api.ai.onDelta((msg) => msg.id === runIdRef.current && setAiText(msg.text)), []);

  // Keep the target range pointing at the same words as the document changes.
  useEffect(() => {
    if (!editor) return;
    const onTx = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (p: number) => number } } }) => {
      const r = rangeRef.current;
      if (!r || !transaction.docChanged) return;
      rangeRef.current = { from: transaction.mapping.map(r.from), to: transaction.mapping.map(r.to) };
    };
    editor.on('transaction', onTx);
    return () => {
      editor.off('transaction', onTx);
    };
  }, [editor]);

  const closeAi = useCallback(() => {
    if (runIdRef.current) api.ai.cancel(runIdRef.current);
    runIdRef.current = '';
    rangeRef.current = null;
    sourceRef.current = '';
    setAiRun(null);
    setAiOpen(false);
    setAiText('');
    setAiError('');
    setAiBusy(false);
  }, []);

  // A run outlives this component only as a process — cancel it on the way out.
  useEffect(() => () => void (runIdRef.current && api.ai.cancel(runIdRef.current)), []);

  /**
   * The toolbar is live the moment it appears — no key needed to reach it.
   *
   * Captured at the window so it runs before ProseMirror's own handling. Only
   * the listed keys are taken; everything else reaches the editor untouched,
   * which is why selecting a word and typing over it still works.
   */
  useEffect(() => {
    if (!editor || !visible || navigating) return;
    const onKey = (e: KeyboardEvent) => {
      // Not while the link field has the keyboard — there, arrows move the caret
      // through what's being typed.
      if (!editor.view.dom.contains(document.activeElement)) return;
      // Shift-Arrow still extends the selection, and ⌘/⌥-Arrow still belong to
      // the editor. Only the bare keys are the toolbar's.
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          moveCursor(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          moveCursor(-1);
          break;
        case 'Enter':
          e.preventDefault();
          activate();
          break;
        case 'Escape':
          e.preventDefault();
          // One layer at a time: an open panel closes first and the highlight
          // returns to the button that opened it; only then does Escape put the
          // whole toolbar away.
          if (aiOpenRef.current || colorOpen) {
            if (aiOpenRef.current) closeAi();
            if (colorOpen) setColorOpen(false);
            setCursor(openedFrom.current >= 0 ? openedFrom.current : 0);
            openedFrom.current = -1;
          } else {
            const { from, to } = editor.state.selection;
            dismissedAt.current = `${from}:${to}`;
            setVisible(false);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor, visible, navigating, colorOpen, moveCursor, activate, closeAi]);

  const runAi = useCallback(
    (action: AiAction, text: string) => {
      const id = crypto.randomUUID();
      runIdRef.current = id;
      sourceRef.current = text;
      setAiRun({ id, action });
      setAiOpen(false);
      setAiText('');
      setAiError('');
      setAiBusy(true);
      api.ai.run({ id, action: action.id, text }).then((res) => {
        // A later run, or a cancel, has taken over — this answer is stale.
        if (runIdRef.current !== id) return;
        setAiBusy(false);
        if (res.ok) setAiText(res.text ?? '');
        else setAiError(res.error || "That didn't work.");
      });
    },
    []
  );

  const startAi = useCallback(
    (action: AiAction) => {
      if (!editor) return;
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, '\n\n', ' ').trim();
      if (!text) return;
      rangeRef.current = { from, to };
      runAi(action, text);
    },
    [editor, runAi]
  );

  /** `replace` swaps the selection for the reply; `after` leaves the original alone. */
  const applyAi = useCallback(
    (mode: 'replace' | 'after') => {
      const range = rangeRef.current;
      const text = aiText.trim();
      if (!editor || !range || !text) return;
      const html = toHtml(text);
      const chain = editor.chain().focus();
      if (mode === 'replace') chain.insertContentAt({ from: range.from, to: range.to }, html).run();
      else chain.insertContentAt(range.to, html).run();
      closeAi();
    },
    [editor, aiText, closeAi]
  );

  const items: Item[] = [];
  if (editor) {
    const chain = () => editor.chain().focus();
    const mark = (id: string, label: string, icon: string, name: string, run: () => void) =>
      items.push({ id, label, icon, active: editor.isActive(name), run });

    if (aiActions.length) {
      items.push({
        id: 'ai',
        label: 'Apple Intelligence',
        icon: 'sparkles',
        active: aiOpen || !!aiRun,
        run: () => {
          if (aiRun) return closeAi();
          setAiOpen((v) => !v);
        },
      });
    }

    mark('bold', 'Bold', 'bold', 'bold', () => chain().toggleBold().run());
    mark('italic', 'Italic', 'italic', 'italic', () => chain().toggleItalic().run());
    mark('underline', 'Underline', 'underline', 'underline', () => chain().toggleUnderline().run());
    mark('strike', 'Strikethrough', 'strike', 'strike', () => chain().toggleStrike().run());
    mark('code', 'Inline code', 'code', 'code', () => chain().toggleCode().run());

    items.push({
      id: 'link',
      label: editor.isActive('link') ? 'Edit link' : 'Link',
      icon: 'link',
      active: editor.isActive('link'),
      run: () => {
        setLinkDraft(editor.getAttributes('link').href ?? '');
        setLinkOpen(true);
      },
    });

    items.push({
      id: 'card',
      label: 'Make flashcard',
      icon: 'cards',
      active: cardOpen,
      run: () => {
        // Captured now: opening the panel moves focus out of the document, and
        // the selection is gone by the time anything is saved.
        const { from, to } = editor.state.selection;
        setCardText(editor.state.doc.textBetween(from, to, '\n', ' ').trim());
        setCardOpen((v) => !v);
      },
    });

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

  if (!editor || !visible) return null;

  const swatchStart = items.length - TEXT_COLORS.length - HIGHLIGHTS.length;
  const closeLink = () => {
    setLinkOpen(false);
    setLinkDraft('');
  };

  /** Empty clears the link; anything the app wouldn't open is refused rather than stored. */
  const applyLink = () => {
    if (!editor) return;
    const raw = linkDraft.trim();
    if (!raw) editor.chain().focus().unsetLink().run();
    else if (isSafeUrl(raw)) editor.chain().focus().setLink({ href: withScheme(raw) }).run();
    else return;
    closeLink();
  };

  // Naming what the pointer is over, in the toolbar's own voice rather than the
  // operating system's slow tooltip.
  const named = (label: string) => ({
    onMouseEnter: () => setTip(label),
    onMouseLeave: () => setTip((t) => (t === label ? '' : t)),
    onFocus: () => setTip(label),
    onBlur: () => setTip(''),
    'aria-label': label,
  });

  return (
    <div
      ref={ref}
      className="sel-menu"
      role="toolbar"
      aria-label="Formatting"
      style={pos}
      onMouseDown={(e) => e.preventDefault()}
      onMouseLeave={() => setTip('')}
      onKeyDown={onToolbarKey}
      onFocus={() => setNav(true)}
      // Only a blur that leaves the toolbar entirely counts — moving between its
      // own buttons fires one of these on every step.
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node)) setNav(false);
      }}
    >
      <div className="sel-row">
        {items.slice(0, colorOpen ? swatchStart : items.length).map((it) => (
          <button
            key={it.id}
            data-sel-item
            className={'sel-btn' + (it.active ? ' on' : '')}
            onClick={stay(it.run)}
            {...named(it.label)}
          >
            {it.icon ? <Icon name={it.icon} size={14} /> : <span className="sel-text">{it.text}</span>}
          </button>
        ))}
      </div>

      {aiOpen && !aiRun && (
        <div className="sel-ai-menu">
          {aiActions.map((a) => (
            <button key={a.id} data-sel-item className="sel-ai-item" onClick={() => startAi(a)}>
              <Icon name={a.icon} size={13} />
              <span>{a.label}</span>
            </button>
          ))}
          <span className="sel-ai-note">Runs on this Mac. Nothing is sent anywhere.</span>
        </div>
      )}

      {aiRun && (
        <div className="sel-ai-run">
          <div className="sel-ai-head">
            <Icon name="sparkles" size={12} />
            <span>{aiRun.action.label}</span>
            {aiBusy && <span className="sel-ai-dots" aria-label="Working" />}
          </div>

          {aiError ? (
            <p className="sel-ai-error">{aiError}</p>
          ) : (
            // `aria-live` so the reply is announced as it arrives rather than
            // only once the buttons appear.
            <div className="sel-ai-out" aria-live="polite">
              {aiText || <span className="sel-ai-wait">Thinking…</span>}
            </div>
          )}

          <div className="sel-ai-foot">
            {aiBusy ? (
              <button data-sel-item className="sel-ai-btn" onClick={closeAi}>
                Stop
              </button>
            ) : (
              <>
                {!aiError && aiText.trim() && (
                  <>
                    <button
                      data-sel-item
                      className={'sel-ai-btn' + (aiRun.action.appends ? '' : ' primary')}
                      onClick={() => applyAi('replace')}
                    >
                      Replace
                    </button>
                    <button
                      data-sel-item
                      className={'sel-ai-btn' + (aiRun.action.appends ? ' primary' : '')}
                      onClick={() => applyAi('after')}
                    >
                      Insert below
                    </button>
                  </>
                )}
                <button data-sel-item className="sel-ai-btn" onClick={() => runAi(aiRun.action, sourceRef.current)}>
                  Try again
                </button>
                <button data-sel-item className="sel-ai-btn" onClick={closeAi}>
                  Discard
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {colorOpen && (
        <div className="sel-colors">
          {items.slice(swatchStart).map((it, j) => {
            const isText = j < TEXT_COLORS.length;
            return (
              <button
                key={it.id}
                data-sel-item
                className={'sel-swatch' + (isText ? ' text' : '') + (it.active ? ' on' : '')}
                onClick={stay(it.run)}
                // Translucent highlights are composited over the page colour by
                // the stylesheet, so the swatch shows what the mark will look like.
                style={
                  it.swatch && it.swatch !== 'text' && it.swatch !== 'none'
                    ? ({ '--swatch': it.swatch } as React.CSSProperties)
                    : undefined
                }
                {...named(it.label)}
              >
                {isText ? <span style={{ color: it.swatch === 'text' ? 'var(--text)' : it.swatch }}>A</span> : null}
                {it.swatch === 'none' && <Icon name="x" size={11} />}
              </button>
            );
          })}
        </div>
      )}

      {linkOpen && editor && (
        <div className="sel-link">
          <input
            data-sel-item
            className="popover-search"
            placeholder="Paste or type a link…"
            value={linkDraft}
            autoFocus
            spellCheck={false}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') return closeLink();
              if (e.key !== 'Enter') return;
              e.preventDefault();
              applyLink();
            }}
          />
          <button data-sel-item className="sel-btn" onClick={applyLink} aria-label="Apply link" disabled={!!linkDraft.trim() && !isSafeUrl(linkDraft)}>
            <Icon name="check" size={14} />
          </button>
          {editor.isActive('link') && (
            <button
              data-sel-item
              className="sel-btn"
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                closeLink();
              }}
              aria-label="Remove link"
            >
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
      )}

      {cardOpen && <MakeCard text={cardText} objId={objectId} onClose={() => setCardOpen(false)} />}

      {tip && !linkOpen && !cardOpen && (
        <span className={'sel-tip' + (flipped ? ' below' : '')}>{tip}</span>
      )}
    </div>
  );
}
