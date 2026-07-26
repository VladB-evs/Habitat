import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { GraphData } from '../types';
import { typeColor } from '../util';

interface SimNode {
  id: string;
  title: string;
  typeId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
}

export function GraphView() {
  const { types, openObject, theme } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<GraphData | null>(null);

  useEffect(() => {
    api.graph().then(setData);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const colEdge = css.getPropertyValue('--border-2').trim() || '#555';
    const colLabel = css.getPropertyValue('--text-2').trim() || '#999';
    const colRing = css.getPropertyValue('--accent').trim() || '#eda100';
    const colorOf = new Map(types.map((t) => [t.id, typeColor(t.color, theme)]));

    const deg = new Map<string, number>();
    for (const e of data.edges) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
    }

    const nodes: SimNode[] = data.nodes.map((n, i) => {
      const a = (i / Math.max(data.nodes.length, 1)) * Math.PI * 2;
      const r = 120 + (i % 5) * 40;
      return { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, deg: deg.get(n.id) ?? 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = data.edges
      .map((e) => ({ a: byId.get(e.from)!, b: byId.get(e.to)! }))
      .filter((e) => e.a && e.b);

    let w = 0;
    let h = 0;
    let dpr = window.devicePixelRatio || 1;
    let k = 1;
    let ox = 0;
    let oy = 0;
    let alpha = 1;
    let raf = 0;
    let hovered: SimNode | null = null;
    let dragNode: SimNode | null = null;
    let panning = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ox = w / 2;
      oy = h / 2;
    };
    resize();
    const ro = new ResizeObserver(() => {
      const cx = ox;
      const cy = oy;
      resize();
      ox = cx;
      oy = cy;
    });
    ro.observe(canvas);
    resize();

    const radius = (n: SimNode) => 5 + Math.min(n.deg, 6) * 1.3;

    const toWorld = (sx: number, sy: number) => ({ x: (sx - ox) / k, y: (sy - oy) / k });

    const hit = (sx: number, sy: number): SimNode | null => {
      const p = toWorld(sx, sy);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const r = radius(n) + 4 / k;
        if (dx * dx + dy * dy < r * r) return n;
      }
      return null;
    };

    const physics = () => {
      alpha = Math.max(alpha * 0.995, 0.02);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            d2 = dx * dx + dy * dy;
          }
          const f = Math.min((2400 * alpha) / d2, 4);
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
      for (const e of edges) {
        const dx = e.b.x - e.a.x;
        const dy = e.b.y - e.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 110) * 0.045 * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        e.a.vx += fx;
        e.a.vy += fy;
        e.b.vx -= fx;
        e.b.vy -= fy;
      }
      for (const n of nodes) {
        n.vx -= n.x * 0.003 * alpha;
        n.vy -= n.y * 0.003 * alpha;
        if (n === dragNode) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(ox, oy);
      ctx.scale(k, k);

      ctx.strokeStyle = colEdge;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.2 / k;
      ctx.beginPath();
      for (const e of edges) {
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      for (const n of nodes) {
        const r = radius(n);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = colorOf.get(n.typeId) ?? '#888';
        ctx.fill();
        if (n === hovered) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3 / k, 0, Math.PI * 2);
          ctx.strokeStyle = colRing;
          ctx.lineWidth = 1.6 / k;
          ctx.stroke();
        }
      }

      const showLabels = k >= 0.75;
      ctx.fillStyle = colLabel;
      ctx.textAlign = 'center';
      for (const n of nodes) {
        if (!showLabels && n !== hovered) continue;
        ctx.font = `${11 / k}px -apple-system, sans-serif`;
        const label = n.title.length > 26 ? n.title.slice(0, 25) + '…' : n.title;
        ctx.fillText(label, n.x, n.y + radius(n) + 13 / k);
      }
    };

    const tick = () => {
      physics();
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      moved = 0;
      lastX = sx;
      lastY = sy;
      const n = hit(sx, sy);
      if (n) {
        dragNode = n;
        alpha = Math.max(alpha, 0.5);
      } else {
        panning = true;
        canvas.classList.add('dragging');
      }
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const dx = sx - lastX;
      const dy = sy - lastY;
      if (dragNode || panning) moved += Math.abs(dx) + Math.abs(dy);
      if (dragNode) {
        dragNode.x += dx / k;
        dragNode.y += dy / k;
        alpha = Math.max(alpha, 0.3);
      } else if (panning) {
        ox += dx;
        oy += dy;
      } else {
        hovered = hit(sx, sy);
        canvas.style.cursor = hovered ? 'pointer' : 'grab';
      }
      lastX = sx;
      lastY = sy;
    };

    const onUp = () => {
      if (dragNode && moved < 5) openObject(dragNode.id);
      dragNode = null;
      panning = false;
      canvas.classList.remove('dragging');
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const nk = Math.min(3.5, Math.max(0.25, k * factor));
      ox = sx - ((sx - ox) / k) * nk;
      oy = sy - ((sy - oy) / k) * nk;
      k = nk;
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [data, types, theme, openObject]);

  const legendTypes = types.filter((t) => data?.nodes.some((n) => n.typeId === t.id));

  return (
    <div className="graph-page">
      <canvas ref={canvasRef} />
      {legendTypes.length > 0 && (
        <div className="graph-legend bottom">
          {legendTypes.map((t) => (
            <div key={t.id} className="legend-row">
              <span className="legend-dot" style={{ background: typeColor(t.color, theme) }} />
              {t.name}
            </div>
          ))}
        </div>
      )}
      {data && data.nodes.length === 0 && <div className="graph-empty">Create a few objects and links to grow your graph</div>}
    </div>
  );
}
