import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Icon } from './Icons';

/**
 * Nobody has `∑` on their keyboard. While the caret is inside an equation this
 * palette sits under it: click a symbol and its LaTeX goes in at the caret,
 * with `{}` left where the next thing you type belongs. Searchable, because
 * knowing a symbol by sight is easier than knowing its name.
 */

interface Sym {
  /** What the button shows — the symbol itself wherever there is one. */
  show: string;
  /** What gets typed. `{}` marks where the caret lands. */
  tex: string;
  /** Extra words to search on, beyond the LaTeX name. */
  alias?: string;
}

const GROUPS: { group: string; items: Sym[] }[] = [
  {
    group: 'Structure',
    items: [
      { show: 'a⁄b', tex: '\\frac{}{}', alias: 'fraction divide over' },
      { show: 'x²', tex: '^{}', alias: 'power superscript exponent squared' },
      { show: 'xₙ', tex: '_{}', alias: 'subscript index' },
      { show: '√', tex: '\\sqrt{}', alias: 'square root' },
      { show: 'ⁿ√', tex: '\\sqrt[]{}', alias: 'nth root' },
      { show: '( )', tex: '\\left( \\right)', alias: 'brackets parentheses' },
      { show: '[ ]', tex: '\\left[ \\right]', alias: 'square brackets' },
      { show: '{ }', tex: '\\left\\{ \\right\\}', alias: 'braces curly' },
      { show: '|x|', tex: '\\left| \\right|', alias: 'absolute modulus' },
      { show: 'x̄', tex: '\\bar{}', alias: 'bar mean average' },
      { show: 'x̂', tex: '\\hat{}', alias: 'hat estimate' },
      { show: 'x⃗', tex: '\\vec{}', alias: 'vector arrow' },
      { show: 'ẋ', tex: '\\dot{}', alias: 'dot derivative' },
      { show: 'A', tex: '\\text{}', alias: 'text words prose' },
    ],
  },
  {
    group: 'Operators',
    items: [
      { show: '×', tex: '\\times', alias: 'multiply product' },
      { show: '÷', tex: '\\div', alias: 'divide' },
      { show: '·', tex: '\\cdot', alias: 'dot multiply' },
      { show: '±', tex: '\\pm', alias: 'plus minus' },
      { show: '∓', tex: '\\mp', alias: 'minus plus' },
      { show: '∑', tex: '\\sum_{}^{}', alias: 'sum sigma total' },
      { show: '∏', tex: '\\prod_{}^{}', alias: 'product' },
      { show: '∫', tex: '\\int_{}^{}', alias: 'integral' },
      { show: '∬', tex: '\\iint', alias: 'double integral' },
      { show: '∮', tex: '\\oint', alias: 'contour integral' },
      { show: '∂', tex: '\\partial', alias: 'partial derivative' },
      { show: '∇', tex: '\\nabla', alias: 'nabla gradient del' },
      { show: '∞', tex: '\\infty', alias: 'infinity' },
      { show: 'lim', tex: '\\lim_{}', alias: 'limit' },
      { show: '√‾', tex: '\\sqrt[3]{}', alias: 'cube root' },
      { show: '!', tex: '!', alias: 'factorial' },
    ],
  },
  {
    group: 'Relations',
    items: [
      { show: '=', tex: '=', alias: 'equals' },
      { show: '≠', tex: '\\neq', alias: 'not equal' },
      { show: '≈', tex: '\\approx', alias: 'approximately' },
      { show: '≡', tex: '\\equiv', alias: 'identical congruent' },
      { show: '≤', tex: '\\leq', alias: 'less than or equal' },
      { show: '≥', tex: '\\geq', alias: 'greater than or equal' },
      { show: '≪', tex: '\\ll', alias: 'much less' },
      { show: '≫', tex: '\\gg', alias: 'much greater' },
      { show: '∝', tex: '\\propto', alias: 'proportional' },
      { show: '→', tex: '\\to', alias: 'arrow to maps' },
      { show: '⇒', tex: '\\Rightarrow', alias: 'implies' },
      { show: '⇔', tex: '\\Leftrightarrow', alias: 'if and only if iff' },
    ],
  },
  {
    group: 'Greek',
    items: [
      { show: 'α', tex: '\\alpha' },
      { show: 'β', tex: '\\beta' },
      { show: 'γ', tex: '\\gamma' },
      { show: 'δ', tex: '\\delta' },
      { show: 'ε', tex: '\\varepsilon', alias: 'epsilon' },
      { show: 'ζ', tex: '\\zeta' },
      { show: 'η', tex: '\\eta' },
      { show: 'θ', tex: '\\theta' },
      { show: 'κ', tex: '\\kappa' },
      { show: 'λ', tex: '\\lambda' },
      { show: 'μ', tex: '\\mu', alias: 'micro mean' },
      { show: 'ν', tex: '\\nu' },
      { show: 'ξ', tex: '\\xi' },
      { show: 'π', tex: '\\pi' },
      { show: 'ρ', tex: '\\rho' },
      { show: 'σ', tex: '\\sigma', alias: 'standard deviation' },
      { show: 'τ', tex: '\\tau' },
      { show: 'φ', tex: '\\phi' },
      { show: 'χ', tex: '\\chi' },
      { show: 'ψ', tex: '\\psi' },
      { show: 'ω', tex: '\\omega' },
      { show: 'Γ', tex: '\\Gamma' },
      { show: 'Δ', tex: '\\Delta', alias: 'change difference' },
      { show: 'Θ', tex: '\\Theta' },
      { show: 'Λ', tex: '\\Lambda' },
      { show: 'Π', tex: '\\Pi' },
      { show: 'Σ', tex: '\\Sigma' },
      { show: 'Φ', tex: '\\Phi' },
      { show: 'Ψ', tex: '\\Psi' },
      { show: 'Ω', tex: '\\Omega', alias: 'ohm' },
    ],
  },
  {
    group: 'Sets & logic',
    items: [
      { show: '∈', tex: '\\in', alias: 'element of member' },
      { show: '∉', tex: '\\notin', alias: 'not element' },
      { show: '⊂', tex: '\\subset', alias: 'subset' },
      { show: '⊆', tex: '\\subseteq', alias: 'subset equal' },
      { show: '∪', tex: '\\cup', alias: 'union' },
      { show: '∩', tex: '\\cap', alias: 'intersection' },
      { show: '∅', tex: '\\emptyset', alias: 'empty set' },
      { show: '∀', tex: '\\forall', alias: 'for all every' },
      { show: '∃', tex: '\\exists', alias: 'there exists' },
      { show: '¬', tex: '\\neg', alias: 'not negation' },
      { show: '∧', tex: '\\land', alias: 'and conjunction' },
      { show: '∨', tex: '\\lor', alias: 'or disjunction' },
      { show: 'ℝ', tex: '\\mathbb{R}', alias: 'real numbers' },
      { show: 'ℕ', tex: '\\mathbb{N}', alias: 'natural numbers' },
      { show: 'ℤ', tex: '\\mathbb{Z}', alias: 'integers' },
    ],
  },
  {
    group: 'Functions',
    items: [
      { show: 'sin', tex: '\\sin' },
      { show: 'cos', tex: '\\cos' },
      { show: 'tan', tex: '\\tan' },
      { show: 'log', tex: '\\log' },
      { show: 'ln', tex: '\\ln', alias: 'natural log' },
      { show: 'exp', tex: '\\exp', alias: 'exponential' },
      { show: 'min', tex: '\\min' },
      { show: 'max', tex: '\\max' },
      { show: '°', tex: '^\\circ', alias: 'degrees' },
      { show: '%', tex: '\\%', alias: 'percent' },
    ],
  },
];

