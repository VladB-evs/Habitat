import { useState } from 'react';
import { NAV_BUILTIN_MAP, typeIdOf } from '../bottomnav';
import { useApp } from '../store';
import type { View } from '../store';
import { MEDIA_TYPE, PEOPLE_TYPE, typeColor } from '../util';
import { Icon, TypeIcon } from './Icons';
import { Sheet } from './Sheet';

/** Daily notes, tasks, people, media and tags all have their own nav entries
 *  already — same exclusion Sidebar.tsx uses for its Types section, so the
 *  "Types…" sheet offers exactly the types that don't already have a dedicated slot. */
const UPSTAIRS = new Set(['daily', 'tag', 'task', 'event', PEOPLE_TYPE, MEDIA_TYPE]);

/** Everything "More" can offer a destination for. Canvas is left out, same as
 *  the sidebar's own nav — boards are desktop-only. */
const MORE_DESTINATIONS = ['dashboard', 'daily', 'tasks', 'people', 'media', 'tags', 'study'] as const;

const isBuiltinActive = (key: string, viewKind: string) =>
  key === 'study' ? viewKind === 'study' || viewKind === 'deck' || viewKind === 'studyNote' : viewKind === key;

/**
 * The bar itself, plus the two sheets its catch-all slots open. "More" is
 * deliberately its own light menu of destinations rather than the desktop
 * sidebar-as-drawer: that pulls in the habitat switcher, the type creator,
 * search, all of it — a lot of chrome for "take me to People". Search, Ask
 * and Settings still need a home now that the drawer isn't the default way
 * there, so they ride along at the bottom of the same sheet.
 */
export function BottomNav({ onSearch, onAsk }: { onSearch: () => void; onAsk?: () => void }) {
  const { types, view, navigate, theme, bottomNav, openSettings, openNewHabitat } = useApp();
  const [typesOpen, setTypesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pickableTypes = types.filter((t) => !UPSTAIRS.has(t.id));
  // Only offer a destination here if it isn't already sitting in the bar —
  // otherwise "More" would mostly just repeat the buttons beside it.
  const moreDestinations = MORE_DESTINATIONS.filter((k) => !bottomNav.includes(k));

  const goTo = (view: View, close: () => void) => {
    navigate(view);
    close();
  };

  return (
    <>
      <nav className="bottom-nav">
        {bottomNav.map((key) => {
          if (key === 'more') {
            return (
              <button key="more" className={'bn-item' + (moreOpen ? ' on' : '')} onClick={() => setMoreOpen(true)}>
                <Icon name="more-horizontal" size={19} />
                <span>More</span>
              </button>
            );
          }
          if (key === 'types') {
            return (
              <button
                key="types"
                className={'bn-item' + (view.kind === 'type' ? ' on' : '')}
                onClick={() => setTypesOpen(true)}
              >
                <Icon name="table" size={19} />
                <span>Types</span>
              </button>
            );
          }
          const typeId = typeIdOf(key);
          if (typeId) {
            const t = types.find((x) => x.id === typeId);
            // The type behind a pinned slot got deleted — the slot just quietly
            // drops out rather than rendering a button to nowhere.
            if (!t) return null;
            return (
              <button
                key={key}
                className={'bn-item' + (view.kind === 'type' && view.typeId === typeId ? ' on' : '')}
                onClick={() => navigate({ kind: 'type', typeId })}
              >
                <TypeIcon icon={t.icon} color={typeColor(t.color, theme)} size={19} />
                <span>{t.name}</span>
              </button>
            );
          }
          const b = NAV_BUILTIN_MAP.get(key as never);
          if (!b) return null;
          return (
            <button
              key={key}
              className={'bn-item' + (isBuiltinActive(b.key, view.kind) ? ' on' : '')}
              onClick={() => navigate({ kind: b.key } as never)}
            >
              <Icon name={b.icon} size={19} />
              <span>{b.label}</span>
            </button>
          );
        })}
      </nav>

      <Sheet open={typesOpen} title="Go to a type" onClose={() => setTypesOpen(false)}>
        {pickableTypes.map((t) => (
          <button
            key={t.id}
            className="menu-item"
            onClick={() => goTo({ kind: 'type', typeId: t.id }, () => setTypesOpen(false))}
          >
            <TypeIcon icon={t.icon} color={typeColor(t.color, theme)} size={15} />
            {t.name}
          </button>
        ))}
        {pickableTypes.length === 0 && <div className="set-note" style={{ padding: '10px 14px' }}>No types yet.</div>}
      </Sheet>

      <Sheet open={moreOpen} title="More" onClose={() => setMoreOpen(false)}>
        {moreDestinations.map((key) => {
          const b = NAV_BUILTIN_MAP.get(key)!;
          return (
            <button key={key} className="menu-item" onClick={() => goTo({ kind: b.key } as View, () => setMoreOpen(false))}>
              <Icon name={b.icon} size={15} />
              {b.label}
            </button>
          );
        })}
        {moreDestinations.length > 0 && <div className="menu-sep" />}
        <button
          className="menu-item"
          onClick={() => {
            setMoreOpen(false);
            onSearch();
          }}
        >
          <Icon name="search" size={15} />
          Search
        </button>
        {onAsk && (
          <button
            className="menu-item"
            onClick={() => {
              setMoreOpen(false);
              onAsk();
            }}
          >
            <Icon name="sparkles" size={15} />
            Ask
          </button>
        )}
        <div className="menu-sep" />
        <button
          className="menu-item"
          onClick={() => {
            setMoreOpen(false);
            openNewHabitat();
          }}
        >
          <Icon name="plus" size={15} />
          New habitat…
        </button>
        <button
          className="menu-item"
          onClick={() => {
            setMoreOpen(false);
            openSettings();
          }}
        >
          <Icon name="settings" size={15} />
          Settings
        </button>
      </Sheet>
    </>
  );
}
