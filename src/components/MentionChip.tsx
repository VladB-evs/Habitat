import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { api } from '../api';
import { getObject, objectChanged, onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { Obj, ObjType, PropDef } from '../types';
import { REPEAT_DONE_PROP, REPEAT_PROP, doneDays, parseRule } from '../repeat';
import { ago, openStatusOf, taskProp, todayKey, typeColor } from '../util';
import { motion } from 'motion/react';
import { popIn } from '../motion';
import { Icon, TypeIcon } from './Icons';

const OPEN_DELAY = 320;
const CLOSE_DELAY = 200;
const CARD_W = 300;

/** A few filled-in properties worth previewing, skipping the ones already in the header. */
function previewProps(obj: Obj, type: ObjType | undefined, skipId?: string) {
  const defs: PropDef[] = [...(type?.properties ?? []), ...(obj.extraProps ?? [])];
  const rows: { name: string; value: string }[] = [];
  for (const p of defs) {
    if (p.id === skipId || p.kind === 'relation') continue;
    const v = obj.props?.[p.id];
    if (v === undefined || v === null || v === '' || v === false) continue;
    rows.push({ name: p.name, value: p.kind === 'checkbox' ? 'Yes' : String(v) });
    if (rows.length === 4) break;
  }
  return rows;
}

export function MentionChip({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const id: string = node.attrs.id;
  const label: string = node.attrs.label || 'Untitled';
  // `/task` inserts the chip in draft mode: the title is typed right here.
  const [renaming, setRenaming] = useState<boolean>(!!node.attrs.draft);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { types, theme, openFrom, openBeside } = useApp();
  const [obj, setObj] = useState<Obj | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [card, setCard] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getObject(id).then((o) => {
        if (!alive) return;
        setObj(o);
        setLoaded(true);
      });
    load();
    const off = onObjectChanged((changed) => changed === id && load());
    return () => {
      alive = false;
      off();
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [id]);

  const type = obj ? types.find((t) => t.id === obj.typeId) : undefined;
  const color = typeColor(type?.color, theme);
  const done1 = taskProp(type);
  const isTask = !!done1;
  // A repeating task is finished a day at a time, so the chip speaks for today.
  const repeats = !!parseRule(obj?.props?.[REPEAT_PROP]);
  const today = todayKey();
  const done = repeats ? doneDays(obj?.props).includes(today) : !!done1 && obj?.props?.[done1.id] === 'Done';
  const missing = loaded && !obj;

  const scheduleOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (card || openTimer.current) return;
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const above = r.bottom + 260 > window.innerHeight && r.top > 260;
      setCard({
        left: Math.max(10, Math.min(r.left, window.innerWidth - CARD_W - 12)),
        top: above ? r.top - 8 : r.bottom + 8,
        above,
      });
    }, OPEN_DELAY);
  };

  const scheduleClose = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setCard(null), CLOSE_DELAY);
  };

  const closeNow = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
    setCard(null);
  };

  const toggle = async () => {
    if (!obj || !done1) return;
    if (repeats) {
      const days = new Set(doneDays(obj.props));
      if (done) days.delete(today);
      else days.add(today);
      setObj({ ...obj, props: { ...obj.props, [REPEAT_DONE_PROP]: [...days] } });
      await api.tasks.setDone({ id, dayKey: today, done: !done });
    } else {
      const props = { ...obj.props, [done1.id]: done ? openStatusOf(done1) : 'Done' };
      setObj({ ...obj, props }); // optimistic, so the chip flips under the cursor
      await api.objects.update(id, { props });
    }
    objectChanged(id);
  };

  /** Keep clicks from moving the editor selection or starting a drag. */
  const eat = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const rows = obj ? previewProps(obj, type, done1?.id) : [];

  // ProseMirror re-focuses the document right after inserting the node, so the
  // field has to claim the caret on the next frame rather than via autoFocus.
  useEffect(() => {
    if (!renaming) return;
    let frame = 0;
    const grab = () => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
      // Two frames covers the insert transaction and the editor's own focus call.
      if (document.activeElement !== el && frame < 6) {
        frame++;
        requestAnimationFrame(grab);
      }
    };
    const id = requestAnimationFrame(grab);
    return () => cancelAnimationFrame(id);
  }, [renaming]);

  const startRename = () => {
    setDraft(obj?.title ?? '');
    setRenaming(true);
    closeNow();
  };

  /** Saves the typed title on the object and hands the caret back to the note. */
  const commitRename = (keepGoing = false) => {
    const title = draft.trim();
    setRenaming(false);
    updateAttributes({ draft: false, label: title || 'Untitled' });
    if (title && title !== obj?.title) {
      api.objects.update(id, { title }).then(() => objectChanged(id));
    }
    if (!keepGoing) {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (pos !== null) editor.chain().focus().setTextSelection(pos + node.nodeSize).run();
    }
  };

  if (renaming) {
    return (
      <NodeViewWrapper as="span" className="mention-nv">
        <span className={'mention renaming' + (missing ? ' missing' : '')} contentEditable={false}>
          <span className="m-icon">
            <TypeIcon icon={type?.icon} color={color} size={12} />
          </span>
          <input
            ref={inputRef}
            className="m-rename"
            spellCheck
            value={draft}
            placeholder="Task name…"
            size={Math.max(10, draft.length + 2)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitRename(true)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                commitRename();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(obj?.title ?? '');
                commitRename();
              }
            }}
          />
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="mention-nv">
      <span
        ref={ref}
        className={'mention' + (done ? ' done' : '') + (missing ? ' missing' : '')}
        data-id={id}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onClick={(e) => {
          eat(e);
          closeNow();
          if (obj) openFrom(e, id);
        }}
      >
        {isTask ? (
          <button
            className={'m-tick' + (done ? ' on' : '')}
            onMouseDown={eat}
            onClick={(e) => {
              eat(e);
              toggle();
            }}
            aria-label={done ? 'Mark as not done' : 'Mark as done'}
          >
            {done && <Icon name="check" size={9} />}
          </button>
        ) : (
          <span className="m-icon">
            <TypeIcon icon={type?.icon} color={missing ? undefined : color} size={12} />
          </span>
        )}
        <span className="m-label">{obj?.title || label}</span>
      </span>

      {card &&
        createPortal(
          <motion.div
            className={'mc-card' + (card.above ? ' above' : '')}
            style={{ left: card.left, top: card.top }}
            variants={popIn}
            initial="hidden"
            animate="shown"
            onMouseEnter={() => closeTimer.current && clearTimeout(closeTimer.current)}
            onMouseLeave={scheduleClose}
            onMouseDown={(e) => e.stopPropagation()}
            contentEditable={false}
          >
            {missing ? (
              <div className="mc-gone">This object no longer exists.</div>
            ) : !obj ? (
              <div className="mc-gone">Loading…</div>
            ) : (
              <>
                <div className="mc-head">
                  <TypeIcon icon={type?.icon} color={color} size={13} />
                  <span className="mc-type">{type?.name || 'Object'}</span>
                  {done1 && (
                    <span className={'mc-status' + (done ? ' done' : '')}>
                      {obj.props?.[done1.id] || openStatusOf(done1)}
                    </span>
                  )}
                </div>
                <div className="mc-title">{obj.title || 'Untitled'}</div>
                {rows.length > 0 && (
                  <div className="mc-props">
                    {rows.map((r) => (
                      <div className="mc-prop" key={r.name}>
                        <span className="mc-prop-name">{r.name}</span>
                        <span className="mc-prop-val">{r.value}</span>
                      </div>
                    ))}
                  </div>
                )}
                {obj.snippet && <div className="mc-snippet">{obj.snippet}</div>}
                <div className="mc-meta">Edited {ago(obj.updatedAt)}</div>
                <div className="mc-actions">
                  <button
                    onMouseDown={eat}
                    onClick={(e) => {
                      closeNow();
                      openFrom(e, id);
                    }}
                  >
                    <Icon name="arrow-up-right" size={13} /> Open
                  </button>
                  <button
                    title="Rename"
                    onMouseDown={eat}
                    onClick={startRename}
                  >
                    <Icon name="pencil" size={13} /> Rename
                  </button>
                  <button
                    title="Open in the other pane"
                    onMouseDown={eat}
                    onClick={() => {
                      closeNow();
                      openBeside(id);
                    }}
                  >
                    <Icon name="columns" size={13} /> Split
                  </button>
                  {done1 && (
                    <button
                      className="mc-toggle"
                      onMouseDown={eat}
                      onClick={() => {
                        toggle();
                      }}
                    >
                      <Icon name="check" size={13} /> {done ? 'Reopen' : 'Complete'}
                    </button>
                  )}
                </div>
              </>
            )}
          </motion.div>,
          document.body
        )}
    </NodeViewWrapper>
  );
}
