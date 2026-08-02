import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { TagObj } from '../types';
import { typeColor } from '../util';
import { Icon } from './Icons';
import { SplitControls } from './SplitControls';

export function TagsView() {
  const { types, openFrom, theme } = useApp();
  const [tags, setTags] = useState<TagObj[] | null>(null);
  const [newTag, setNewTag] = useState('');

  const reload = () => api.tags.list().then(setTags);

  useEffect(() => {
    reload();
  }, []);

  const color = typeColor(types.find((t) => t.id === 'tag')?.color ?? '#eb6834', theme);

  const add = async () => {
    const name = newTag.trim();
    if (!name) return;
    setNewTag('');
    await api.tags.ensure(name);
    reload();
  };

  const remove = async (t: TagObj) => {
    const where = t.uses === 1 ? '1 object' : `${t.uses} objects`;
    const warning = t.uses > 0
      ? `\n\nIt will be removed from ${where}. The objects themselves are kept — only the tag goes away.`
      : '';
    if (!confirm(`Delete the tag “${t.title}”?${warning}`)) return;
    await api.tags.remove(t.id);
    reload();
  };

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <span className="type-emoji big">
            <Icon name="hash" size={22} />
          </span>
          <h1>Tags</h1>
          <span className="count-badge">{tags?.length ?? 0}</span>
        </div>
        <SplitControls />
      </header>

      <div className="tags-page">
        <div className="tag-add">
          <span className="tag-add-hash">#</span>
          <input
            className="tag-add-input"
            placeholder="New tag…"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </div>

        {tags && tags.length === 0 && (
          <div className="empty">
            No tags yet — type <code>#</code> while writing anything to create one.
          </div>
        )}

        <div className="tag-grid">
          {tags?.map((t) => (
            <div className="tag-card" key={t.id}>
              <button className="tag-card-main" onClick={(e) => openFrom(e, t.id)}>
                <span className="tag-chip static" style={{ color, borderColor: color }}>
                  #{t.title}
                </span>
                <span className="tag-uses">{t.uses === 1 ? '1 object' : `${t.uses} objects`}</span>
              </button>
              <button className="row-del" onClick={() => remove(t)} aria-label="Delete tag">
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
