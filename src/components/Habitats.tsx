import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../api';
import { Icon, ICON_CHOICES, TypeIcon } from './Icons';
import { isStandalone } from '../vault/client';

/** Legacy preset metadata kept for backwards compatibility. */
export const FLAVORS = [
  { id: 'personal', name: 'Standard', icon: 'sprout', blurb: 'Notes, tasks, people, and habits.' },
];

export const AURAS = [
  { id: 'amber', name: 'Amber Sol', color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.45)', bg: 'rgba(245, 158, 11, 0.12)', onAccent: '#221a04' },
  { id: 'emerald', name: 'Emerald Grove', color: '#10b981', glow: 'rgba(16, 185, 129, 0.45)', bg: 'rgba(16, 185, 129, 0.12)', onAccent: '#ffffff' },
  { id: 'violet', name: 'Cosmic Violet', color: '#a855f7', glow: 'rgba(168, 85, 247, 0.45)', bg: 'rgba(168, 85, 247, 0.12)', onAccent: '#ffffff' },
  { id: 'cyan', name: 'Glacier Cyan', color: '#06b6d4', glow: 'rgba(6, 182, 212, 0.45)', bg: 'rgba(6, 182, 212, 0.12)', onAccent: '#062026' },
  { id: 'rose', name: 'Solar Rose', color: '#f43f5e', glow: 'rgba(244, 63, 94, 0.45)', bg: 'rgba(244, 63, 94, 0.12)', onAccent: '#ffffff' },
];

export function getAuraColor(auraIdOrHex?: string): string {
  if (!auraIdOrHex) return '#f59e0b';
  if (auraIdOrHex.startsWith('#')) return auraIdOrHex;
  if (/^[0-9A-Fa-f]{6}$/.test(auraIdOrHex)) return '#' + auraIdOrHex;
  const match = AURAS.find((a) => a.id === auraIdOrHex);
  return match ? match.color : '#f59e0b';
}

export function getAuraGlow(auraIdOrHex?: string): string {
  if (!auraIdOrHex) return 'rgba(245, 158, 11, 0.45)';
  const match = AURAS.find((a) => a.id === auraIdOrHex);
  if (match) return match.glow;
  if (auraIdOrHex.startsWith('#')) {
    return hexToRgba(auraIdOrHex, 0.45);
  }
  return 'rgba(245, 158, 11, 0.45)';
}

export function getAuraBg(auraIdOrHex?: string): string {
  if (!auraIdOrHex) return 'rgba(245, 158, 11, 0.12)';
  const match = AURAS.find((a) => a.id === auraIdOrHex);
  if (match) return match.bg;
  if (auraIdOrHex.startsWith('#')) {
    return hexToRgba(auraIdOrHex, 0.12);
  }
  return 'rgba(245, 158, 11, 0.12)';
}

export function getOnAccent(auraIdOrHex?: string): string {
  if (!auraIdOrHex) return '#221a04';
  const match = AURAS.find((a) => a.id === auraIdOrHex || a.color.toLowerCase() === auraIdOrHex.toLowerCase());
  if (match?.onAccent) return match.onAccent;

  const hex = auraIdOrHex.startsWith('#') ? auraIdOrHex : getAuraColor(auraIdOrHex);
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return '#221a04';
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  const toLinear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L >= 0.38 ? '#151514' : '#ffffff';
}

export function applyHabitatAccent(auraIdOrHex?: string): void {
  if (typeof document === 'undefined') return;
  const color = getAuraColor(auraIdOrHex);
  const glow = getAuraGlow(auraIdOrHex);
  const bg = getAuraBg(auraIdOrHex);
  const onAccent = getOnAccent(auraIdOrHex);

  const root = document.documentElement;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--on-accent', onAccent);
  root.style.setProperty('--hab-aura', color);
  root.style.setProperty('--hab-aura-glow', glow);
  root.style.setProperty('--hab-aura-bg', bg);
  root.style.setProperty('--mention-fg', color);
}

// Automatically apply cached aura on module initialization
try {
  const cachedAura = typeof localStorage !== 'undefined' ? localStorage.getItem('habitat:aura') : null;
  if (cachedAura) {
    applyHabitatAccent(cachedAura);
  }
} catch {}

