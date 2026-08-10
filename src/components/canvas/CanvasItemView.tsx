import { memo, useEffect, useRef } from 'react';
import type { CanvasItem, Side } from '../../types';
import { fileUrl, prettySize } from '../../media';
import { typeColor } from '../../util';
import { Icon, TypeIcon } from '../Icons';

/** Tints a card can be given. `null` is the plain surface, and the default. */
export const CARD_COLORS: (string | null)[] = [
  null,
  '#eda100',
  '#eb6834',
  '#e34948',
  '#e87ba4',
  '#7d4bd8',
  '#2a78d6',
  '#0f9bb0',
  '#1baf7a',
  '#5c7a1e',
];

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

/**
 * How much of an object a card shows, decided by how big it has been made.
 * Resize a card and it fills the room it has been given: a name, then a line of
 * the note, then its properties, then the writing itself.
 */
export type Detail = 'title' | 'brief' | 'props' | 'full';

export function detailFor(item: Pick<CanvasItem, 'w' | 'h'>): Detail {
  if (item.h < 84) return 'title';
  if (item.h < 150) return 'brief';
  if (item.h < 260) return 'props';
  return 'full';
}

/** A hostname is the readable part of a URL — the rest is noise on a card. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

/** A textarea that keeps the caret and grows with what's typed into it. */
function CardText({
  value,
  placeholder,
  editing,
  className,
  onChange,
  onDone,
  onGrow,
}: {
  value: string;
  placeholder: string;
  editing: boolean;
  className: string;
  onChange: (v: string) => void;
  onDone: () => void;
  /** The height the writing now needs, so the card can be made to fit it. */
  onGrow?: (contentHeight: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  /**
   * scrollHeight is only honest once the box has been collapsed: a textarea that
   * is already tall enough reports its own height, not its content's, so it can
   * grow but would never shrink back.
   */
  const measure = () => {
    const el = ref.current;
    if (!el || !onGrow) return;
    const was = el.style.height;
    el.style.height = '0px';
    const needed = el.scrollHeight;
    el.style.height = was;
    onGrow(needed);
  };

  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    measure();
    // Only when editing starts — measuring on every keystroke is the onChange path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!editing) {
    return <div className={className + (value ? '' : ' empty')}>{value || placeholder}</div>;
  }

  return (
    <textarea
      ref={ref}
      className={className + ' editing'}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        onChange(e.target.value);
        measure();
      }}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Escape leaves the card; Enter is a newline, because a sticky note is
        // prose and a stray Return should not end the edit.
        if (e.key === 'Escape') {
          e.preventDefault();
          onDone();
        }
      }}
      // The board's own drag handler must not claim a click meant for the caret.
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