/**
 * The `$…$` the caret is sitting in, if any. Dollars are paired off in order,
 * which also recognises the empty `$$` that `/math` leaves you in.
 */
function mathSpan(editor: Editor): { from: number; to: number } | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock || $from.parent.type.name === 'codeBlock') return null;
  const start = $from.start();
  const text = $from.parent.textBetween(0, $from.parent.content.size, undefined, ' ');
  const caret = $from.pos - start;
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '$') at.push(i);
  for (let i = 0; i + 1 < at.length; i += 2) {
    if (caret <= at[i] || caret > at[i + 1]) continue;
    const inner = text.slice(at[i] + 1, at[i + 1]);
    // The same test the renderer applies, so "I paid $5 and $10" doesn't count
    // as an equation just because the caret wandered between two prices. An
    // empty `$$` does count — that's what /math leaves you sitting in.
    if (inner && (/^\s/.test(inner) || /\s$/.test(inner))) continue;
    return { from: start + at[i], to: start + at[i + 1] + 1 };
  }
  return null;
}

/** The dozen that come up constantly — the strip you get without asking. */
const QUICK: Sym[] = [
  { show: 'a⁄b', tex: '\\frac{}{}' },
  { show: 'x²', tex: '^{}' },
  { show: 'xₙ', tex: '_{}' },
  { show: '√', tex: '\\sqrt{}' },
  { show: '×', tex: '\\times' },
  { show: '÷', tex: '\\div' },
  { show: '±', tex: '\\pm' },
  { show: '≠', tex: '\\neq' },
  { show: '≤', tex: '\\leq' },
  { show: '≥', tex: '\\geq' },
  { show: '≈', tex: '\\approx' },
  { show: 'π', tex: '\\pi' },
  { show: 'θ', tex: '\\theta' },
  { show: '∑', tex: '\\sum_{}^{}' },
  { show: '∫', tex: '\\int_{}^{}' },
  { show: '∞', tex: '\\infty' },
];

