'use client';

import { useMemo } from 'react';
import { useDAWStore } from '@/lib/store';

// ─── Cloud Layer ──────────────────────────────────────────────────────────────

function CloudLayer({
  count,
  baseColor,
  durationRange,
  sizeRange,
  opacityRange,
  reverse,
}: {
  count: number;
  baseColor: string;
  durationRange: [number, number];
  sizeRange: [number, number];
  opacityRange: [number, number];
  reverse?: boolean;
}) {
  const clouds = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const seed = (i * 7919 + 1301) % 1000;
      const s = seed / 1000;
      const duration = durationRange[0] + s * (durationRange[1] - durationRange[0]);
      const delay = -(s * duration);
      const size = sizeRange[0] + ((seed * 3) % 1000) / 1000 * (sizeRange[1] - sizeRange[0]);
      const top = 5 + ((seed * 7) % 1000) / 1000 * 80;
      const opacity = opacityRange[0] + ((seed * 11) % 1000) / 1000 * (opacityRange[1] - opacityRange[0]);
      return { duration, delay, size, top, opacity, key: i };
    });
  }, [count, durationRange, sizeRange, opacityRange]);

  return (
    <>
      {clouds.map((c) => (
        <div
          key={c.key}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: c.size,
            height: c.size * 0.4,
            top: `${c.top}%`,
            background: `radial-gradient(ellipse, ${baseColor} 0%, transparent 70%)`,
            opacity: c.opacity,
            animation: `${reverse ? 'cloudFloat2' : 'cloudFloat'} ${c.duration}s linear ${c.delay}s infinite`,
            filter: `blur(${c.size * 0.15}px)`,
          }}
        />
      ))}
    </>
  );
}

// ─── Particle Layer ───────────────────────────────────────────────────────────

function ParticleLayer({
  count,
  color,
  durationRange,
  sizeRange,
}: {
  count: number;
  color: string;
  durationRange: [number, number];
  sizeRange: [number, number];
}) {
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const seed = (i * 4391 + 997) % 1000;
      const s = seed / 1000;
      const duration = durationRange[0] + s * (durationRange[1] - durationRange[0]);
      const delay = -(s * duration);
      const size = sizeRange[0] + ((seed * 3) % 1000) / 1000 * (sizeRange[1] - sizeRange[0]);
      const left = ((seed * 7) % 1000) / 10;
      return { duration, delay, size, left, key: i };
    });
  }, [count, durationRange, sizeRange]);

  return (
    <>
      {particles.map((p) => (
        <div
          key={p.key}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.left}%`,
            bottom: 0,
            background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
            animation: `particleDrift ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
    </>
  );
}

// ─── Aurora Layer ─────────────────────────────────────────────────────────────

function AuroraLayer({
  colors,
}: {
  colors: string[];
}) {
  return (
    <>
      {colors.map((color, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            top: `${5 + i * 12}%`,
            left: `${-10 + i * 15}%`,
            width: `${60 + i * 10}%`,
            height: '30%',
            background: `linear-gradient(90deg, transparent 0%, ${color} 30%, ${color} 70%, transparent 100%)`,
            opacity: 0.3,
            filter: `blur(${40 + i * 10}px)`,
            borderRadius: '50%',
            animation: `auroraWave ${12 + i * 4}s ease-in-out ${i * 2}s infinite`,
          }}
        />
      ))}
    </>
  );
}

// ─── Fog Layer ────────────────────────────────────────────────────────────────

function FogLayer({
  color,
  opacity,
}: {
  color: string;
  opacity: number;
}) {
  return (
    <>
      <div
        className="absolute pointer-events-none"
        style={{
          inset: '-20%',
          background: `radial-gradient(ellipse at 20% 80%, ${color} 0%, transparent 60%)`,
          opacity,
          animation: 'fogDrift 20s ease-in-out infinite',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          inset: '-20%',
          background: `radial-gradient(ellipse at 80% 20%, ${color} 0%, transparent 60%)`,
          opacity: opacity * 0.7,
          animation: 'fogDrift 25s ease-in-out -8s infinite',
        }}
      />
    </>
  );
}

// ─── Ambient Glow ─────────────────────────────────────────────────────────────

function AmbientGlow({
  color,
  position,
}: {
  color: string;
  position: 'top-left' | 'bottom-right' | 'center';
}) {
  const positionStyles: Record<string, React.CSSProperties> = {
    'top-left': { top: '-15%', left: '-15%', width: '50%', height: '50%' },
    'bottom-right': { bottom: '-15%', right: '-15%', width: '50%', height: '50%' },
    'center': { top: '20%', left: '20%', width: '60%', height: '60%' },
  };

  return (
    <div
      className="absolute pointer-events-none rounded-full"
      style={{
        ...positionStyles[position],
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        animation: 'gentlePulse 8s ease-in-out infinite',
      }}
    />
  );
}