function hexToRgba(hex: string, alpha: number): string {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(245, 158, 11, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const ICONS = [
  { id: 'sprout', label: 'Sprout' },
  { id: 'sparkles', label: 'Spark' },
  { id: 'globe', label: 'World' },
  { id: 'book', label: 'Library' },
  { id: 'zap', label: 'Energy' },
  { id: 'star', label: 'Cosmos' },
];

export const SUGGESTIONS = [
  'Personal Brain',
  'Creative Studio',
  'Knowledge Vault',
  'Life OS',
  'Research Lab',
];

/** Interactive Canvas Background: living constellation network with warp speed climax. */
function HabitatCosmosCanvas({ auraColor, isWarping }: { auraColor: string; isWarping: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef(auraColor);
  colorRef.current = auraColor;
  const warpingRef = useRef(isWarping);
  warpingRef.current = isWarping;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    // Living node particles
    const count = Math.min(50, Math.floor((width * height) / 24000));
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: 1.4 + Math.random() * 2,
      baseAlpha: 0.2 + Math.random() * 0.5,
      pulse: Math.random() * Math.PI * 2,
    }));

    let mouseX = width / 2;
    let mouseY = height / 2;
    let mouseActive = false;

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      mouseActive = true;
    };
    window.addEventListener('mousemove', onMouseMove);

    const render = () => {
      ctx.clearRect(0, 0, width, height);
      const hex = colorRef.current;
      const warping = warpingRef.current;
      const cx = width / 2;
      const cy = height / 2;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        if (warping) {
          // Hyperspace rush into center
          const dx = cx - p.x;
          const dy = cy - p.y;
          p.x += dx * 0.12;
          p.y += dy * 0.12;
          p.radius = Math.min(p.radius * 1.05, 8);
        } else {
          p.x += p.vx;
          p.y += p.vy;

          if (p.x < 0) p.x = width;
          if (p.x > width) p.x = 0;
          if (p.y < 0) p.y = height;
          if (p.y > height) p.y = 0;

          // Gentle mouse repulsion
          if (mouseActive) {
            const dx = p.x - mouseX;
            const dy = p.y - mouseY;
            const dist = Math.hypot(dx, dy);
            if (dist < 130 && dist > 0) {
              const force = (130 - dist) / 130;
              p.x += (dx / dist) * force * 1.8;
              p.y += (dy / dist) * force * 1.8;
            }
          }
        }

        p.pulse += 0.025;
        const alpha = p.baseAlpha * (0.65 + 0.35 * Math.sin(p.pulse));

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = hex;
        ctx.globalAlpha = alpha;
        ctx.fill();

        // Connect nearby nodes
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 125) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = hex;
            ctx.globalAlpha = (1 - dist / 125) * 0.18;
            ctx.lineWidth = 0.85;
            ctx.stroke();
          }
        }
      }

      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="habitat-cosmos-canvas" />;
}

interface CreateHabitatScreenProps {
  onClose?: () => void;
  isFirstRun?: boolean;
}

interface AuraOption {
  id: string;
  name: string;
  color: string;
  glow: string;
  bg: string;
}