function Body({
  item,
  editing,
  theme,
  draft,
  onDraft,
  onDone,
  onGrow,
}: {
  item: CanvasItem;
  editing: boolean;
  theme: string;
  draft: string;
  onDraft: (v: string) => void;
  onDone: () => void;
  onGrow?: (contentHeight: number) => void;
}) {
  switch (item.kind) {
    case 'object': {
      const o = item.object;
      if (!o) {
        return (
          <div className="cv-missing">
            <Icon name="x" size={14} />
            <span>Object deleted</span>
          </div>
        );
      }
      const detail = detailFor(item);
      // Roughly what fits: the head, the title, and then a line each. Deliberately
      // an estimate — the container hides any overflow, and guessing slightly
      // high beats leaving a gap at the bottom of every card.
      const roomForProps = Math.max(0, Math.floor((item.h - 96) / 22));
      const roomForBody = Math.max(0, Math.floor((item.h - 108 - Math.min(o.props.length, roomForProps) * 22) / 19));

      return (
        <>
          <div className="cv-card-head">
            <TypeIcon icon={o.icon} color={typeColor(o.color, theme)} size={14} />
            <span className="cv-card-type">{o.typeName}</span>
            {o.done && <span className="cv-done">Done</span>}
          </div>
          <div className={'cv-card-title' + (o.done ? ' done' : '')}>{o.title || 'Untitled'}</div>

          {detail === 'brief' && o.snippet && <div className="cv-card-snippet">{o.snippet}</div>}

          {detail !== 'title' && detail !== 'brief' && o.props.length > 0 && (
            <div className="cv-card-props">
              {o.props.slice(0, roomForProps).map((p) => (
                <div key={p.id} className="cv-card-prop">
                  <span className="cv-prop-name">{p.name}</span>
                  <span className={'cv-prop-value k-' + p.kind}>{p.value}</span>
                </div>
              ))}
              {o.props.length > roomForProps && <div className="cv-card-more">+{o.props.length - roomForProps} more</div>}
            </div>
          )}

          {detail === 'full' && (o.body || o.snippet) && roomForBody > 0 && (
            <div className="cv-card-body" style={{ WebkitLineClamp: roomForBody }}>
              {o.body || o.snippet}
            </div>
          )}

          {detail === 'props' && !o.props.length && o.snippet && <div className="cv-card-snippet">{o.snippet}</div>}
        </>
      );
    }

    case 'note':
      return (
        <CardText
          className="cv-note-text"
          value={editing ? draft : item.data.text ?? ''}
          placeholder="Write something…"
          editing={editing}
          onChange={onDraft}
          onDone={onDone}
          onGrow={onGrow}
        />
      );

    case 'text':
      return (
        <CardText
          className="cv-free-text"
          value={editing ? draft : item.data.text ?? ''}
          placeholder="Text"
          editing={editing}
          onChange={onDraft}
          onDone={onDone}
          onGrow={onGrow}
        />
      );

    case 'image': {
      const f = item.file;
      if (!f) return <div className="cv-missing">Image missing</div>;
      return <img className="cv-image" src={fileUrl(f)} alt={f.name} draggable={false} />;
    }

    case 'file': {
      const f = item.file;
      if (!f) return <div className="cv-missing">File missing</div>;
      return (
        <div className="cv-file">
          <span className="cv-file-icon">
            <Icon name="paperclip" size={16} />
          </span>
          <span className="cv-file-meta">
            <span className="cv-file-name">{f.name}</span>
            <span className="cv-file-size">{prettySize(f.size)}</span>
          </span>
        </div>
      );
    }

    case 'link': {
      const url = item.data.url ?? '';
      return (
        <div className="cv-link">
          <span className="cv-link-icon">
            <Icon name="globe" size={15} />
          </span>
          <span className="cv-link-title">{item.data.title || hostOf(url)}</span>
          <span className="cv-link-url">{url}</span>
        </div>
      );
    }

    case 'frame':
      return (
        <CardText
          className="cv-frame-title"
          value={editing ? draft : item.data.title ?? ''}
          placeholder="Frame"
          editing={editing}
          onChange={onDraft}
          onDone={onDone}
          onGrow={onGrow}
        />
      );

    default:
      return null;
  }
}

/**
 * One card. It draws itself and nothing more — dragging, resizing and connecting
 * are all read off these data attributes by the board, which is what lets a drag
 * of a whole selection stay a single handler instead of one per card.
 */
export const CanvasItemView = memo(function CanvasItemView({
  item,
  selected,
  editing,
  theme,
  draft,
  onDraft,
  onDoneEditing,
  onGrow,
}: {
  item: CanvasItem;
  selected: boolean;
  editing: boolean;
  theme: string;
  draft: string;
  onDraft: (v: string) => void;
  onDoneEditing: () => void;
  /** Reports how tall the writing needs the card to be, while it is being typed. */
  onGrow?: (contentHeight: number) => void;
}) {
  const tint = item.data.color ? typeColor(item.data.color, theme) : null;
  const locked = !!item.data.locked;

  return (
    <div
      className={
        'cv-item' +
        ` k-${item.kind}` +
        (selected ? ' selected' : '') +
        (editing ? ' editing' : '') +
        (locked ? ' locked' : '') +
        (tint ? ' tinted' : '')
      }
      data-item={item.id}
      style={{
        transform: `translate3d(${item.x}px, ${item.y}px, 0)`,
        width: item.w,
        height: item.h,
        zIndex: item.z,
        ...(tint ? ({ '--tint': tint } as React.CSSProperties) : null),
      }}
    >
      <div className="cv-item-body">
        <Body
          item={item}
          editing={editing}
          theme={theme}
          draft={draft}
          onDraft={onDraft}
          onDone={onDoneEditing}
          onGrow={onGrow}
        />
      </div>

      {locked && (
        <span className="cv-lock" title="Locked">
          <Icon name="lock" size={11} />
        </span>
      )}

      {/* Ports are always in the DOM so a connector drag can start the instant
          the pointer arrives; CSS is what fades them in. */}
      <div className="cv-ports">
        {SIDES.map((side) => (
          <span key={side} className={'cv-port p-' + side} data-port={side} data-item={item.id} />
        ))}
      </div>

      {selected && !locked && (
        <div className="cv-handles">
          {CORNERS.map((c) => (
            <span key={c} className={'cv-handle h-' + c} data-resize={c} data-item={item.id} />
          ))}
        </div>
      )}
    </div>
  );
});
