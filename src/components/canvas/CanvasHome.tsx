import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { ask } from '../../confirm';
import { dealtIn, spring, stagger } from '../../motion';
import { useApp } from '../../store';
import type { CanvasSummary } from '../../types';
import { ago, typeColor } from '../../util';
import { Icon } from '../Icons';
import { SplitControls } from '../SplitControls';
import { bounds } from './geometry';

/**
 * A board's own contents, shrunk to fit the tile. Not a screenshot — the cards
 * are drawn from their real positions, so the tile keeps up with the board
 * without anything having to be rendered offscreen and cached.
 */
function Minimap({ board, theme }: { board: CanvasSummary; theme: string }) {
  const shapes = useMemo(() => {
    const box = bounds(board.preview);
    if (!box || !box.w || !box.h) return null;
    const pad = 8;
    const w = 220;
    const h = 116;
    const k = Math.min((w - pad * 2) / box.w, (h - pad * 2) / box.h);
    return {
      w,
      h,
      cards: board.preview.map((p) => ({
        x: (p.x - box.x) * k + (w - box.w * k) / 2,
        y: (p.y - box.y) * k + (h - box.h * k) / 2,
        w: Math.max(3, p.w * k),
        h: Math.max(3, p.h * k),
        kind: p.kind,
        color: p.color,
      })),
    };
  }, [board.preview]);

  if (!shapes) {
    return (
      <div className="cv-tile-map empty">
        <Icon name="canvas" size={22} />
      </div>
    );
  }

  return (
    <div className="cv-tile-map">
      <svg viewBox={`0 0 ${shapes.w} ${shapes.h}`} preserveAspectRatio="xMidYMid meet">
        {shapes.cards.map((c, i) => (
          <rect
            key={i}
            x={c.x}
            y={c.y}
            width={c.w}
            height={c.h}
            rx={Math.min(3, c.w / 3)}
            className={'cv-tile-card k-' + c.kind}
            fill={c.color ? typeColor(c.color, theme) : undefined}
          />
        ))}
      </svg>
    </div>
  );
}

export function CanvasHome() {
  const { navigate, theme } = useApp();
  const [boards, setBoards] = useState<CanvasSummary[] | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const load = () => api.canvas.list().then(setBoards);

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const made = await api.canvas.create({ name: 'Untitled board' });
    navigate({ kind: 'canvas', id: made.id });
  };

  const remove = async (board: CanvasSummary) => {
    setMenu(null);
    if (!(await ask(`Delete “${board.name}”? The objects on it stay in your vault.`))) return;
    await api.canvas.remove(board.id);
    load();
  };

  return (
    <div className="page cv-home">
      <div className="page-head">
        <h1>Canvas</h1>
        <span className="spacer" />
        <button className="btn primary" onClick={create}>
          <Icon name="plus" size={14} /> New board
        </button>
        <SplitControls />
      </div>

      <p className="page-sub">An open space for anything — notes from your vault, images, files, links, and the lines between them.</p>

      {boards && !boards.length && (
        <div className="cv-home-empty">
          <span className="cv-home-mark">
            <Icon name="canvas" size={26} />
          </span>
          <h2>No boards yet</h2>
          <p>Start one and drop things on it. Nothing you add here leaves your vault.</p>
          <button className="btn primary" onClick={create}>
            Make the first board
          </button>
        </div>
      )}

      <motion.div className="cv-tiles" variants={stagger} initial="hidden" animate="shown">
        <AnimatePresence initial={false}>
          {(boards ?? []).map((b) => (
            <motion.div
              key={b.id}
              className="cv-tile"
              variants={dealtIn}
              exit={{ opacity: 0, scale: 0.96 }}
              whileHover={{ y: -3 }}
              transition={spring}
              layout
            >
              <button className="cv-tile-open" onClick={() => navigate({ kind: 'canvas', id: b.id })}>
                <Minimap board={b} theme={theme} />
                {renaming === b.id ? (
                  // Renamed in place. Electron has no window.prompt, so a dialog
                  // asked for that way would simply never appear.
                  <input
                    className="cv-tile-rename"
                    defaultValue={b.name}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onBlur={async (e) => {
                      const name = e.target.value.trim();
                      setRenaming(null);
                      if (name && name !== b.name) {
                        await api.canvas.patch(b.id, { name });
                        load();
                      }
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="cv-tile-name">{b.name}</span>
                )}
                <span className="cv-tile-meta">
                  {b.count} item{b.count === 1 ? '' : 's'} · {ago(b.updatedAt)}
                </span>
              </button>
              <button
                className="icon-btn cv-tile-menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === b.id ? null : b.id);
                }}
                aria-label="Board options"
              >
                <Icon name="more-horizontal" size={15} />
              </button>
              {menu === b.id && (
                <>
                  <div className="backdrop transparent" onClick={() => setMenu(null)} />
                  <div className="popover cv-tile-pop">
                    <button
                      className="menu-item"
                      onClick={() => {
                        setMenu(null);
                        setRenaming(b.id);
                      }}
                    >
                      <Icon name="pencil" size={14} /> Rename
                    </button>
                    <button className="menu-item danger" onClick={() => remove(b)}>
                      <Icon name="trash" size={14} /> Delete board
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