/** Icon selector: renders suggested totem chips and a "More..." button at the end. */
export function HabitatIconPicker({
  value,
  onPick,
  align = 'left',
}: {
  value: string;
  onPick: (icon: string) => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const query = search.trim().toLowerCase().replace(/\s+/g, '-');
  const filtered = ICON_CHOICES.filter((ic) => ic.includes(query));
  const isCustomIcon = !ICONS.some((ic) => ic.id === value);

  return (
    <div className="habitat-custom-row" ref={popRef}>
      <span className="habitat-custom-label">Totem</span>
      <div className="habitat-icon-grid">
        {ICONS.map((ic) => {
          const isSel = value === ic.id;
          return (
            <button
              key={ic.id}
              type="button"
              className={`habitat-icon-choice ${isSel ? 'active' : ''}`}
              onClick={() => {
                onPick(ic.id);
                setOpen(false);
              }}
              title={ic.label}
            >
              <Icon name={ic.id} size={17} />
            </button>
          );
        })}

        {/* If an icon from "More" is chosen that isn't in default suggestions, show it active */}
        {isCustomIcon && (
          <button
            type="button"
            className="habitat-icon-choice active"
            title={value.replace(/-/g, ' ')}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={value} size={17} />
          </button>
        )}

        {/* More button at the end of the totem list */}
        <button
          type="button"
          className={`habitat-more-btn ${open ? 'open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          title="More icons…"
          aria-label="More icons"
        >
          <Icon name="more-horizontal" size={15} />
        </button>
      </div>

      {open && (
        <div className={`habitat-popover-menu habitat-icon-popover-panel align-${align}`}>
          <input
            type="text"
            className="habitat-popover-search"
            placeholder="Search all icons…"
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="habitat-icon-dropdown-grid">
            {filtered.map((ic) => (
              <button
                key={ic}
                type="button"
                className={`habitat-icon-dropdown-btn ${ic === value ? 'active' : ''}`}
                onClick={() => {
                  onPick(ic);
                  setOpen(false);
                }}
                title={ic.replace(/-/g, ' ')}
              >
                <Icon name={ic} size={16} />
              </button>
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: '1 / -1', padding: '12px 6px', fontSize: '12px', color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>
                No icons found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Aura selector: renders suggested aura gems and a "More..." color picker button at the end. */
export function HabitatAuraPicker({
  value,
  onPick,
  align = 'right',
}: {
  value: string; // aura id or hex code
  onPick: (aura: string) => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [customHex, setCustomHex] = useState(value.startsWith('#') ? value : '#f59e0b');
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const isPreset = AURAS.some((a) => a.id === value);
  const isCustomAura = value.startsWith('#');

  const handleCustomChange = (hex: string) => {
    setCustomHex(hex);
    onPick(hex);
  };

  return (
    <div className="habitat-custom-row" ref={popRef}>
      <span className="habitat-custom-label">Aura</span>
      <div className="habitat-aura-grid">
        {AURAS.map((a) => {
          const isSel = value === a.id;
          return (
            <button
              key={a.id}
              type="button"
              className={`habitat-aura-gem ${isSel ? 'active' : ''}`}
              style={{ backgroundColor: a.color }}
              onClick={() => {
                onPick(a.id);
                setOpen(false);
              }}
              title={a.name}
              aria-label={a.name}
            >
              {isSel && <span className="habitat-aura-indicator" />}
            </button>
          );
        })}

        {/* If a custom color was chosen, show its gemstone */}
        {isCustomAura && (
          <button
            type="button"
            className="habitat-aura-gem active"
            style={{ backgroundColor: value }}
            title={`Custom ${value}`}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="habitat-aura-indicator" />
          </button>
        )}

        {/* More button at the end of the aura gemstones: opens custom color picker popover */}
        <button
          type="button"
          className={`habitat-aura-more-gem ${open ? 'open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          title="Custom color…"
          aria-label="Custom color"
        >
          <Icon name="palette" size={11} />
        </button>
      </div>

      {open && (
        <div className={`habitat-popover-menu habitat-aura-popover-panel align-${align}`}>
          <div className="habitat-custom-color-row">
            <label className="habitat-custom-swatch-btn" style={{ backgroundColor: customHex }} title="Click to pick color">
              <input
                type="color"
                className="habitat-custom-color-input"
                value={customHex}
                onChange={(e) => handleCustomChange(e.target.value)}
              />
            </label>
            <input
              type="text"
              className="habitat-custom-hex-input"
              value={customHex}
              maxLength={7}
              placeholder="#f59e0b"
              onChange={(e) => {
                const v = e.target.value;
                setCustomHex(v);
                if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                  onPick(v);
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function CreateHabitatScreen({ onClose, isFirstRun = false }: CreateHabitatScreenProps) {
  const standalone = isStandalone();
  const [flowMode, setFlowMode] = useState<'sync' | 'create'>(standalone && isFirstRun ? 'sync' : 'create');

  // Mobile LAN Sync State
  const [macUrl, setMacUrl] = useState('');
  const [macToken, setMacToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  // Habitat Creation State
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [dir, setDir] = useState<string | null>(null);
  const [auraValue, setAuraValue] = useState<string>(AURAS[0].id);
  const [selectedIcon, setSelectedIcon] = useState<string>(ICONS[0].id);
  const [userName, setUserName] = useState('');
  const [showPersonalize, setShowPersonalize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isWarping, setIsWarping] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [openError, setOpenError] = useState('');

  // 3D Card mouse tilt
  const [rotateX, setRotateX] = useState(0);
  const [rotateY, setRotateY] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const trimmed = name.trim();

  useEffect(() => {
    inputRef.current?.focus();
    if (standalone) {
      api.sync.getLanConfig().then((cfg) => {
        if (cfg?.baseUrl) setMacUrl(cfg.baseUrl);
        if (cfg?.token) setMacToken(cfg.token);
      }).catch(() => {});
    }
  }, [standalone]);

  // Keyboard navigation: Escape key closes modal
  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !syncing && !isWarping) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, busy, syncing, isWarping]);

  const handleCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current || busy || syncing || isWarping) return;
    if (typeof window !== 'undefined' && (window.innerWidth <= 640 || window.matchMedia('(pointer: coarse)').matches)) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setRotateX(-y * 0.018);
    setRotateY(x * 0.018);
  };

  const handleCardMouseLeave = () => {
    setRotateX(0);
    setRotateY(0);
  };

  const handlePickFolder = async () => {
    if (busy || isWarping) return;
    try {
      const picked = await api.habitats.pickFolder();
      if (picked) {
        setDir(picked);
      }
    } catch {
      // ignore
    }
  };

  const handleSyncClone = async () => {
    if (syncing || busy || isWarping) return;
    const rawUrl = macUrl.trim();
    if (!rawUrl) {
      setSyncError('Please enter your Mac LAN address (e.g. http://192.168.1.50:37373)');
      return;
    }

    let url = rawUrl;
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }
    url = url.replace(/\/+$/, '');

    setSyncing(true);
    setSyncError('');

    try {
      const res = await api.sync.cloneFromMac({ baseUrl: url, token: macToken.trim() });
      if (res?.cloned) {
        setIsWarping(true);
        setSuccess(true);
        try {
          localStorage.setItem('habitat:onboarded', 'true');
        } catch {}
        setTimeout(() => {
          if (standalone) {
            if (isFirstRun) {
              window.dispatchEvent(new CustomEvent('habitat:onboarded'));
            } else {
              onClose?.();
            }
          } else {
            window.location.reload();
          }
        }, 750);
      } else {
        setSyncError('Failed to clone vault. Check address and token.');
        setSyncing(false);
      }
    } catch (err: any) {
      console.error('[sync clone error]', err);
      setSyncError(
        err?.message ||
          'Could not connect to Mac. Make sure Habitat is running on your Mac, Local API / Sync is enabled in Settings, and both devices are on the same Wi-Fi.'
      );
      setSyncing(false);
    }
  };

  const handleCreate = async () => {
    if (busy || isWarping) return;
    if (!trimmed) {
      setTouched(true);
      inputRef.current?.focus();
      return;
    }

    let targetDir = dir;
    if (!standalone && !targetDir) {
      targetDir = await api.habitats.pickFolder();
      if (!targetDir) return;
      setDir(targetDir);
    }

    setBusy(true);
    setErrorMsg('');

    try {
      if (isFirstRun) {
        await api.habitats.onboard({
          name: trimmed,
          flavor: 'personal',
          userName: userName.trim(),
          ...(targetDir ? { dir: targetDir } : {}),
          icon: selectedIcon,
          aura: auraValue,
        });
      } else {
        const res = await api.habitats.create({
          name: trimmed,
          flavor: 'personal',
          ...(targetDir ? { dir: targetDir } : {}),
          icon: selectedIcon,
          aura: auraValue,
        });
        if ('error' in res) {
          setErrorMsg(res.error === 'name-required' ? 'Habitat name is required.' : 'Could not create habitat.');
          setBusy(false);
          return;
        }
      }

      applyHabitatAccent(auraValue);
      try {
        localStorage.setItem('habitat:aura', auraValue);
        localStorage.setItem('habitat:onboarded', 'true');
      } catch {}

      // Trigger exhilarating launch sequence!
      setIsWarping(true);
      setSuccess(true);
      setTimeout(() => {
        if (standalone) {
          if (isFirstRun) {
            window.dispatchEvent(new CustomEvent('habitat:onboarded'));
          } else {
            onClose?.();
          }
        } else {
          window.location.reload();
        }
      }, 750);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Something went wrong creating the habitat.');
      setBusy(false);
    }
  };

  const handleOpenExisting = async () => {
    if (busy || isWarping) return;
    setOpenError('');
    setBusy(true);
    try {
      const res = await api.habitats.open();
      if (!res) {
        setBusy(false);
        return;
      }
      if ('error' in res) {
        setOpenError("That folder has no .db file in it. Pick the folder that holds the habitat's database.");
        setBusy(false);
        return;
      }
      setIsWarping(true);
      setSuccess(true);
      try {
        localStorage.setItem('habitat:onboarded', 'true');
      } catch {}
      setTimeout(() => {
        if (standalone) {
          if (isFirstRun) {
            window.dispatchEvent(new CustomEvent('habitat:onboarded'));
          } else {
            onClose?.();
          }
        } else {
          window.location.reload();
        }
      }, 450);
    } catch (err: any) {
      setOpenError(err?.message || 'Could not open habitat.');
      setBusy(false);
    }
  };

  const currentAuraColor = getAuraColor(auraValue);
  const currentAuraGlow = getAuraGlow(auraValue);
  const currentAuraBg = getAuraBg(auraValue);

  const auraStyles = useMemo(
    () =>
      ({
        '--hab-aura': currentAuraColor,
        '--hab-aura-glow': currentAuraGlow,
        '--hab-aura-bg': currentAuraBg,
      } as React.CSSProperties),
    [currentAuraColor, currentAuraGlow, currentAuraBg]
  );

  return (
    <div className="habitat-stage" style={auraStyles}>
      {/* Living Constellation Particle Canvas */}
      <HabitatCosmosCanvas auraColor={currentAuraColor} isWarping={isWarping} />

      {/* Radiant Ambient Nebula Orbs */}
      <div className="habitat-stage-ambient" />
      <div className="habitat-stage-ambient-secondary" />

      {/* Full-screen Shockwave Bloom on Creation */}
      <AnimatePresence>
        {isWarping && (
          <motion.div
            className="habitat-warp-bloom"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 2.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.65, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {/* Close button for modal mode */}
      {onClose && (
        <motion.button
          type="button"
          className="habitat-dismiss-btn"
          onClick={onClose}
          disabled={busy || isWarping}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          aria-label="Close"
        >
          <span>ESC</span>
          <Icon name="x" size={14} />
        </motion.button>
      )}

      {/* Main Glass Stage Container */}
      <motion.div
        ref={cardRef}
        className="habitat-stage-card"
        onMouseMove={handleCardMouseMove}
        onMouseLeave={handleCardMouseLeave}
        style={
          rotateX !== 0 || rotateY !== 0
            ? { transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)` }
            : undefined
        }
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={
          isWarping
            ? { opacity: 0, scale: 1.08, y: -20, filter: 'blur(10px)' }
            : { opacity: 1, scale: 1, y: 0, filter: 'none' }
        }
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      >
        {/* Top Habitat Core Emblem */}
        <div className="habitat-core-anchor">
          <div className="habitat-core-ring-pulse" />
          <motion.div
            className="habitat-core-glass"
            animate={
              success
                ? { scale: [1, 1.25, 1.12], rotate: [0, 15, 0] }
                : { y: [0, -6, 0] }
            }
            transition={
              success
                ? { duration: 0.5, ease: 'easeOut' }
                : { y: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } }
            }
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={flowMode === 'sync' ? 'sync-icon' : selectedIcon}
                initial={{ scale: 0.4, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.4, opacity: 0, rotate: 20 }}
                transition={{ type: 'spring', stiffness: 450, damping: 26 }}
              >
                <Icon
                  name={
                    success
                      ? 'check'
                      : flowMode === 'sync'
                        ? syncing
                          ? 'refresh-cw'
                          : 'laptop'
                        : selectedIcon
                  }
                  size={36}
                />
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Dynamic Title / Live Preview */}
        <h1 className="habitat-stage-title">
          {flowMode === 'sync'
            ? 'Sync with Your Mac'
            : trimmed
              ? trimmed
              : isFirstRun
                ? 'Welcome to Habitat'
                : 'A New Space for Your Mind'}
        </h1>
        <p className="habitat-stage-sub">
          {flowMode === 'sync'
            ? 'Connect over your local Wi-Fi to copy your vault and stay in sync. 100% offline & local.'
            : isFirstRun
              ? 'Your private, interconnected sanctuary for thoughts, notes, and projects.'
              : 'An independent universe of objects, ideas, and knowledge.'}
        </p>

        {/* Segmented Mode Switcher (on mobile/standalone first run) */}
        {standalone && isFirstRun && (
          <div className="habitat-onboard-tabs">
            <button
              type="button"
              className={`habitat-onboard-tab ${flowMode === 'sync' ? 'active' : ''}`}
              onClick={() => setFlowMode('sync')}
            >
              <Icon name="refresh-cw" size={14} />
              <span>Sync with Mac</span>
            </button>
            <button
              type="button"
              className={`habitat-onboard-tab ${flowMode === 'create' ? 'active' : ''}`}
              onClick={() => setFlowMode('create')}
            >
              <Icon name="sparkles" size={14} />
              <span>Start Fresh</span>
            </button>
          </div>
        )}

        {flowMode === 'sync' ? (
          /* SYNC FROM MAC FLOW */
          <>
            <div className="habitat-sync-form">
              <div className="habitat-sync-input-group">
                <label className="habitat-sync-label">Mac Network Address</label>
                <input
                  type="text"
                  className="habitat-sync-input"
                  placeholder="http://192.168.1.X:37373"
                  value={macUrl}
                  disabled={syncing || isWarping}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  onChange={(e) => {
                    setMacUrl(e.target.value);
                    if (syncError) setSyncError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSyncClone();
                  }}
                />
                <div className="habitat-sync-hint">
                  In Habitat on your Mac, go to <strong>Settings → Sync</strong> to find your Mac's address.
                </div>
              </div>

              <div className="habitat-sync-input-group" style={{ marginTop: 8 }}>
                <label className="habitat-sync-label">Sync Token (optional)</label>
                <input
                  type="password"
                  className="habitat-sync-input"
                  placeholder="Token from Mac settings (if set)"
                  value={macToken}
                  disabled={syncing || isWarping}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  onChange={(e) => {
                    setMacToken(e.target.value);
                    if (syncError) setSyncError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSyncClone();
                  }}
                />
              </div>
            </div>

            {syncError && <div className="field-error habitat-create-error" style={{ marginBottom: 14 }}>{syncError}</div>}

            <motion.button
              type="button"
              className={'habitat-launch-btn' + (syncing || isWarping ? ' launching' : '')}
              disabled={!macUrl.trim() || syncing || isWarping}
              whileHover={!syncing && !isWarping && macUrl.trim() ? { scale: 1.02 } : undefined}
              whileTap={!syncing && !isWarping && macUrl.trim() ? { scale: 0.98 } : undefined}
              onClick={handleSyncClone}
            >
              {isWarping || success ? (
                <>
                  <span className="habitat-spinner" />
                  <span>Opening Cloned Vault…</span>
                </>
              ) : syncing ? (
                <>
                  <span className="habitat-spinner" />
                  <span>Connecting & Cloning Vault…</span>
                </>
              ) : (
                <span>Connect & Clone Vault</span>
              )}
            </motion.button>

            <div className="habitat-open-existing-wrap">
              <button
                type="button"
                className="habitat-open-existing-link"
                disabled={syncing || isWarping}
                onClick={() => setFlowMode('create')}
              >
                <Icon name="sparkles" size={13} />
                <span>Don't have a Mac vault? Create new habitat</span>
              </button>
            </div>
          </>
        ) : (
          /* CREATE NEW HABITAT FLOW */
          <>
            {/* Centerpiece Name Input */}
            <div className="habitat-stage-input-wrap">
              <div className={'habitat-stage-input-box' + (touched && !trimmed ? ' invalid' : '')}>
                <span className="habitat-stage-input-glow" />
                <input
                  ref={inputRef}
                  className="habitat-stage-name-input"
                  placeholder="Name your habitat…"
                  value={name}
                  autoFocus
                  disabled={busy || isWarping}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (touched) setTouched(false);
                  }}
                  onBlur={() => {
                    if (!trimmed) setTouched(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                  }}
                />
                {name && !busy && !isWarping && (
                  <button
                    type="button"
                    className="habitat-stage-clear-btn"
                    onClick={() => {
                      setName('');
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear name"
                  >
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>

              {touched && !trimmed && (
                <motion.div
                  className="field-error habitat-stage-error-text"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  Please enter a name for your habitat
                </motion.div>
              )}

              {/* Inspiring Name Suggestions */}
              <div className="habitat-suggestions">
                <span className="habitat-suggestions-label">Try:</span>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={'habitat-suggestion-chip' + (name === s ? ' active' : '')}
                    onClick={() => {
                      setName(s);
                      setTouched(false);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Customization Deck: Suggested Totems & Auras with "More" buttons */}
            <div className="habitat-customization-deck">
              <HabitatIconPicker value={selectedIcon} onPick={setSelectedIcon} align="left" />
              <HabitatAuraPicker value={auraValue} onPick={setAuraValue} align="right" />
            </div>

            {/* Location / Storage Destination: On desktop show folder picker; on standalone mobile show device storage badge */}
            {!standalone ? (
              <div className="habitat-storage-ribbon" onClick={handlePickFolder}>
                <div className="habitat-storage-icon">
                  <Icon name="folder" size={17} />
                </div>
                <div className="habitat-storage-text">
                  <div className="habitat-storage-title">
                    {dir ? (
                      <span className="habitat-storage-path">{dir}</span>
                    ) : (
                      <span>Save to custom folder (Optional)</span>
                    )}
                  </div>
                  <div className="habitat-storage-caption">
                    {dir ? 'Habitat database will be placed here' : '100% private, local on disk & fully offline'}
                  </div>
                </div>
                <button
                  type="button"
                  className="habitat-storage-browse-btn"
                  disabled={busy || isWarping}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePickFolder();
                  }}
                >
                  {dir ? 'Change' : 'Browse'}
                </button>
              </div>
            ) : (
              <div className="habitat-mobile-storage-badge">
                <Icon name="shield" size={13} />
                <span>Stored securely on device (offline SQLite)</span>
              </div>
            )}

            {/* First-Run Personalization Option */}
            {isFirstRun && (
              <div className="habitat-personalize-section">
                <button
                  type="button"
                  className="habitat-personalize-toggle"
                  onClick={() => setShowPersonalize((v) => !v)}
                >
                  <Icon name={showPersonalize ? 'chevron-down' : 'chevron-right'} size={14} />
                  <span>Personalize profile (optional)</span>
                </button>
                <AnimatePresence>
                  {showPersonalize && (
                    <motion.div
                      className="habitat-personalize-content"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="habitat-input-container">
                        <span className="habitat-input-icon">
                          <Icon name="user" size={15} />
                        </span>
                        <input
                          className="habitat-create-input"
                          placeholder="Your name (creates your personal @mention card)"
                          value={userName}
                          onChange={(e) => setUserName(e.target.value)}
                          disabled={busy || isWarping}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCreate();
                          }}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {errorMsg && <div className="field-error habitat-create-error">{errorMsg}</div>}

            {/* Primary Action Button */}
            <motion.button
              type="button"
              className={'habitat-launch-btn' + (isWarping ? ' launching' : '')}
              disabled={!trimmed || busy || isWarping}
              whileHover={!busy && !isWarping && trimmed ? { scale: 1.02 } : undefined}
              whileTap={!busy && !isWarping && trimmed ? { scale: 0.98 } : undefined}
              onClick={handleCreate}
            >
              {isWarping ? (
                <>
                  <span className="habitat-spinner" />
                  <span>Initializing Habitat…</span>
                </>
              ) : (
                <span>Bring Habitat to Life</span>
              )}
            </motion.button>

            {/* First run: Open existing habitat button on desktop; or switch to Sync on mobile */}
            {isFirstRun && (
              <div className="habitat-open-existing-wrap">
                {standalone ? (
                  <button
                    type="button"
                    className="habitat-open-existing-link"
                    disabled={busy || isWarping}
                    onClick={() => setFlowMode('sync')}
                  >
                    <Icon name="refresh-cw" size={13} />
                    <span>Have a habitat on your Mac? Tap here to sync</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="habitat-open-existing-link"
                      disabled={busy || isWarping}
                      onClick={handleOpenExisting}
                    >
                      <Icon name="folder" size={13} />
                      <span>I already have a habitat — open its folder</span>
                    </button>
                    {openError && <div className="field-error habitat-open-error">{openError}</div>}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

/** First-run full-screen onboarding flow. */
export function Onboarding() {
  return <CreateHabitatScreen isFirstRun />;
}

/** Modal dialog for creating an additional habitat from the sidebar menu. */
export function NewHabitatModal({ onClose }: { onClose: () => void }) {
  return <CreateHabitatScreen onClose={onClose} />;
}

