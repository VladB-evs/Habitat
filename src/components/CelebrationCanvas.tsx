import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotSpeed: number;
  shape: 'rect' | 'circle' | 'star';
  alpha: number;
  decay: number;
}

const COLORS = ['#FF4365', '#03D8F3', '#FFD166', '#06D6A0', '#8338EC', '#3A86FF', '#FB5607', '#E0AAFF'];

export function CelebrationCanvas({ active, onFinished }: { active: boolean; onFinished?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
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

    const particles: Particle[] = [];

    // Create 130 celebratory particles launched upwards with explosive velocity
    for (let i = 0; i < 130; i++) {
      // Random starting cluster along center-bottom or spread across width
      const startX = width * 0.5 + (Math.random() - 0.5) * 350;
      const startY = height * 0.65 + (Math.random() - 0.5) * 80;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const speed = 10 + Math.random() * 22;

      particles.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 5,
        vy: Math.sin(angle) * speed - (5 + Math.random() * 8),
        size: 5 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3,
        shape: Math.random() > 0.4 ? 'rect' : Math.random() > 0.5 ? 'circle' : 'star',
        alpha: 1,
        decay: 0.007 + Math.random() * 0.009,
      });
    }

    const startTime = Date.now();

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      let alive = 0;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.45; // gravity
        p.vx *= 0.985; // drag
        p.rotation += p.rotSpeed;
        p.alpha = Math.max(0, p.alpha - p.decay);

        if (p.alpha > 0.01) alive++;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        } else if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Draw mini star / diamond
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.4, -p.size * 0.3);
          ctx.lineTo(p.size, 0);
          ctx.lineTo(p.size * 0.4, p.size * 0.3);
          ctx.lineTo(0, p.size);
          ctx.lineTo(-p.size * 0.4, p.size * 0.3);
          ctx.lineTo(-p.size, 0);
          ctx.lineTo(-p.size * 0.4, -p.size * 0.3);
          ctx.closePath();
          ctx.fill();
        }

        ctx.restore();
      }

      if (alive > 0 && Date.now() - startTime < 3500) {
        animId = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, width, height);
        onFinished?.();
      }
    };

    animId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animId);
    };
  }, [active, onFinished]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="hab-celebration-canvas"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    />
  );
}