// ─── Theme Backgrounds ───────────────────────────────────────────────────────

function ClassicBackground() {
  return (
    <>
      <AmbientGlow color="rgba(255, 140, 0, 0.03)" position="top-left" />
      <AmbientGlow color="rgba(255, 100, 0, 0.02)" position="bottom-right" />
      <div className="scanline-overlay" />
    </>
  );
}

function ClassicNoirBackground() {
  return (
    <>
      <AmbientGlow color="rgba(255, 255, 255, 0.015)" position="top-left" />
      <FogLayer color="rgba(100, 100, 100, 0.03)" opacity={0.5} />
      <div className="scanline-overlay" />
    </>
  );
}

function CloudsBackground() {
  return (
    <>
      <AmbientGlow color="rgba(126, 184, 255, 0.04)" position="top-left" />
      <AmbientGlow color="rgba(176, 142, 239, 0.03)" position="bottom-right" />
      <CloudLayer
        count={6}
        baseColor="rgba(126, 184, 255, 0.12)"
        durationRange={[45, 80]}
        sizeRange={[200, 500]}
        opacityRange={[0.15, 0.35]}
      />
      <CloudLayer
        count={4}
        baseColor="rgba(176, 142, 239, 0.08)"
        durationRange={[55, 90]}
        sizeRange={[300, 600]}
        opacityRange={[0.08, 0.2]}
        reverse
      />
      <ParticleLayer
        count={12}
        color="rgba(180, 210, 255, 0.4)"
        durationRange={[15, 30]}
        sizeRange={[2, 5]}
      />
    </>
  );
}

function ForestBackground() {
  return (
    <>
      <AmbientGlow color="rgba(94, 204, 126, 0.03)" position="bottom-right" />
      <AmbientGlow color="rgba(60, 140, 80, 0.02)" position="top-left" />
      <FogLayer color="rgba(40, 100, 60, 0.06)" opacity={0.6} />
      <ParticleLayer
        count={8}
        color="rgba(94, 204, 126, 0.3)"
        durationRange={[20, 40]}
        sizeRange={[2, 4]}
      />
      <CloudLayer
        count={3}
        baseColor="rgba(40, 80, 50, 0.1)"
        durationRange={[60, 100]}
        sizeRange={[300, 600]}
        opacityRange={[0.1, 0.2]}
      />
    </>
  );
}

function AuroraBackground() {
  return (
    <>
      <AuroraLayer
        colors={[
          'rgba(72, 191, 227, 0.15)',
          'rgba(199, 125, 255, 0.12)',
          'rgba(114, 239, 221, 0.1)',
          'rgba(255, 107, 138, 0.08)',
        ]}
      />
      <ParticleLayer
        count={15}
        color="rgba(199, 125, 255, 0.35)"
        durationRange={[12, 25]}
        sizeRange={[2, 5]}
      />
      <AmbientGlow color="rgba(199, 125, 255, 0.04)" position="center" />
    </>
  );
}

function SunsetBackground() {
  return (
    <>
      <AmbientGlow color="rgba(255, 107, 107, 0.04)" position="top-left" />
      <AmbientGlow color="rgba(208, 136, 224, 0.03)" position="bottom-right" />
      <CloudLayer
        count={5}
        baseColor="rgba(255, 107, 107, 0.08)"
        durationRange={[50, 85]}
        sizeRange={[250, 500]}
        opacityRange={[0.1, 0.25]}
      />
      <CloudLayer
        count={3}
        baseColor="rgba(255, 160, 100, 0.06)"
        durationRange={[60, 100]}
        sizeRange={[300, 550]}
        opacityRange={[0.08, 0.18]}
        reverse
      />
      <FogLayer color="rgba(200, 80, 80, 0.03)" opacity={0.4} />
    </>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function ThemeBackground() {
  const theme = useDAWStore((s) => s.theme);

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ zIndex: 0 }}
    >
      {theme === 'classic' && <ClassicBackground />}
      {theme === 'classic-noir' && <ClassicNoirBackground />}
      {theme === 'clouds' && <CloudsBackground />}
      {theme === 'forest' && <ForestBackground />}
      {theme === 'aurora' && <AuroraBackground />}
      {theme === 'sunset' && <SunsetBackground />}
    </div>
  );
}
