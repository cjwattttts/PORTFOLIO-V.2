import React, { useEffect, useMemo, useRef } from 'react';
import { createSeededRandom } from '../utils/seededRandom';

type Props = {
  density?: number;           // default auto; multiplier for columns/rows
  parallaxStrength?: number;  // default 0.08
  scrambleFrequency?: number; // default 0.08 (8% of cells during a scramble tick)
  color?: string;             // default 'rgba(255,255,255,0.22)'
  highlightColor?: string;    // default 'rgba(255,255,255,0.35)'
  glyphs?: string;            // default '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  className?: string;         // extra Tailwind classes
};

type GridMetrics = {
  cols: number;
  rows: number;
  cell: number;        // pixel size of cell (grid step)
  offsetX: number;     // center alignment
  offsetY: number;     // center alignment
};

type ScrambleCell = {
  glyphIndex: number;
  until: number;       // timestamp (ms) when scramble expires
};

const BG_COLOR = '#0a0a0f';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function usePrefersReducedMotion() {
  const isClient = typeof window !== 'undefined';
  const [reduced, setReduced] = React.useState<boolean>(false);

  useEffect(() => {
    if (!isClient || !('matchMedia' in window)) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => setReduced(media.matches);
    handler();
    try {
      media.addEventListener('change', handler);
      return () => media.removeEventListener('change', handler);
    } catch {
      media.addListener(handler);
      return () => media.removeListener(handler);
    }
  }, [isClient]);

  return reduced;
}

