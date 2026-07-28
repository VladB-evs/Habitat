import { useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { api } from '../api';
import { fileUrl, isImage, prettySize } from '../media';
import { Icon } from './Icons';

const SCALES = [40, 60, 80, 100];

/**
 * One attachment, drawn as a card of its own. The handle on the left picks the
 * whole block up so it can be dropped anywhere else in the note; everything else
 * — resizing, captioning, opening — sits in a bar that only appears on hover.
 */
export function MediaView({ node, updateAttributes, deleteNode, selected, editor }: NodeViewProps) {
  const { hash, name, mime, ext, size, width, height, caption, scale } = node.attrs as Record<string, any>;
  const [broken, setBroken] = useState(false);
  const editable = editor.isEditable;
  const image = isImage(mime) && !broken;

  const bar = (
    <div className="media-tools" contentEditable={false}>
      {image && (
        <span className="media-scales">
          {SCALES.map((s) => (
            <button
              key={s}
              className={'media-scale' + (scale === s ? ' on' : '')}
              onClick={() => updateAttributes({ scale: s })}
              title={`${s}% of the column`}
            >
              {s}
            </button>
          ))}
        </span>
      )}
      <button className="icon-btn" title="Open" aria-label="Open" onClick={() => api.files.open(hash)}>
        <Icon name="arrow-up-right" size={13} />
      </button>
      <button className="icon-btn" title="Save a copy…" aria-label="Save a copy" onClick={() => api.files.saveAs(hash)}>
        <Icon name="doc" size={13} />
      </button>
      <button className="icon-btn" title="Show in Finder" aria-label="Show in Finder" onClick={() => api.files.reveal(hash)}>
        <Icon name="folder" size={13} />
      </button>
      {editable && (
        <button className="icon-btn" title="Remove" aria-label="Remove" onClick={() => deleteNode()}>
          <Icon name="trash" size={13} />
        </button>
      )}
    </div>
  );

  return (
    <NodeViewWrapper className={'media-block' + (selected ? ' selected' : '') + (image ? '' : ' as-file')}>
      {editable && (
        <span className="media-grip" data-drag-handle contentEditable={false} title="Drag to move">
          <Icon name="grip" size={14} />
        </span>
      )}

      {image ? (
        <figure className="media-figure" style={{ width: `${scale}%` }}>
          <img
            src={fileUrl({ hash, ext })}
            alt={caption || name}
            // Holding the real ratio stops the note jumping about as images load.
            style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}
            draggable={false}
            onError={() => setBroken(true)}
            onDoubleClick={() => api.files.open(hash)}
          />
          {bar}
          {(editable || caption) && (
            <figcaption>
              <input
                className="media-caption"
                placeholder={editable ? 'Add a caption…' : ''}
                value={caption || ''}
                readOnly={!editable}
                onChange={(e) => updateAttributes({ caption: e.target.value })}
              />
            </figcaption>
          )}
        </figure>
      ) : (
        <div className="media-file" onDoubleClick={() => api.files.open(hash)}>
          <span className="media-file-icon">
            <Icon name={broken ? 'x' : 'doc'} size={18} />
          </span>
          <span className="media-file-main">
            <span className="media-file-name">{name || 'Attachment'}</span>
            <span className="media-file-meta">
              {broken ? 'missing from the vault' : [prettySize(size), (ext || '').replace('.', '').toUpperCase()].filter(Boolean).join(' · ')}
            </span>
          </span>
          {bar}
        </div>
      )}
    </NodeViewWrapper>
  );
}
