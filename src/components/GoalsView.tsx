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
  const { theme } = useApp();
  const { narrow } = useLayout();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [createAsNorthStar, setCreateAsNorthStar] = useState(false);
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
    const ok = await ask(`Delete goal "${g.title || 'Untitled'}"? Any steps attached will also be removed.`, {
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

  const currentNorthStar = useMemo(() => goals.find((g) => g.isNorthStar) || null, [goals]);

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

  const handleOpenAdd = (isNorthStar = false) => {
    setCreateAsNorthStar(isNorthStar);
    setShowAddModal(true);
  };

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
            {!currentNorthStar && (
              <button className="btn subtle" onClick={() => handleOpenAdd(true)}>
                <Icon name="compass" size={14} /> <span>Set North Star</span>
              </button>
            )}
            <button className="btn primary" onClick={() => handleOpenAdd(false)}>
              <Icon name="plus" size={14} /> <span>New Goal</span>
            </button>
            <SplitControls />
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
            <button className="btn primary" onClick={() => handleOpenAdd(false)}>
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
            defaultIsNorthStar={createAsNorthStar}
            existingNorthStarId={currentNorthStar?.id || null}
            onClose={() => {
              setShowAddModal(false);
              setEditingGoal(null);
              setCreateAsNorthStar(false);
            }}
            onSaved={() => {
              loadGoals();
              setShowAddModal(false);
              setEditingGoal(null);
              setCreateAsNorthStar(false);
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
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [editingStepTitle, setEditingStepTitle] = useState('');
  const stepEditInputRef = useRef<HTMLInputElement>(null);

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

  const handleCommitStepEdit = async (stepId: string) => {
    const trimmed = editingStepTitle.trim();
    setEditingStepId(null);
    if (!trimmed) return;
    try {
      await api.goals.stepUpdate({ id: stepId, title: trimmed });
      onReload();
    } catch {
      try {
        const target = steps.find((s) => s.id === stepId);
        await api.goals.stepDelete(stepId);
        const added = await api.goals.stepAdd({ goalId: goal.id, title: trimmed });
        if (target?.completed && added?.id) {
          await api.goals.stepToggle({ id: added.id, completed: true });
        }
        onReload();
      } catch (err) {
        console.error('Failed to update step:', err);
      }
    }
  };

  useEffect(() => {
    if (addingStep) stepInputRef.current?.focus();
  }, [addingStep]);

  useEffect(() => {
    if (editingStepId) {
      stepEditInputRef.current?.focus();
      stepEditInputRef.current?.select();
    }
  }, [editingStepId]);

  return (
    <motion.div
      className={`hab-goal-card ${goal.isNorthStar ? 'is-north-star' : ''} ${goal.completed ? 'completed' : ''}`}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      style={{ '--goal-accent': goal.color || '#ec5b5b' } as React.CSSProperties}
    >
      <div className="hab-goal-card-top">
        <div className="hab-goal-icon-badge" style={{ background: `${goal.color || '#ec5b5b'}1c`, color: goal.color || '#ec5b5b' }}>
          <Icon name={goal.icon || (goal.isNorthStar ? 'compass' : 'target')} size={18} />
        </div>
        <div className="hab-goal-top-meta">
          {goal.isNorthStar && (
            <span className="hab-north-star-pill">
              <span className="pill-star">✦</span> North Star
            </span>
          )}
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
                  type="button"
                  className={`hab-goal-step-check ${st.completed ? 'checked' : ''}`}
                  onClick={() => onToggleStep(st)}
                >
                  {st.completed && <Icon name="check" size={11} />}
                </button>
                {editingStepId === st.id ? (
                  <input
                    ref={stepEditInputRef}
                    className="field hab-goal-step-inline-edit"
                    value={editingStepTitle}
                    onChange={(e) => setEditingStepTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCommitStepEdit(st.id);
                      } else if (e.key === 'Escape') {
                        setEditingStepId(null);
                      }
                    }}
                    onBlur={() => handleCommitStepEdit(st.id)}
                  />
                ) : (
                  <span
                    className="hab-goal-step-label"
                    title="Click to rename step"
                    onClick={() => {
                      setEditingStepId(st.id);
                      setEditingStepTitle(st.title);
                    }}
                  >
                    {st.title}
                  </span>
                )}
                <button
                  type="button"
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

interface ModalStepItem {
  id?: string;
  title: string;
  completed?: boolean;
}

function GoalEditorModal({
  goal,
  defaultIsNorthStar = false,
  existingNorthStarId = null,
  onClose,
  onSaved,
}: {
  goal: Goal | null;
  defaultIsNorthStar?: boolean;
  existingNorthStarId?: string | null;
  onClose: () => void;
  onSaved: (goal: Goal) => void;
}) {
  const [title, setTitle] = useState(goal?.title || '');
  const [description, setDescription] = useState(goal?.description || '');
  const [targetDate, setTargetDate] = useState<string | null>(goal?.targetDate || null);
  const [isNorthStar, setIsNorthStar] = useState<boolean>(
    goal ? !!goal.isNorthStar : defaultIsNorthStar
  );
  const [color, setColor] = useState(goal?.color || '#ec5b5b');
  const [icon, setIcon] = useState(
    goal?.icon || (defaultIsNorthStar ? 'compass' : 'target')
  );
  const [stepsList, setStepsList] = useState<ModalStepItem[]>(() => {
    if (goal?.steps && Array.isArray(goal.steps)) {
      return goal.steps.map((st) => ({
        id: st.id,
        title: st.title,
        completed: st.completed,
      }));
    }
    return [];
  });
  const [deletedStepIds, setDeletedStepIds] = useState<string[]>([]);
  const [newStepText, setNewStepText] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleUpdateStepTitle = (index: number, val: string) => {
    setStepsList((prev) =>
      prev.map((s, i) => (i === index ? { ...s, title: val } : s))
    );
  };

  const handleRemoveStep = (index: number) => {
    const item = stepsList[index];
    if (item?.id) {
      setDeletedStepIds((prev) => [...prev, item.id!]);
    }
    setStepsList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddStepItem = () => {
    const trimmed = newStepText.trim();
    if (!trimmed) return;
    setStepsList((prev) => [...prev, { title: trimmed, completed: false }]);
    setNewStepText('');
  };

  const hasOtherNorthStar = !!existingNorthStarId && (!goal || goal.id !== existingNorthStarId);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    setErrorMsg(null);

    try {
      const pendingSteps = [...stepsList];
      if (newStepText.trim()) {
        pendingSteps.push({ title: newStepText.trim(), completed: false });
      }

      const finalIsNorthStar = hasOtherNorthStar ? false : isNorthStar;

      if (goal) {
        const updated = await api.goals.patch(goal.id, {
          title: title.trim(),
          description: description.trim(),
          targetDate,
          color,
          icon,
          isNorthStar: finalIsNorthStar,
        });

        // 1. Delete removed steps
        for (const sId of deletedStepIds) {
          try {
            await api.goals.stepDelete(sId);
          } catch (delErr) {
            console.error('Failed to delete step:', delErr);
          }
        }

        // 2. Update existing or add new steps
        for (const st of pendingSteps) {
          const trimmedTitle = st.title.trim();
          if (!trimmedTitle) continue;
          if (st.id) {
            const original = goal.steps?.find((o) => o.id === st.id);
            if (original && original.title !== trimmedTitle) {
              try {
                await api.goals.stepUpdate({ id: st.id, title: trimmedTitle });
              } catch {
                try {
                  await api.goals.stepDelete(st.id);
                  const added = await api.goals.stepAdd({ goalId: goal.id, title: trimmedTitle });
                  if (st.completed && added?.id) {
                    await api.goals.stepToggle({ id: added.id, completed: true });
                  }
                } catch (stepFallbackErr) {
                  console.error('Failed to update step via fallback:', stepFallbackErr);
                }
              }
            }
          } else {
            try {
              await api.goals.stepAdd({ goalId: goal.id, title: trimmedTitle });
            } catch (addErr) {
              console.error('Failed to add step:', addErr);
            }
          }
        }

        const final = await api.goals.get(goal.id);
        onSaved(final || updated || goal);
      } else {
        const created = await api.goals.create({
          title: title.trim(),
          description: description.trim(),
          targetDate,
          color,
          icon,
          isNorthStar: finalIsNorthStar,
          steps: pendingSteps
            .filter((st) => st.title.trim())
            .map((st) => ({ title: st.title.trim() })),
        });
        onSaved(created);
      }
    } catch (err: any) {
      console.error('Failed to save goal:', err);
      setErrorMsg(err?.message || 'Failed to save goal. Please check all fields.');
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
              <h2>
                {goal
                  ? (isNorthStar ? 'Edit North Star' : 'Edit Goal')
                  : (isNorthStar && !hasOtherNorthStar ? 'Set North Star Goal' : 'Create New Goal')}
              </h2>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close" type="button">
              <Icon name="x" size={16} />
            </button>
          </div>

          <form onSubmit={handleSave} noValidate className="hab-goal-modal-form">
            {/* North Star Toggle - completely removed if another North Star exists */}
            {!hasOtherNorthStar && (
              <div className={`hab-north-star-toggle-card ${isNorthStar ? 'active' : ''}`}>
                <div className="toggle-info">
                  <div className="toggle-title-row">
                    <span className="toggle-star">✦</span>
                    <strong>North Star Goal</strong>
                  </div>
                  <p>The single biggest overarching goal of all.</p>
                </div>
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={isNorthStar}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setIsNorthStar(checked);
                      if (checked && (!goal || !goal.isNorthStar)) {
                        setIcon('compass');
                      }
                    }}
                  />
                  <span className="switch-slider" />
                </label>
              </div>
            )}

            <div className="form-group">
              <label>{isNorthStar && !hasOtherNorthStar ? 'North Star Title' : 'Goal Title'}</label>
              <input
                ref={titleRef}
                className="field"
                placeholder={
                  isNorthStar && !hasOtherNorthStar
                    ? 'e.g. Become Financially Independent, Launch My Studio'
                    : 'e.g. Run a 10K, Learn Swift, Read 12 Books'
                }
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Motivation &amp; Notes</label>
              <textarea
                className="field hab-goal-textarea"
                rows={4}
                placeholder="Describe what achieving this looks like, why it matters, key context, or notes…"
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

            {/* Milestones / Steps - view, edit, add, delete */}
            <div className="form-group">
              <div className="hab-goal-modal-steps-head">
                <label>Key Milestones &amp; Steps (Optional)</label>
                {stepsList.length > 0 && (
                  <span className="hab-goal-modal-steps-count">
                    {stepsList.length} {stepsList.length === 1 ? 'step' : 'steps'}
                  </span>
                )}
              </div>

              <div className="hab-goal-modal-steps-list">
                {stepsList.map((st, i) => (
                  <div key={st.id || `step-${i}`} className="modal-step-row">
                    <span className="step-num">{i + 1}</span>
                    <input
                      type="text"
                      className="field modal-step-input"
                      value={st.title}
                      placeholder={`Step ${i + 1}…`}
                      onChange={(e) => handleUpdateStepTitle(i, e.target.value)}
                    />
                    <button
                      type="button"
                      className="icon-btn modal-step-del-btn"
                      onClick={() => handleRemoveStep(i)}
                      title="Remove step"
                      aria-label="Remove step"
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                ))}

                <div className="draft-step-add-row">
                  <input
                    type="text"
                    className="field"
                    placeholder="Add a milestone or next step…"
                    value={newStepText}
                    onChange={(e) => setNewStepText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddStepItem();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn subtle"
                    onClick={handleAddStepItem}
                    disabled={!newStepText.trim()}
                  >
                    <Icon name="plus" size={12} /> Add
                  </button>
                </div>
              </div>
            </div>

            {errorMsg && <div className="hab-goal-modal-error">{errorMsg}</div>}

            <div className="modal-actions">
              <button type="button" className="btn subtle" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                onClick={handleSave}
                disabled={!title.trim() || saving}
              >
                {saving ? 'Saving…' : goal ? 'Update Goal' : 'Create Goal'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </>
  );
}
