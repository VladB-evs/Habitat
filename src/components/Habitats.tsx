import { useState } from 'react';
import { api } from '../api';
import { Icon } from './Icons';

export const FLAVORS = [
  { id: 'personal', name: 'Personal', icon: 'heart', blurb: 'Journaling, habits, books — a second brain for life.' },
  { id: 'work', name: 'Work', icon: 'briefcase', blurb: 'Meetings, projects, 1:1s — everything work in one place.' },
  { id: 'school', name: 'School', icon: 'book', blurb: 'Lectures, assignments, essays — organized by course.' },
  { id: 'creative', name: 'Creative', icon: 'bulb', blurb: 'Ideas, references, projects — from spark to shipped.' },
  { id: 'blank', name: 'From scratch', icon: 'box', blurb: 'Completely empty — no types, no templates. Build your own system.' },
];

export function FlavorCards({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="flavor-grid">
      {FLAVORS.map((f) => (
        <button key={f.id} className={'flavor-card' + (selected === f.id ? ' sel' : '')} onClick={() => onSelect(f.id)}>
          <span className="flavor-icon">
            <Icon name={f.icon} size={19} />
          </span>
          <span className="flavor-name">{f.name}</span>
          <span className="flavor-blurb">{f.blurb}</span>
        </button>
      ))}
    </div>
  );
}

interface PersonDraft {
  name: string;
  nickname: string;
}

function suggestedHabitatName(flavor: string): string {
  if (flavor === 'blank') return 'My Habitat';
  const meta = FLAVORS.find((f) => f.id === flavor);
  return `${meta?.name ?? 'My'} Habitat`;
}

/** Full-screen first-run flow: name & purpose the habitat, then say who you are and who you'll mention often. */
export function Onboarding() {
  const [step, setStep] = useState<1 | 2>(1);
  const [flavor, setFlavor] = useState('personal');
  const [habitatName, setHabitatName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [userName, setUserName] = useState('');
  const [people, setPeople] = useState<PersonDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const trimmedHabitatName = habitatName.trim();

  const [openError, setOpenError] = useState('');

  /** Points Habitat at a vault that already exists instead of making a new one. */
  const openExisting = async () => {
    setOpenError('');
    setBusy(true);
    try {
      const res = await api.habitats.open();
      if (!res) return;
      if ('error' in res) {
        setOpenError("That folder has no .db file in it. Pick the folder that holds the habitat's database.");
        return;
      }
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  const addPerson = () => setPeople((list) => [...list, { name: '', nickname: '' }]);
  const updatePerson = (i: number, patch: Partial<PersonDraft>) =>
    setPeople((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const removePerson = (i: number) => setPeople((list) => list.filter((_, j) => j !== i));

  const finish = async () => {
    if (busy) return;
    // Ask which folder this habitat's own same-named folder should live inside.
    const dir = await api.habitats.pickFolder();
    if (!dir) return;
    setBusy(true);
    await api.habitats.onboard({
      name: trimmedHabitatName,
      flavor,
      dir,
      userName: userName.trim(),
      people: people.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), nickname: p.nickname.trim() })),
    });
    window.location.reload();
  };

  return (
    <div className="onboard">
      <div className="onboard-inner">
        <div className="onboard-logo">
          <Icon name="sprout" size={30} />
        </div>

        {step === 1 && (
          <>
            <h1>Welcome to Habitat</h1>
            <p className="onboard-sub">
              Your object-based second brain. Name this habitat and what it's for — each option starts you off with
              fitting templates, and you can change everything later.
            </p>
            <input
              className={'field onboard-name' + (nameTouched && !trimmedHabitatName ? ' invalid' : '')}
              placeholder={`Name your habitat… e.g. ${suggestedHabitatName(flavor)}`}
              value={habitatName}
              autoFocus
              onChange={(e) => setHabitatName(e.target.value)}
              onBlur={() => setNameTouched(true)}
            />
            {nameTouched && !trimmedHabitatName && <div className="field-error onboard-name-error">Give this habitat a name to continue.</div>}
            <FlavorCards selected={flavor} onSelect={setFlavor} />
            <button
              className="btn primary onboard-go"
              disabled={!trimmedHabitatName}
              onClick={() => (trimmedHabitatName ? setStep(2) : setNameTouched(true))}
            >
              Continue
            </button>

            {/* Already have a habitat — from another machine, a backup, or a sync folder. */}
            <button className="link-btn onboard-open" disabled={busy} onClick={openExisting}>
              I already have a habitat — open its folder
            </button>
            {openError && <div className="field-error">{openError}</div>}
          </>
        )}

        {step === 2 && (
          <>
            <h1>What should we call you?</h1>
            <p className="onboard-sub">
              Personalizes your dashboard, and adds you to Person so you can @-mention yourself anywhere.
            </p>
            <input
              className="field onboard-name"
              placeholder="Your name…"
              value={userName}
              autoFocus
              onChange={(e) => setUserName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (people.length ? addPerson() : finish())}
            />

            <div className="onboard-people">
              <div className="onboard-people-head">
                <span>People you'll mention often</span>
                <button className="btn subtle small" onClick={addPerson}>
                  <Icon name="plus" size={12} /> Add person
                </button>
              </div>
              {people.length === 0 && <div className="onboard-people-empty">Optional — add teammates, family, friends. You can add more later.</div>}
              {people.map((p, i) => (
                <div className="onboard-people-row" key={i}>
                  <input
                    className="field"
                    placeholder="Name"
                    value={p.name}
                    onChange={(e) => updatePerson(i, { name: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Nickname (optional)"
                    value={p.nickname}
                    onChange={(e) => updatePerson(i, { nickname: e.target.value })}
                  />
                  <button className="icon-btn" onClick={() => removePerson(i)} aria-label="Remove">
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>

            <p className="onboard-folder-hint">Next you'll pick the folder where this habitat's data lives.</p>

            <div className="onboard-actions">
              <button className="btn subtle" disabled={busy} onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn primary onboard-go" disabled={busy} onClick={finish}>
                {busy ? 'Setting up…' : 'Choose folder & enter'}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

/** Modal for creating an additional habitat. */
export function NewHabitatModal({ onClose }: { onClose: () => void }) {
  const [flavor, setFlavor] = useState('personal');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  const create = async () => {
    if (busy) return;
    if (!trimmed) {
      setTouched(true);
      return;
    }
    // Ask where this habitat's own same-named folder should live.
    const dir = await api.habitats.pickFolder();
    if (!dir) return;
    setBusy(true);
    const res = await api.habitats.create({ name: trimmed, flavor, dir });
    if ('error' in res) {
      setBusy(false);
      setTouched(true);
      return;
    }
    window.location.reload();
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings">
        <div className="settings-head">
          <h2>New habitat</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="settings-body">
        <div className="settings-row col">
          <div className="s-hint">
            A habitat is a fully separate database — its own objects, types, templates, and graph. It gets its own
            folder, named after it, wherever you choose to keep it.
          </div>
          <input
            className={'field' + (touched && !trimmed ? ' invalid' : '')}
            placeholder="Habitat name… (required)"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          {touched && !trimmed && <div className="field-error">Give this habitat a name to continue.</div>}
          <FlavorCards selected={flavor} onSelect={setFlavor} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn subtle" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !trimmed} onClick={create}>
              {busy ? 'Creating…' : 'Choose folder & create'}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
