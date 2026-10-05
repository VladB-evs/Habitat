import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { ask } from '../confirm';
import { useLayout } from '../layout';
import { dialogIn, spring } from '../motion';
import { useApp } from '../store';
import type { Goal, GoalStep } from '../types';
import { CelebrationCanvas } from './CelebrationCanvas';
import { DateField } from './DateField';
import { Icon } from './Icons';
import { PageActions } from './PageActions';
import { SplitControls } from './SplitControls';

const PRESET_COLORS = ['#ec5b5b', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e84393'];
const PRESET_ICONS = ['target', 'flame', 'sparkles', 'star', 'rocket', 'heart', 'dumbbell', 'bookmark'];

export function GoalsView() {
  const { theme, openPageBeside } = useApp();
  const { narrow } = useLayout();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const [celebrationBanner, setCelebrationBanner] = useState<string | null>(null);

  const loadGoals = useCallback(async () => {
    try {
      const list = await api.goals.list();
      setGoals(list);
    } catch (e) {
      console.error('Failed to load goals:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  const triggerCelebration = useCallback((title: string) => {
    setCelebrating(true);
    setCelebrationBanner(title);
    setTimeout(() => {
      setCelebrationBanner(null);
    }, 4000);
  }, []);

  const toggleGoal = async (g: Goal) => {
    const nextCompleted = !g.completed;
    try {
      const updated = await api.goals.patch(g.id, { completed: nextCompleted });
      if (updated) {
        setGoals((list) => list.map((item) => (item.id === g.id ? updated : item)));
        if (nextCompleted) {
          triggerCelebration(g.title);
        }
      }
    } catch (e) {
      console.error('Failed to toggle goal:', e);
    }
  };

  const toggleStep = async (goal: Goal, step: GoalStep) => {
    try {
      const updatedStep = await api.goals.stepToggle({ id: step.id, completed: !step.completed });
      if (updatedStep) {
        const refreshed = await api.goals.get(goal.id);
        if (refreshed) {
          setGoals((list) => list.map((item) => (item.id === goal.id ? refreshed : item)));
          if (!goal.completed && refreshed.completed) {
            triggerCelebration(goal.title);
          }
        }
      }
    } catch (e) {
      console.error('Failed to toggle step:', e);
    }
  };

  const deleteGoal = async (g: Goal) => {
    const ok = await ask(`Delete goal "${g.title || 'Untitled'}"?`, {
      detail: 'This will also delete any steps attached to this goal.',
      confirmLabel: 'Delete Goal',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.goals.delete(g.id);
      setGoals((list) => list.filter((item) => item.id !== g.id));
    } catch (e) {
      console.error('Failed to delete goal:', e);
    }
  };

  const filtered = useMemo(() => {
    return goals.filter((g) => {
      if (filterStatus === 'active' && g.completed) return false;
      if (filterStatus === 'completed' && !g.completed) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (g.title || '').toLowerCase().includes(q);
        const matchDesc = (g.description || '').toLowerCase().includes(q);
        const matchStep = (g.steps || []).some((s) => s.title.toLowerCase().includes(q));
        if (!matchTitle && !matchDesc && !matchStep) return false;
      }
      return true;
    });
  }, [goals, filterStatus, searchQuery]);

  const activeCount = useMemo(() => goals.filter((g) => !g.completed).length, [goals]);

  return (
    <div className="page goals-page">
      <CelebrationCanvas active={celebrating} onFinished={() => setCelebrating(false)} />

      {/* Celebration Notification Banner */}
      <AnimatePresence>
        {celebrationBanner && (
          <motion.div
            className="hab-goal-celebration-toast"
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={spring}
          >
            <div className="celebration-toast-inner">
              <span className="celebration-badge">🎉 GOAL CRUSHED!</span>
              <strong className="celebration-title">{celebrationBanner}</strong>
              <span className="celebration-msg">Incredible work! Keep that momentum going!</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="page-head">
        <div className="page-title">
          <span className="type-emoji big">
            <Icon name="target" size={22} />
          </span>
          <h1>Goals</h1>
          <span className="count-badge">{activeCount}</span>
        </div>

        <PageActions>
          <div className="page-actions">
            <button className="btn primary" onClick={() => setShowAddModal(true)}>
              <Icon name="plus" size={14} /> <span>New Goal</span>
            </button>
            <SplitControls onSplit={() => openPageBeside({ kind: 'goals' })} />
          </div>
        </PageActions>
      </header>

      <div className="goals-body">
        {/* Filter & Search Toolbar */}
        <div className="hab-goals-toolbar">
          <div className="hab-goals-search">
            <Icon name="search" size={13} className="search-icon" />
            <input
              type="text"
              placeholder="Search goals or steps…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="icon-btn" onClick={() => setSearchQuery('')} aria-label="Clear search">
                <Icon name="x" size={12} />
              </button>
            )}
          </div>

          <div className="seg mini">
            <button
              className={filterStatus === 'all' ? 'on' : ''}
              onClick={() => setFilterStatus('all')}
            >
              All
            </button>
            <button
              className={filterStatus === 'active' ? 'on' : ''}
              onClick={() => setFilterStatus('active')}
            >
              Active
            </button>
            <button
              className={filterStatus === 'completed' ? 'on' : ''}
              onClick={() => setFilterStatus('completed')}
            >
              Done
            </button>
          </div>
        </div>

        {/* Content: Goals Grid or Empty State */}
        {loading ? (
          <div className="hab-goals-empty-state">
            <Icon name="target" size={32} />
            <p>Loading your goals…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="hab-goals-empty-state">
            <Icon name="target" size={36} />
            <h3>No goals match this view</h3>
            <p>Whether it’s a big milestone or a daily ritual, set your first aspiration.</p>
            <button className="btn primary" onClick={() => setShowAddModal(true)}>
              <Icon name="plus" size={14} /> Add a Goal
            </button>
          </div>
        ) : (
          <div className="hab-goals-grid">
            <AnimatePresence>
              {filtered.map((g) => (
                <GoalCard
                  key={g.id}
                  goal={g}
                  onToggleGoal={() => toggleGoal(g)}
                  onToggleStep={(s) => toggleStep(g, s)}
                  onEdit={() => setEditingGoal(g)}
                  onDelete={() => deleteGoal(g)}
                  onReload={loadGoals}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Add / Edit Goal Modal */}
      <AnimatePresence>
        {(showAddModal || editingGoal) && (
          <GoalEditorModal
            goal={editingGoal}
            onClose={() => {
              setShowAddModal(false);
              setEditingGoal(null);
            }}
            onSaved={(saved) => {
              loadGoals();
              setShowAddModal(false);
              setEditingGoal(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function GoalCard({
  goal,
  onToggleGoal,
  onToggleStep,
  onEdit,
  onDelete,
  onReload,
}: {
  goal: Goal;
  onToggleGoal: () => void;
  onToggleStep: (step: GoalStep) => void;
  onEdit: () => void;
  onDelete: () => void;
  onReload: () => void;
}) {
  const [addingStep, setAddingStep] = useState(false);
  const [stepInput, setStepInput] = useState('');
  const stepInputRef = useRef<HTMLInputElement>(null);

  const steps = goal.steps || [];
  const totalSteps = steps.length;
  const doneSteps = steps.filter((s) => s.completed).length;
  const percent = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : goal.completed ? 100 : 0;

  const handleAddStep = async () => {
    if (!stepInput.trim()) return;
    try {
      await api.goals.stepAdd({ goalId: goal.id, title: stepInput.trim() });
      setStepInput('');
      setAddingStep(false);
      onReload();
    } catch (e) {
      console.error('Failed to add step:', e);
    }
  };

  const removeStep = async (stepId: string) => {
    try {
      await api.goals.stepDelete(stepId);
      onReload();
    } catch (e) {
      console.error('Failed to delete step:', e);
    }
  };

  useEffect(() => {
    if (addingStep) stepInputRef.current?.focus();
  }, [addingStep]);

  return (
    <motion.div
      className={`hab-goal-card ${goal.completed ? 'completed' : ''}`}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      style={{ '--goal-accent': goal.color || '#ec5b5b' } as React.CSSProperties}
    >
      <div className="hab-goal-card-top">
        <div className="hab-goal-icon-badge" style={{ background: `${goal.color || '#ec5b5b'}1c`, color: goal.color || '#ec5b5b' }}>
          <Icon name={goal.icon || 'target'} size={18} />
        </div>
        <div className="hab-goal-top-meta">
          {goal.targetDate && (
            <span className="hab-goal-target-date">
              <Icon name="calendar" size={11} /> {goal.targetDate}
            </span>
          )}
        </div>
        <div className="hab-goal-card-actions">
          <button className="icon-btn" onClick={onEdit} title="Edit goal" aria-label="Edit goal">
            <Icon name="pencil" size={13} />
          </button>
          <button className="icon-btn" onClick={onDelete} title="Delete goal" aria-label="Delete goal">
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>

      <div className="hab-goal-card-body">
        <div className="hab-goal-title-line">
          <button
            className={`hab-goal-checkbox ${goal.completed ? 'checked' : ''}`}
            onClick={onToggleGoal}
            title={goal.completed ? 'Mark incomplete' : 'Mark complete'}
          >
            {goal.completed && <Icon name="check" size={13} />}
          </button>
          <h3 className="hab-goal-title" onClick={onEdit}>
            {goal.title || 'Untitled Goal'}
          </h3>
        </div>

        {goal.description && <p className="hab-goal-desc">{goal.description}</p>}

        {/* Milestone Steps Progress */}
        {totalSteps > 0 && (
          <div className="hab-goal-meter">
            <div className="hab-goal-meter-header">
              <span>{doneSteps} of {totalSteps} completed</span>
            </div>
            <div className="hab-goal-meter-track">
              <motion.div
                className="hab-goal-meter-fill"
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                transition={spring}
                style={{ background: goal.color || '#ec5b5b' }}
              />
            </div>
          </div>
        )}

        {/* Sub-steps checklist */}
        <div className="hab-goal-steps-box">
          <div className="hab-goal-steps-title-row">
            <span className="steps-title">Milestones &amp; Steps</span>
            {!addingStep && (
              <button className="btn subtle xs hab-goal-add-step-btn" onClick={() => setAddingStep(true)}>
                <Icon name="plus" size={12} /> Add Step
              </button>
            )}
          </div>

          <div className="hab-goal-steps-list">
            {steps.map((st) => (
              <div key={st.id} className={`hab-goal-step-item ${st.completed ? 'done' : ''}`}>
                <button
                  className={`hab-goal-step-check ${st.completed ? 'checked' : ''}`}
                  onClick={() => onToggleStep(st)}
                >
                  {st.completed && <Icon name="check" size={11} />}
                </button>
                <span className="hab-goal-step-label">{st.title}</span>
                <button
                  className="icon-btn hab-goal-step-del"
                  onClick={() => removeStep(st.id)}
                  title="Remove step"
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}

            {addingStep && (
              <div className="hab-goal-new-step-form">
                <input
                  ref={stepInputRef}
                  placeholder="Next milestone or action…"
                  value={stepInput}
                  onChange={(e) => setStepInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddStep();
                    if (e.key === 'Escape') setAddingStep(false);
                  }}
                />
                <button className="btn primary xs" onClick={handleAddStep} disabled={!stepInput.trim()}>
                  Add
                </button>
                <button className="btn subtle xs" onClick={() => setAddingStep(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function GoalEditorModal({
  goal,
  onClose,
  onSaved,
}: {
  goal: Goal | null;
  onClose: () => void;
  onSaved: (goal: Goal) => void;
}) {
  const [title, setTitle] = useState(goal?.title || '');
  const [description, setDescription] = useState(goal?.description || '');
  const [targetDate, setTargetDate] = useState<string | null>(goal?.targetDate || null);
  const [color, setColor] = useState(goal?.color || '#ec5b5b');
  const [icon, setIcon] = useState(goal?.icon || 'target');
  const [stepsDraft, setStepsDraft] = useState<string[]>([]);
  const [newStepText, setNewStepText] = useState('');
  const [saving, setSaving] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const addDraftStep = () => {
    if (!newStepText.trim()) return;
    setStepsDraft([...stepsDraft, newStepText.trim()]);
    setNewStepText('');
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);

    try {
      if (goal) {
        const updated = await api.goals.patch(goal.id, {
          title: title.trim(),
          description: description.trim(),
          targetDate,
          color,
          icon,
        });
        if (updated) {
          // If there were any draft steps added
          for (const s of stepsDraft) {
            await api.goals.stepAdd({ goalId: goal.id, title: s });
          }
          const final = await api.goals.get(goal.id);
          onSaved(final || updated);
        }
      } else {
        const created = await api.goals.create({
          title: title.trim(),
          description: description.trim(),
          targetDate,
          color,
          icon,
          steps: stepsDraft.map((st) => ({ title: st })),
        });
        onSaved(created);
      }
    } catch (err) {
      console.error('Failed to save goal:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="backdrop dim" onClick={onClose} />
      <div className="modal-layer">
        <motion.div
          className="modal hab-goal-modal"
          onClick={(e) => e.stopPropagation()}
          variants={dialogIn}
          initial="hidden"
          animate="shown"
          exit="gone"
        >
          <div className="hab-goal-modal-head">
            <div className="hab-goal-modal-title">
              <span className="goal-modal-badge" style={{ background: `${color}18`, color }}>
                <Icon name={icon} size={18} />
              </span>
              <h2>{goal ? 'Edit Goal' : 'Create New Goal'}</h2>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close" type="button">
              <Icon name="x" size={16} />
            </button>
          </div>

          <form onSubmit={handleSave} className="hab-goal-modal-form">
            <div className="form-group">
              <label>Goal Title</label>
              <input
                ref={titleRef}
                className="field"
                placeholder="e.g. Run a 10K, Learn Swift, Read 12 Books"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Motivation / Notes</label>
              <textarea
                className="field"
                rows={2}
                placeholder="Describe what achieving this looks like and why you want it…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>Target Date (Optional)</label>
              <DateField value={targetDate} onChange={(d) => setTargetDate(d)} />
            </div>

            <div className="form-row-2">
              <div className="form-group">
                <label>Color Accent</label>
                <div className="color-swatches">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`color-dot ${color === c ? 'selected' : ''}`}
                      style={{ background: c }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Icon</label>
                <div className="icon-swatches">
                  {PRESET_ICONS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      className={`icon-dot ${icon === ic ? 'selected' : ''}`}
                      onClick={() => setIcon(ic)}
                    >
                      <Icon name={ic} size={15} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Sub-steps in creation */}
            <div className="form-group">
              <label>Key Milestones / Steps (Optional)</label>
              <div className="hab-goal-modal-steps-draft">
                {stepsDraft.map((st, i) => (
                  <div key={i} className="draft-step-item">
                    <Icon name="check" size={13} className="step-icon" />
                    <span>{st}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setStepsDraft(stepsDraft.filter((_, idx) => idx !== i))}
                      aria-label="Remove step"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                ))}
                <div className="draft-step-add-row">
                  <input
                    type="text"
                    className="field"
                    placeholder="Add a milestone step…"
                    value={newStepText}
                    onChange={(e) => setNewStepText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addDraftStep();
                      }
                    }}
                  />
                  <button type="button" className="btn subtle" onClick={addDraftStep} disabled={!newStepText.trim()}>
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn subtle" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!title.trim() || saving}>
                {saving ? 'Saving…' : goal ? 'Update Goal' : 'Create Goal'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
}
