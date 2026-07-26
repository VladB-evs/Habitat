import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api } from '../api';
import type { MentionEntry, ObjType } from '../types';
import { typeColor } from '../util';
import { TypeIcon } from './Icons';

export interface MentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

// Rendered outside the app's React tree (via ReactRenderer), so no context here.
let typesCache: ObjType[] | null = null;

const MentionList = forwardRef<
  MentionListHandle,
  { items: MentionEntry[]; command: (item: MentionEntry) => void; emptyLabel?: string }
>(function MentionList(props, ref) {
  const [index, setIndex] = useState(0);
  const [types, setTypes] = useState<ObjType[]>(typesCache ?? []);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!typesCache)
      api.types.list().then((t) => {
        typesCache = t;
        setTypes(t);
      });
  }, []);

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

  const theme = document.documentElement.dataset.theme || 'dark';
  const typeOf = (typeId: string) => types.find((t) => t.id === typeId);

  if (props.items.length === 0) {
    return <div className="empty" style={{ padding: 14, fontSize: 13 }}>{props.emptyLabel ?? 'No matching objects'}</div>;
  }

  return (
    <div>
      {props.items.map((item, i) => (
        <button
          key={item.id || 'new'}
          ref={(el) => {
            rows.current[i] = el;
          }}
          className={'result-row' + (i === index ? ' sel' : '')}
          onMouseEnter={() => setIndex(i)}
          onClick={() => select(i)}
        >
          <span className="result-emoji">
            <TypeIcon icon={typeOf(item.typeId)?.icon} color={typeColor(typeOf(item.typeId)?.color, theme)} size={15} />
          </span>
          <span className="result-main">
            <span className="result-title">{item.title || 'Untitled'}</span>
            {item.subtitle && <span className="result-sub">{item.subtitle}</span>}
          </span>
          <span className="result-type">{typeOf(item.typeId)?.name ?? ''}</span>
        </button>
      ))}
    </div>
  );
});

export default MentionList;
