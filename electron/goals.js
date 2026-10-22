// Goals — track big and small aspirations, target milestones, and sub-steps.
//
// A Goal can have steps/milestones with completion status. When a goal is
// finished, celebratory particles and animations activate. Everything is stored
// in its own sqlite tables with change-tracking support for sync.

const { randomUUID } = require('crypto');

const uid = () => randomUUID().replace(/-/g, '').slice(0, 16);
const now = () => Date.now();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Personal',
  target_date TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  color TEXT NOT NULL DEFAULT '#ec5b5b',
  icon TEXT NOT NULL DEFAULT 'target',
  is_north_star INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS goal_steps (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_goal_steps_goal ON goal_steps(goal_id);
CREATE INDEX IF NOT EXISTS idx_goals_updated ON goals(updated_at);
CREATE INDEX IF NOT EXISTS idx_goals_north_star ON goals(is_north_star);
CREATE INDEX IF NOT EXISTS idx_goals_created ON goals(created_at);
`;

function parseStep(r) {
  if (!r) return null;
  return {
    id: r.id,
    goalId: r.goal_id,
    title: r.title,
    completed: !!r.completed,
    position: r.position,
    createdAt: r.created_at,
  };
}

function parseGoal(r, steps = []) {
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    targetDate: r.target_date || null,
    completed: !!r.completed,
    completedAt: r.completed_at || null,
    color: r.color,
    icon: r.icon,
    isNorthStar: !!r.is_north_star,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    steps,
  };
}

function create(getDb) {
  const db = () => getDb();

  const getStepsFor = (goalId) => {
    return db()
      .prepare('SELECT * FROM goal_steps WHERE goal_id = ? ORDER BY position ASC, created_at ASC')
      .all(String(goalId))
      .map(parseStep);
  };

  const getGoal = (id) => {
    const row = db().prepare('SELECT * FROM goals WHERE id = ?').get(String(id));
    if (!row) return null;
    return parseGoal(row, getStepsFor(row.id));
  };

  return {
    'goals:list': ({ category } = {}) => {
      const q = category
        ? db().prepare('SELECT * FROM goals WHERE category = ? ORDER BY is_north_star DESC, created_at ASC').all(String(category))
        : db().prepare('SELECT * FROM goals ORDER BY is_north_star DESC, created_at ASC').all();
      return q.map((r) => parseGoal(r, getStepsFor(r.id)));
    },

    'goals:get': (id) => getGoal(id),

    'goals:create': ({ title, description, category, targetDate, color, icon, isNorthStar, steps } = {}) => {
      const id = uid();
      const t = now();
      const cat = String(category || 'Personal').trim();
      const clr = String(color || '#ec5b5b');
      const icn = String(icon || 'target');

      let northStarVal = 0;
      if (isNorthStar) {
        const existing = db().prepare('SELECT id FROM goals WHERE is_north_star = 1').get();
        if (existing) {
          throw new Error('A North Star goal already exists. Complete or remove it first.');
        }
        northStarVal = 1;
      }

      db()
        .prepare(
          'INSERT INTO goals (id, title, description, category, target_date, completed, completed_at, color, icon, is_north_star, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?)'
        )
        .run(id, String(title || '').trim(), String(description || '').trim(), cat, targetDate || null, clr, icn, northStarVal, t, t);

      if (Array.isArray(steps) && steps.length > 0) {
        const insStep = db().prepare(
          'INSERT INTO goal_steps (id, goal_id, title, completed, position, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        steps.forEach((s, idx) => {
          const stepTitle = typeof s === 'string' ? s : s?.title;
          if (stepTitle && stepTitle.trim()) {
            insStep.run(uid(), id, stepTitle.trim(), s?.completed ? 1 : 0, idx, t + idx);
          }
        });
      }

      return getGoal(id);
    },

    'goals:patch': ({ id, patch } = {}) => {
      const cur = db().prepare('SELECT * FROM goals WHERE id = ?').get(String(id));
      if (!cur) return null;
      const t = now();

      const title = patch?.title !== undefined ? String(patch.title).trim() : cur.title;
      const description = patch?.description !== undefined ? String(patch.description).trim() : cur.description;
      const category = patch?.category !== undefined ? String(patch.category).trim() : cur.category;
      const targetDate = patch?.targetDate !== undefined ? (patch.targetDate || null) : cur.target_date;
      const color = patch?.color !== undefined ? String(patch.color) : cur.color;
      const icon = patch?.icon !== undefined ? String(patch.icon) : cur.icon;
      let completed = cur.completed;
      let completedAt = cur.completed_at;

      let isNorthStar = cur.is_north_star;
      if (patch?.isNorthStar !== undefined) {
        const wantsNorthStar = patch.isNorthStar ? 1 : 0;
        if (wantsNorthStar === 1 && cur.is_north_star !== 1) {
          const existing = db().prepare('SELECT id FROM goals WHERE is_north_star = 1 AND id != ?').get(String(id));
          if (existing) {
            throw new Error('A North Star goal already exists. Complete or remove it first.');
          }
        }
        isNorthStar = wantsNorthStar;
      }

      if (patch?.completed !== undefined) {
        const nextCompleted = patch.completed ? 1 : 0;
        if (nextCompleted !== cur.completed) {
          completed = nextCompleted;
          completedAt = nextCompleted ? t : null;
        }
      }

      db()
        .prepare(
          'UPDATE goals SET title = ?, description = ?, category = ?, target_date = ?, completed = ?, completed_at = ?, color = ?, icon = ?, is_north_star = ?, updated_at = ? WHERE id = ?'
        )
        .run(title, description, category, targetDate, completed, completedAt, color, icon, isNorthStar, t, String(id));

      return getGoal(id);
    },

    'goals:delete': (id) => {
      db().prepare('DELETE FROM goal_steps WHERE goal_id = ?').run(String(id));
      db().prepare('DELETE FROM goals WHERE id = ?').run(String(id));
      return true;
    },

    'goals:stepAdd': ({ goalId, title } = {}) => {
      const g = db().prepare('SELECT id FROM goals WHERE id = ?').get(String(goalId));
      if (!g) throw new Error('Goal not found');
      const stepId = uid();
      const t = now();
      const maxPos = db().prepare('SELECT MAX(position) AS pos FROM goal_steps WHERE goal_id = ?').get(String(goalId))?.pos ?? -1;
      db()
        .prepare('INSERT INTO goal_steps (id, goal_id, title, completed, position, created_at) VALUES (?, ?, ?, 0, ?, ?)')
        .run(stepId, String(goalId), String(title || '').trim(), maxPos + 1, t);
      db().prepare('UPDATE goals SET updated_at = ? WHERE id = ?').run(t, String(goalId));
      return parseStep(db().prepare('SELECT * FROM goal_steps WHERE id = ?').get(stepId));
    },

    'goals:stepToggle': ({ id, completed } = {}) => {
      const step = db().prepare('SELECT * FROM goal_steps WHERE id = ?').get(String(id));
      if (!step) return null;
      const nextCompleted = completed !== undefined ? (completed ? 1 : 0) : (step.completed ? 0 : 1);
      db().prepare('UPDATE goal_steps SET completed = ? WHERE id = ?').run(nextCompleted, String(id));
      const t = now();
      db().prepare('UPDATE goals SET updated_at = ? WHERE id = ?').run(t, step.goal_id);

      // Auto-check if all steps are completed:
      const remaining = db()
        .prepare('SELECT COUNT(*) AS c FROM goal_steps WHERE goal_id = ? AND completed = 0')
        .get(step.goal_id)?.c ?? 0;
      if (remaining === 0) {
        db().prepare('UPDATE goals SET completed = 1, completed_at = ? WHERE id = ? AND completed = 0').run(t, step.goal_id);
      }

      return parseStep(db().prepare('SELECT * FROM goal_steps WHERE id = ?').get(String(id)));
    },

    'goals:stepUpdate': ({ id, title } = {}) => {
      const step = db().prepare('SELECT goal_id FROM goal_steps WHERE id = ?').get(String(id));
      if (!step) return null;
      db().prepare('UPDATE goal_steps SET title = ? WHERE id = ?').run(String(title || '').trim(), String(id));
      db().prepare('UPDATE goals SET updated_at = ? WHERE id = ?').run(now(), step.goal_id);
      return parseStep(db().prepare('SELECT * FROM goal_steps WHERE id = ?').get(String(id)));
    },

    'goals:stepDelete': (id) => {
      const step = db().prepare('SELECT goal_id FROM goal_steps WHERE id = ?').get(String(id));
      if (!step) return false;
      db().prepare('DELETE FROM goal_steps WHERE id = ?').run(String(id));
      db().prepare('UPDATE goals SET updated_at = ? WHERE id = ?').run(now(), step.goal_id);
      return true;
    },
  };
}

module.exports = { SCHEMA, INDEXES, create };
