import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { SlashItem } from '../slash';
import { Icon } from './Icons';

export interface SlashListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const SlashList = forwardRef<SlashListHandle, { items: SlashItem[]; command: (item: SlashItem) => void }>(
  function SlashList(props, ref) {
    const [index, setIndex] = useState(0);
    const rows = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => setIndex(0), [props.items]);

    // Keep the keyboard selection visible when the list scrolls.
    useEffect(() => {
      rows.current[index]?.scrollIntoView({ block: 'nearest' });
    }, [index]);

    const select = (i: number) => {
      const item = props.items[i];
      if (item) props.command(item);
    };

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) => {
          const n = props.items.length;
          if (event.key === 'ArrowDown') {
            setIndex((i) => (n ? (i + 1) % n : 0));
            return true;
          }
          if (event.key === 'ArrowUp') {
            setIndex((i) => (n ? (i - 1 + n) % n : 0));
            return true;
          }
          if (event.key === 'Enter') {
            select(index);
            return true;
          }
          return false;
        },
      }),
      [props.items, index]
    );

    if (props.items.length === 0) {
      return <div className="empty" style={{ padding: 14, fontSize: 13 }}>No commands match</div>;
    }

    return (
      <div>
        {props.items.map((item, i) => (
          <div key={item.id}>
            {/* Group header whenever the section changes, so the menu reads as a list of categories. */}
            {item.group !== props.items[i - 1]?.group && <div className="slash-group">{item.group}</div>}
            <button
              ref={(el) => {
                rows.current[i] = el;
              }}
              className={'result-row' + (i === index ? ' sel' : '')}
              onMouseEnter={() => setIndex(i)}
              onClick={() => select(i)}
            >
              <span className="result-emoji">
                <Icon name={item.icon} size={14} />
              </span>
              <span className="result-title">{item.label}</span>
              <span className="result-type">{item.hint}</span>
            </button>
          </div>
        ))}
      </div>
    );
  }
);

export default SlashList;
