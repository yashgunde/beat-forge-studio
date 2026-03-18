'use client';

import { useState } from 'react';
import { useDAWStore } from '@/lib/store';

const THEMES = [
  { id: 'classic', label: 'Classic', icon: '🔥', color: '#ff8c00' },
  { id: 'classic-noir', label: 'Classic Noir', icon: '🖤', color: '#c0c0c0' },
  { id: 'clouds', label: 'Clouds', icon: '☁️', color: '#7eb8ff' },
  { id: 'forest', label: 'Forest', icon: '🌲', color: '#5ecc7e' },
  { id: 'aurora', label: 'Aurora', icon: '🌌', color: '#c77dff' },
  { id: 'sunset', label: 'Sunset', icon: '🌅', color: '#ff6b6b' },
] as const;

export default function ThemePicker() {
  const theme = useDAWStore((s) => s.theme);
  const setTheme = useDAWStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);

  const currentTheme = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div className="fixed bottom-3 right-3 z-[200]">
      {/* Popup — opens upward */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-[200]"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute bottom-full right-0 mb-2 z-[210] rounded-xl overflow-hidden"
            style={{
              background: 'var(--daw-panel)',
              border: '1px solid var(--daw-border)',
              boxShadow:
                '0 -8px 40px rgba(0,0,0,0.5), 0 0 30px var(--daw-glow-color)',
              minWidth: 180,
              backdropFilter: 'blur(20px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
            }}
          >
            <div
              className="px-3 py-2 text-[9px] font-mono tracking-[0.2em] uppercase border-b"
              style={{
                color: 'var(--daw-text-muted)',
                borderColor: 'var(--daw-border)',
              }}
            >
              Choose Theme
            </div>
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-[11px] font-mono tracking-wider text-left transition-all"
                style={{
                  color:
                    theme === t.id
                      ? 'var(--daw-text)'
                      : 'var(--daw-text-muted)',
                  background:
                    theme === t.id
                      ? `linear-gradient(90deg, ${t.color}25 0%, transparent 100%)`
                      : 'transparent',
                  borderLeft:
                    theme === t.id
                      ? `3px solid ${t.color}`
                      : '3px solid transparent',
                }}
              >
                <span className="text-base">{t.icon}</span>
                <span className="flex-1">{t.label}</span>
                {theme === t.id && (
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: t.color,
                      boxShadow: `0 0 8px ${t.color}`,
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-full font-mono text-[10px] tracking-wider transition-all"
        style={{
          background: 'var(--daw-panel-glass)',
          border: '1px solid var(--daw-border)',
          color: 'var(--daw-text-muted)',
          backdropFilter: 'blur(16px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(16px) saturate(1.3)',
          boxShadow: `0 4px 20px rgba(0,0,0,0.4), 0 0 12px var(--daw-glow-color)`,
        }}
        title="Change theme"
      >
        <span className="text-base">{currentTheme.icon}</span>
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: currentTheme.color,
            boxShadow: `0 0 6px ${currentTheme.color}`,
          }}
        />
      </button>
    </div>
  );
}