export function MathBar({ editor }: { editor: Editor | null }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const place = useCallback(() => {
    const span = editor && mathSpan(editor);
    if (!span) return setPos(null);
    const box = editor!.view.coordsAtPos(span.from);
    const height = ref.current?.offsetHeight ?? 34;
    setPos((was) => {
      const left = Math.max(12, Math.min(box.left - 10, window.innerWidth - 480));
      // Above the line it belongs to, so it covers what you've already written
      // rather than what you're about to. Below only when there's no room.
      const above = box.top - height - 8;
      const top = above < 8 ? box.bottom + 8 : above;
      return was?.left === left && was?.top === top ? was : { left, top };
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    place();
    editor.on('selectionUpdate', place);
    editor.on('transaction', place);
    return () => {
      editor.off('selectionUpdate', place);
      editor.off('transaction', place);
    };
  }, [editor, place]);

  // Leaving the equation puts the panel away again.
  useEffect(() => {
    if (!pos) {
      setQ('');
      setOpen(false);
    }
  }, [pos]);

  // Re-measure and focus the search box once the panel is really open.
  useEffect(() => {
    place();
    if (open) search.current?.focus();
  }, [open, place]);

  if (!editor || !pos) return null;

  const insert = (tex: string) => {
    const at = editor.state.selection.from;
    const hole = tex.indexOf('{}');
    editor
      .chain()
      .insertContentAt(at, tex)
      // Land inside the first pair of braces when there is one, so the next
      // keystroke goes where it should.
      .setTextSelection(hole >= 0 ? at + hole + 1 : at + tex.length)
      .focus()
      .run();
  };

  const needle = q.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: needle
      ? g.items.filter((s) => `${s.tex.replace(/[\\{}[\]^_]/g, ' ')} ${s.alias ?? ''} ${s.show}`.toLowerCase().includes(needle))
      : g.items,
  })).filter((g) => g.items.length);

  return (
    <div ref={ref} className="math-bar" style={pos} onMouseDown={(e) => e.preventDefault()}>
      {/* One line by default: the common symbols, and a way to find the rest. */}
      <div className="math-strip">
        {QUICK.map((s) => (
          <button key={s.tex + s.show} className="math-key" title={s.tex} onClick={() => insert(s.tex)}>
            {s.show}
          </button>
        ))}
        <span className="math-sep" />
        <button
          className={'math-more' + (open ? ' on' : '')}
          onClick={() => setOpen((v) => !v)}
          title={open ? 'Hide the rest' : 'All symbols'}
          aria-label={open ? 'Hide the rest' : 'All symbols'}
        >
          <Icon name={open ? 'chevron-down' : 'search'} size={12} />
        </button>
      </div>

      {open && (
        <div className="math-panel">
          <input
            ref={search}
            className="math-search"
            placeholder="Search symbols — sum, alpha, integral…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
                editor.commands.focus();
              }
            }}
          />
          <div className="math-groups">
            {groups.map((g) => (
              <div key={g.group} className="math-group">
                <div className="picker-group">{g.group}</div>
                <div className="math-keys">
                  {g.items.map((s) => (
                    <button key={s.tex + s.show} className="math-key" title={s.tex} onClick={() => insert(s.tex)}>
                      {s.show}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length && <div className="empty" style={{ padding: 14, fontSize: 13 }}>Nothing matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
