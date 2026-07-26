import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { softSpring, spring } from '../motion';
import { useApp } from '../store';
import type { SettingsInfo } from '../types';
import { typeColor, TYPE_PALETTE } from '../util';
import { NewHabitatModal } from './Habitats';
import { Icon, TypeIcon } from './Icons';
import { ColorPicker, IconPicker } from './TypeEditor';
const SettingsModal = lazy(() => import('./SettingsModal').then((m) => ({ default: m.SettingsModal })));

function NavItem({
  icon,
  leading,
  label,
  active,
  onClick,
}: {
  icon?: string;
  leading?: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      className={'nav-item' + (active ? ' active' : '')}
      onClick={onClick}
      whileHover={{ x: 3 }}
      whileTap={{ scale: 0.97 }}
      transition={spring}
    >
      {icon ? <Icon name={icon} /> : <span className="nav-lead">{leading}</span>}
      <span className="nav-label">{label}</span>
    </motion.button>
  );
}

function NewTypeForm({ onDone }: { onDone: () => void }) {
  const { reloadTypes, navigate } = useApp();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('box');
  const [color, setColor] = useState(TYPE_PALETTE[0]);

  const create = async () => {
    if (!name.trim()) return;
    const t = await api.types.create({ name: name.trim(), icon, color });
    await reloadTypes();
    onDone();
    navigate({ kind: 'type', typeId: t.id });
  };

  return (
    <div className="new-type-form">
      <input
        className="new-type-name"
        placeholder="Type name…"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
          if (e.key === 'Escape') onDone();
        }}
      />
      <IconPicker value={icon} color={color} onPick={setIcon} />
      <ColorPicker value={color} onPick={setColor} />
      <div className="new-type-actions">
        <button className="btn subtle" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" onClick={create}>
          Create
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  onSearch,
  onCollapse,
  /** False while the sidebar is only peeking — the button then pins it open. */
  pinned = true,
}: {
  onSearch: () => void;
  onCollapse: () => void;
  pinned?: boolean;
}) {
  const { types, view, navigate, theme, setTheme } = useApp();
  const [showNewType, setShowNewType] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewHabitat, setShowNewHabitat] = useState(false);
  const [habMenu, setHabMenu] = useState(false);
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  // Daily notes and tags have their own nav entries above.
  const visibleTypes = types.filter((t) => t.id !== 'daily' && t.id !== 'tag');

  useEffect(() => {
    api.settings.get().then(setInfo);
  }, []);

  const active = info?.habitats.find((h) => h.id === info.activeId);

  const switchHabitat = async (id: string) => {
    setHabMenu(false);
    if (id === info?.activeId) return;
    const res = await api.habitats.switchTo(id);
    if (res) window.location.reload();
  };

  const deleteHabitat = async (h: { id: string; name: string }) => {
    if (!confirm(`Permanently delete "${h.name}" and everything in it? This cannot be undone.`)) return;
    const res = await api.habitats.remove(h.id);
    if (res?.ok) window.location.reload();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-drag">
        <button
          className="icon-btn collapse-btn"
          onClick={onCollapse}
          aria-label={pinned ? 'Hide sidebar' : 'Keep sidebar open'}
          title={pinned ? 'Hide sidebar (⌘\)' : 'Keep sidebar open (⌘\)'}
        >
          <Icon name={pinned ? 'panel-close' : 'panel-open'} size={15} />
        </button>
      </div>

      {habMenu && info && (
        <>
          <div className="backdrop" onClick={() => setHabMenu(false)} />
          <div className="popover hab-menu">
            {info.habitats.map((h) => (
              <div className="tpl-row" key={h.id}>
                <button className="menu-item" onClick={() => switchHabitat(h.id)}>
                  <span className="check-slot">{h.id === info.activeId ? <Icon name="check" size={13} /> : null}</span>
                  {h.name}
                </button>
                <button className="icon-btn" onClick={() => deleteHabitat(h)} aria-label="Delete habitat" title="Delete habitat">
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                setHabMenu(false);
                setShowNewHabitat(true);
              }}
            >
              <Icon name="plus" size={14} /> New habitat…
            </button>
            <button
              className="menu-item"
              onClick={async () => {
                setHabMenu(false);
                const res = await api.habitats.open();
                if (res && !('error' in res)) window.location.reload();
              }}
            >
              <Icon name="folder" size={14} /> Open existing…
            </button>
          </div>
        </>
      )}

      <div className="sidebar-inner">
        <button className="logo switcher" onClick={() => setHabMenu((v) => !v)}>
          <span className="logo-mark">
            <Icon name="sprout" size={17} />
          </span>
          <span className="logo-name">{active?.name ?? 'Habitat'}</span>
          <Icon name="chevron-down" size={12} className="logo-chev" />
        </button>

        <button className="search-btn" onClick={onSearch}>
          <Icon name="search" />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="sidebar-nav">
          <NavItem icon="grid" label="Dashboard" active={view.kind === 'dashboard'} onClick={() => navigate({ kind: 'dashboard' })} />
          <NavItem icon="calendar" label="Daily Notes" active={view.kind === 'daily'} onClick={() => navigate({ kind: 'daily' })} />
          <NavItem icon="hash" label="Tags" active={view.kind === 'tags'} onClick={() => navigate({ kind: 'tags' })} />
          <NavItem icon="graph" label="Graph" active={view.kind === 'graph'} onClick={() => navigate({ kind: 'graph' })} />
        </nav>

        <div className="sidebar-section">
          <span>Types</span>
          <button className="icon-btn" onClick={() => setShowNewType((v) => !v)} aria-label="New type">
            <Icon name="plus" size={14} />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {showNewType && (
            <motion.div
              key="new-type"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={softSpring}
              style={{ overflow: 'hidden' }}
            >
              <NewTypeForm onDone={() => setShowNewType(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="type-list">
          {visibleTypes.map((t) => (
            <NavItem
              key={t.id}
              leading={<TypeIcon icon={t.icon} color={typeColor(t.color, theme)} size={15} />}
              label={t.name}
              active={view.kind === 'type' && view.typeId === t.id}
              onClick={() => navigate({ kind: 'type', typeId: t.id })}
            />
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">
            <Icon name="settings" />
          </button>
          <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
        <span className="version">Habitat 0.1</span>
      </div>

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
      {showNewHabitat && <NewHabitatModal onClose={() => setShowNewHabitat(false)} />}
    </aside>
  );
}
