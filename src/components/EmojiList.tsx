import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { EmojiItem } from '../emoji';
import { emojiCount, GROUP_NAMES } from '../emoji';
import { Icon } from './Icons';

export interface EmojiListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const PER_ROW = 8;

/**
 * The `:` picker: the whole CLDR emoji set, searched by typing after the colon.
 * With no query the grid is split into the standard categories.
 */
const EmojiList = forwardRef<EmojiListHandle, { items: EmojiItem[]; query: string; command: (item: EmojiItem) => void }>(
  function EmojiList(props, ref) {
    const [index, setIndex] = useState(0);
    const cells = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => setIndex(0), [props.query]);
    useEffect(() => {
      cells.current[index]?.scrollIntoView({ block: 'nearest' });
    }, [index]);

    // Category headers only make sense in the unfiltered list, where the order is by group.
    const sections = useMemo(() => {
      const out: { label: string | null; items: EmojiItem[]; offset: number }[] = [];
      if (props.query.trim()) return [{ label: null, items: props.items, offset: 0 }];
      let offset = 0;
      for (const item of props.items) {
        const label = GROUP_NAMES[item.group] ?? 'Other';
        const last = out[out.length - 1];
        if (last && last.label === label) last.items.push(item);
        else out.push({ label, items: [item], offset });
        offset++;
      }
      return out.map((s, i) => ({ ...s, offset: out.slice(0, i).reduce((n, x) => n + x.items.length, 0) }));
    }, [props.items, props.query]);

    const select = (i: number) => {
      const item = props.items[i];
      if (item) props.command(item);
    };

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) => {
          const n = props.items.length;
          if (!n) return false;
          const move = (d: number) => {
            setIndex((i) => (i + d + n) % n);
            return true;
          };
          if (event.key === 'ArrowRight') return move(1);
          if (event.key === 'ArrowLeft') return move(-1);
          if (event.key === 'ArrowDown') return move(PER_ROW);
          if (event.key === 'ArrowUp') return move(-PER_ROW);
          if (event.key === 'Enter' || event.key === 'Tab') {
            select(index);
            return true;
          }
          return false;
        },
      }),
      [props.items, index]
    );

    if (props.items.length === 0) return null;

    return (
      <>
        <div className="emoji-search">
          <Icon name="search" size={13} />
          {props.query ? (
            <span className="emoji-query">{props.query}</span>
          ) : (
            <span className="emoji-hint">Type to search {emojiCount()} emoji…</span>
          )}
          <span className="emoji-count">{props.items.length}</span>
        </div>
        <div className="emoji-scroll">
          {sections.map((sec, si) => (
            <div key={sec.label ?? si}>
              {sec.label && <div className="emoji-group">{sec.label}</div>}
              <div className="emoji-grid">
                {sec.items.map((item, i) => {
                  const flat = sec.offset + i;
                  return (
                    <button
                      key={item.char + flat}
                      ref={(el) => {
                        cells.current[flat] = el;
                      }}
                      className={'emoji-cell' + (flat === index ? ' sel' : '')}
                      title={item.name}
                      onMouseEnter={() => setIndex(flat)}
                      onClick={() => select(flat)}
                    >
                      {item.char}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="emoji-caption">{props.items[index]?.name}</div>
      </>
    );
  }
);

export default EmojiList;