const DataScrambleParallaxBackground: React.FC<Props> = ({
  density,
  parallaxStrength = 0.08,
  scrambleFrequency = 0.08,
  color = 'rgba(255,255,255,0.22)',
  highlightColor = 'rgba(255,255,255,0.35)',
  glyphs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dprRef = useRef<number>(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const rafRef = useRef<number | null>(null);
  const gridRef = useRef<GridMetrics | null>(null);
  const baseGridRef = useRef<Uint16Array | null>(null);
  const scrambleMapRef = useRef<Map<number, ScrambleCell>>(new Map());
  const lastTimestampRef = useRef<number>(0);
  const scrollTargetRef = useRef<number>(0);
  const scrollSmoothedRef = useRef<number>(0);
  const velocityRef = useRef<number>(0);
  const lastScrollRef = useRef<{ y: number; t: number }>({ y: 0, t: 0 });
  const mouseOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const reducedMotion = usePrefersReducedMotion();

  const isClient = typeof window !== 'undefined';

  const seedKey = useMemo(() => {
    const w = isClient ? Math.round(window.innerWidth) : 1024;
    const h = isClient ? Math.round(window.innerHeight) : 768;
    return (w * 73856093) ^ (h * 19349663);
  }, [isClient]);

  const rand = useMemo(() => createSeededRandom(seedKey), [seedKey]);

  const computeGrid = React.useCallback((ctx: CanvasRenderingContext2D) => {
    const canvas = ctx.canvas;
    const dpr = (dprRef.current = (isClient ? window.devicePixelRatio || 1 : 1));
    const widthCss = isClient ? canvas.clientWidth : 1920;
    const heightCss = isClient ? canvas.clientHeight : 1080;
    canvas.width = Math.max(1, Math.floor(widthCss * dpr));
    canvas.height = Math.max(1, Math.floor(heightCss * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const baseCell = 20;
    const isMobile = isClient ? window.innerWidth < 768 : false;
    const densityMul = density ?? (isMobile ? 0.9 : 1.0);
    const cell = clamp(Math.round(baseCell * densityMul), 16, 24);

    const cols = Math.floor(widthCss / cell);
    const rows = Math.floor(heightCss / cell);

    const totalW = cols * cell;
    const totalH = rows * cell;
    const offsetX = Math.floor((widthCss - totalW) / 2);
    const offsetY = Math.floor((heightCss - totalH) / 2);

    gridRef.current = { cols, rows, cell, offsetX, offsetY };

    const totalCells = cols * rows;
    const buf = new Uint16Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      buf[i] = Math.floor(rand() * glyphs.length);
    }
    baseGridRef.current = buf;
  }, [density, glyphs.length, isClient, rand]);

  function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.save();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    // Vertical vignette (very subtle)
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(0,0,0,0.25)');
    grad.addColorStop(0.15, 'rgba(0,0,0,0.0)');
    grad.addColorStop(0.85, 'rgba(0,0,0,0.0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  useEffect(() => {
    if (!isClient) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame: number | null = null;
    const onResize = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => computeGrid(ctx));
    };

    computeGrid(ctx);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [computeGrid, isClient]);

  useEffect(() => {
    if (!isClient) return;

    const onScroll = () => {
      const now = performance.now();
      const y = window.scrollY || window.pageYOffset || 0;
      scrollTargetRef.current = y;

      const dt = now - lastScrollRef.current.t || 16;
      const dy = y - lastScrollRef.current.y || 0;
      const v = Math.abs(dy) / Math.max(1, dt);
      velocityRef.current = lerp(velocityRef.current, v, 0.35);
      lastScrollRef.current = { y, t: now };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (window.innerWidth < 1024) return; // desktop only
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      mouseOffsetRef.current.x = clamp((e.clientX - cx) / cx, -1, 1) * 2; // +-2px
      mouseOffsetRef.current.y = clamp((e.clientY - cy) / cy, -1, 1) * 2;
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [isClient]);

  useEffect(() => {
    if (!isClient) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const isMobile = () => window.innerWidth < 768;
    const effectiveScrambleBase = () => (isMobile() ? 0.6 : 1) * (scrambleFrequency ?? 0.08);

    const reduced = reducedMotion;
    const colorNorm = color;
    const highlight = highlightColor;
    const glyphArray = glyphs.split('');

    function applyFont(cell: number) {
      ctx.font = `${Math.floor(cell * 0.78)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    const draw = (t: number) => {
      if (!running) return;

      const gm = gridRef.current;
      const base = baseGridRef.current;
      if (!gm || !base) {
        lastTimestampRef.current = t;
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const width = ctx.canvas.clientWidth;
      const height = ctx.canvas.clientHeight;

      // Background + vignette
      drawBackground(ctx, width, height);

      const dt = Math.max(0.0001, t - (lastTimestampRef.current || t));
      lastTimestampRef.current = t;

      // Parallax LA = opposite direction of scroll
      const parallaxTarget = -scrollTargetRef.current * (reduced ? 0 : parallaxStrength);
      scrollSmoothedRef.current = lerp(scrollSmoothedRef.current, parallaxTarget, 0.08);

      const driftX = reduced ? 0 : mouseOffsetRef.current.x;
      const driftY = reduced ? 0 : mouseOffsetRef.current.y;

      // Scramble bursts based on scroll velocity
      if (!reduced) {
        const v = velocityRef.current; // px/ms
        const cap = clamp(v * 1.6, 0, 0.22);
        const freq = effectiveScrambleBase();
        const p = clamp(freq * cap, 0, 0.16);
        if (p > 0.005 && Math.random() < 0.85) {
          const totalCells = gm.cols * gm.rows;
          const count = Math.max(1, Math.floor(totalCells * clamp(p, 0.01, 0.12)));
          const now = performance.now();
          for (let i = 0; i < count; i++) {
            const idx = Math.floor(Math.random() * totalCells);
            const ttl = 200 + Math.random() * 150; // 200–350ms
            scrambleMapRef.current.set(idx, {
              glyphIndex: Math.floor(Math.random() * glyphArray.length),
              until: now + ttl,
            });
          }
        }
        const now = performance.now();
        if (scrambleMapRef.current.size) {
          for (const [k, vcell] of scrambleMapRef.current) {
            if (vcell.until <= now) scrambleMapRef.current.delete(k);
          }
        }
      } else {
        scrambleMapRef.current.clear();
      }

      // Draw grid
      applyFont(gm.cell);
      ctx.save();
      ctx.translate(gm.offsetX + driftX, gm.offsetY + scrollSmoothedRef.current + driftY);

      const probHighlight = 0.06;
      for (let r = 0; r < gm.rows; r++) {
        for (let c = 0; c < gm.cols; c++) {
          const idx = r * gm.cols + c;
          const scrambled = scrambleMapRef.current.get(idx);
          const glyphIndex = scrambled ? scrambled.glyphIndex : base[idx];
          const g = glyphArray[glyphIndex];

          ctx.fillStyle = Math.random() < probHighlight ? highlight : colorNorm;
          const x = c * gm.cell + gm.cell * 0.5;
          const y = r * gm.cell + gm.cell * 0.5;
          ctx.fillText(g, x, y);
        }
      }

      ctx.restore();

      if (document.visibilityState !== 'hidden') {
        rafRef.current = requestAnimationFrame(draw);
      } else {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    color,
    glyphs,
    highlightColor,
    parallaxStrength,
    scrambleFrequency,
    reducedMotion,
    isClient,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={[
        'pointer-events-none w-full h-full',
        className,
      ].filter(Boolean).join(' ')}
      aria-hidden="true"
    />
  );
};

export default DataScrambleParallaxBackground;
