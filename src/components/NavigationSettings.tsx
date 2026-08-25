import { Reorder } from 'motion/react';
import { DEFAULT_NAV, MAX_SLOTS, NAV_BUILTIN_MAP, NAV_BUILTINS, typeIdOf, typeKey } from '../bottomnav';
import type { NavKey } from '../bottomnav';
import { useApp } from '../store';
import { PEOPLE_TYPE, typeColor } from '../util';
import { Icon, TypeIcon } from './Icons';

/** Same exclusion the sidebar's own Types section and the bar's "Types…" sheet
 *  use — these already have a dedicated builtin slot, so pinning the raw type
 *  behind it would just be the same destination twice. */
const UPSTAIRS = new Set(['daily', 'tag', 'task', PEOPLE_TYPE]);

/** Settings' Navigation tab — editing the bottom bar shown once the window is
 *  too narrow for the sidebar. The bar itself (BottomNav.tsx) only ever reads
 *  `bottomNav`; every write happens here. */
export function NavigationSettings() {
  const { types, theme, bottomNav, setBottomNav } = useApp();
  const pickableTypes = types.filter((t) => !UPSTAIRS.has(t.id));

  const iconFor = (key: NavKey) => {
    const typeId = typeIdOf(key);
    if (typeId) {
      const t = types.find((x) => x.id === typeId);
      return <TypeIcon icon={t?.icon} color={t ? typeColor(t.color, theme) : undefined} size={15} />;
    }
    return <Icon name={NAV_BUILTIN_MAP.get(key as never)?.icon ?? 'box'} size={15} />;
  };

  const labelFor = (key: NavKey) => {
    const typeId = typeIdOf(key);
    // A pinned type that got deleted since — still removable, just named honestly.
    if (typeId) return types.find((x) => x.id === typeId)?.name ?? 'Deleted type';
    return NAV_BUILTIN_MAP.get(key as never)?.label ?? key;
  };

  const add = (key: NavKey) => {
    if (bottomNav.includes(key) || bottomNav.length >= MAX_SLOTS) return;
    setBottomNav([...bottomNav, key]);
  };

  // Never down to zero — an empty bar is a phone with no navigation at all.
  const remove = (key: NavKey) => {
    if (bottomNav.length <= 1) return;
    setBottomNav(bottomNav.filter((k) => k !== key));
  };

  const availableBuiltins = NAV_BUILTINS.filter((b) => !bottomNav.includes(b.key));
  const availableTypes = pickableTypes.filter((t) => !bottomNav.includes(typeKey(t.id)));
  const full = bottomNav.length >= MAX_SLOTS;

  return (
    <section className="set-sec">
      <div className="set-title">Bottom bar</div>
      <div className="set-group">
        <div className="set-item stack">
          <div className="set-note">
            Shown instead of the sidebar on a narrow window. Drag to reorder, add from below, ✕ to
            remove — up to {MAX_SLOTS} at a time.
          </div>

          <Reorder.Group as="div" axis="y" values={bottomNav} onReorder={setBottomNav} className="nav-edit-list">
            {bottomNav.map((key) => (
              <Reorder.Item key={key} value={key} as="div" className="nav-edit-row">
                <Icon name="grip" size={14} className="nav-edit-grip" />
                {iconFor(key)}
                <span className="nav-edit-label">{labelFor(key)}</span>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${labelFor(key)}`}
                  onClick={() => remove(key)}
                  disabled={bottomNav.length <= 1}
                >
                  <Icon name="x" size={13} />
                </button>
              </Reorder.Item>
            ))}
          </Reorder.Group>

          {(availableBuiltins.length > 0 || availableTypes.length > 0) && (
            <div className="nav-edit-add">
              <div className="set-name">Add to the bar</div>
              <div className="nav-edit-chips">
                {availableBuiltins.map((b) => (
                  <button key={b.key} className="chip" disabled={full} onClick={() => add(b.key)}>
                    <Icon name={b.icon} size={13} /> {b.label}
                  </button>
                ))}
                {availableTypes.map((t) => (
                  <button key={t.id} className="chip" disabled={full} onClick={() => add(typeKey(t.id))}>
                    <TypeIcon icon={t.icon} color={typeColor(t.color, theme)} size={13} /> {t.name}
                  </button>
                ))}
              </div>
              {full && <div className="set-note">The bar is full — remove something to add another.</div>}
            </div>
          )}

          <div className="set-ctl">
            <button className="btn subtle" onClick={() => setBottomNav(DEFAULT_NAV)}>
              Reset to default
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
