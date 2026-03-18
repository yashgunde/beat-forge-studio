'use client';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useDAWStore } from '@/lib/store';
import { MixerChannel } from '@/lib/types';

// ─── Knob ────────────────────────────────────────────────────────────────────

interface KnobProps {
  value: number;
  min: number;
  max: number;
  label: string;
  size?: 'sm' | 'md';
  onChange: (val: number) => void;
  formatValue?: (v: number) => string;
  isActive?: boolean;
}

function Knob({
  value,
  min,
  max,
  label,
  size = 'sm',
  onChange,
  formatValue,
  isActive = false,
}: KnobProps) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(value);
  const [tooltip, setTooltip] = useState(false);
  const [hovered, setHovered] = useState(false);

  const range = max - min;
  const deg = ((value - min) / range) * 270 - 135;

  const dim = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startVal.current = value;
      setTooltip(true);

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = (startY.current - ev.clientY) / 120;
        const next = Math.min(
          max,
          Math.max(min, startVal.current + delta * range),
        );
        onChange(parseFloat(next.toFixed(2)));
      };

      const onUp = () => {
        dragging.current = false;
        setTooltip(false);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [value, min, max, range, onChange],
  );

  const display = formatValue ? formatValue(value) : value.toFixed(1);

  const borderColor = isActive
    ? 'var(--daw-accent)'
    : hovered
    ? 'var(--daw-accent-dark)'
    : 'var(--daw-border)';

  const glowStyle =
    hovered || isActive
      ? { boxShadow: `0 0 8px var(--daw-glow-color-strong)` }
      : {};

  return (
    <div className="flex flex-col items-center gap-0.5 select-none">
      <div
        className="relative"
        onMouseDown={onMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          className={`${dim} rounded-full cursor-pointer relative overflow-hidden transition-all duration-150`}
          style={{
            background: 'radial-gradient(circle at 35% 35%, #3a3a52, #14141e)',
            border: `1px solid ${borderColor}`,
            userSelect: 'none',
            ...glowStyle,
          }}
        >
          {/* Track arc background */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                'radial-gradient(circle at 35% 35%, #2e2e42, #0f0f18)',
            }}
          />
          {/* Indicator dot */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ transform: `rotate(${deg}deg)` }}
          >
            <div
              className="absolute rounded-full"
              style={{
                width: 3,
                height: 3,
                top: 3,
                left: '50%',
                marginLeft: -1.5,
                backgroundColor: isActive ? 'var(--daw-accent)' : '#aaa',
                boxShadow: isActive ? '0 0 4px var(--daw-accent)' : 'none',
              }}
            />
          </div>
          {/* Center dot */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: '#1a1a2e' }}
            />
          </div>
        </div>
        {tooltip && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#ff8c00] text-black text-[9px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap z-50 pointer-events-none">
            {display}
          </div>
        )}
      </div>
      <span
        className="text-[8px] font-mono tracking-wider"
        style={{ color: isActive ? '#ff8c00' : '#555' }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── VU Meter ────────────────────────────────────────────────────────────────

function VUMeter({ level, muted }: { level: number; muted: boolean }) {
  const [animated, setAnimated] = useState(level);

  useEffect(() => {
    if (muted) {
      setAnimated(0);
      return;
    }
    let frame: number;
    let tick = 0;
    const animate = () => {
      tick++;
      const noise =
        Math.sin(tick * 0.23) * 0.08 + Math.cos(tick * 0.41) * 0.05;
      setAnimated(Math.max(0, Math.min(1, level + noise)));
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [level, muted]);

  const segments = 20;
  const lit = Math.round(animated * segments);

  return (
    <div className="flex gap-0.5 w-full justify-center" style={{ height: '100%' }}>
      {[0, 1].map((ch) => (
        <div key={ch} className="flex flex-col-reverse gap-px" style={{ width: 6 }}>
          {Array.from({ length: segments }).map((_, i) => {
            const active = i < lit;
            let segClass = 'vu-segment-green';
            if (i >= Math.floor(segments * 0.85)) segClass = 'vu-segment-red';
            else if (i >= Math.floor(segments * 0.65)) segClass = 'vu-segment-yellow';

            return (
              <div
                key={i}
                className={`rounded-sm transition-all duration-75 ${active ? segClass : ''}`}
                style={{
                  height: 4,
                  background: active ? undefined : 'rgba(255,255,255,0.04)',
                  boxShadow: active && i >= Math.floor(segments * 0.65)
                    ? '0 0 3px currentColor'
                    : 'none',
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Vertical Fader ──────────────────────────────────────────────────────────

interface FaderProps {
  value: number;
  onChange: (v: number) => void;
  height?: number;
}

function VerticalFader({ value, onChange, height = 120 }: FaderProps) {
  return (
    <div className="flex flex-col items-center relative" style={{ height }}>
      {/* Fader track background */}
      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full"
        style={{
          width: 4,
          top: 0,
          bottom: 0,
          background: 'linear-gradient(180deg, #1a1a2e, #0a0a14)',
          border: '1px solid #2a2a3e',
        }}
      />
      {/* 0 dB tick mark */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center pointer-events-none z-10"
        style={{ top: height * (1 - 0.75) - 1 }}
      >
        <div
          className="w-full h-px"
          style={{ background: 'rgba(255,140,0,0.4)' }}
        />
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="fader-vertical"
        style={{
          writingMode: 'vertical-lr' as React.CSSProperties['writingMode'],
          direction: 'rtl',
          WebkitAppearance: 'slider-vertical' as unknown as undefined,
          width: height,
          height: 24,
          transform: 'rotate(180deg)',
          cursor: 'pointer',
          accentColor: '#ff8c00',
        }}
      />
    </div>
  );
}

// ─── Channel Strip ────────────────────────────────────────────────────────────

interface ChannelStripProps {
  channel: MixerChannel;
  index: number;
  isMaster?: boolean;
  channelColor?: string;
}

function ChannelStrip({
  channel,
  index,
  isMaster = false,
  channelColor,
}: ChannelStripProps) {
  const updateMixerChannel = useDAWStore((s) => s.updateMixerChannel);

  const update = useCallback(
    (updates: Partial<MixerChannel>) =>
      updateMixerChannel(channel.id, updates),
    [channel.id, updateMixerChannel],
  );

  const stripWidth = isMaster ? 96 : 76;

  const accentColor = isMaster ? 'var(--daw-accent)' : (channelColor ?? '#444');

  return (
    <div
      className="flex flex-col items-center shrink-0 border-r border-white/5 relative overflow-hidden"
      style={{
        width: stripWidth,
        height: '100%',
        background: isMaster
          ? 'linear-gradient(180deg, #1e1630 0%, #120f20 100%)'
          : 'linear-gradient(180deg, #1e1e2e 0%, #14141e 100%)',
        boxShadow: 'inset 0 0 20px rgba(0,0,0,0.3)',
        borderLeft: isMaster ? '2px solid var(--daw-accent)' : undefined,
      }}
    >
      {/* Channel name row */}
      <div
        className="w-full px-1 py-1.5 border-b border-white/5 flex items-center justify-center gap-1"
        title={channel.name}
      >
        {/* Color dot */}
        {channelColor && !isMaster && (
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              backgroundColor: channelColor,
              boxShadow: `0 0 4px ${channelColor}`,
            }}
          />
        )}
        <p
          className="font-mono text-[9px] text-center truncate"
          style={{
            maxWidth: stripWidth - 20,
            color: isMaster ? '#ff8c00' : '#aaa',
            textShadow: isMaster ? '0 0 8px rgba(255,140,0,0.4)' : 'none',
          }}
        >
          {channel.name.toUpperCase()}
        </p>
      </div>

      {/* EQ section — only on non-master */}
      {!isMaster && (
        <div
          className="flex flex-col items-center gap-2 py-2 border-b border-white/5 w-full"
          style={{ background: 'rgba(0,0,0,0.15)' }}
        >
          <Knob
            value={channel.eq.low}
            min={-12}
            max={12}
            label="LOW"
            size="md"
            onChange={(v) => update({ eq: { ...channel.eq, low: v } })}
            formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
            isActive={channel.eq.low !== 0}
          />
          <Knob
            value={channel.eq.mid}
            min={-12}
            max={12}
            label="MID"
            size="md"
            onChange={(v) => update({ eq: { ...channel.eq, mid: v } })}
            formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
            isActive={channel.eq.mid !== 0}
          />
          <Knob
            value={channel.eq.high}
            min={-12}
            max={12}
            label="HIGH"
            size="md"
            onChange={(v) => update({ eq: { ...channel.eq, high: v } })}
            formatValue={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`}
            isActive={channel.eq.high !== 0}
          />
        </div>
      )}

      {/* Pan knob */}
      <div className="py-2 border-b border-white/5 w-full flex justify-center">
        <Knob
          value={channel.pan}
          min={-1}
          max={1}
          label="PAN"
          size="md"
          onChange={(v) => update({ pan: v })}
          formatValue={(v) =>
            v === 0
              ? 'C'
              : v < 0
              ? `L${Math.abs(Math.round(v * 100))}`
              : `R${Math.round(v * 100)}`
          }
          isActive={channel.pan !== 0}
        />
      </div>

      {/* VU Meter */}
      <div className="flex-1 w-full px-2 py-2 border-b border-white/5 overflow-hidden">
        <VUMeter
          level={channel.muted ? 0 : channel.volume}
          muted={channel.muted}
        />
      </div>

      {/* Volume fader */}
      <div className="py-2 border-b border-white/5 w-full flex flex-col items-center gap-1">
        <VerticalFader
          value={channel.volume}
          onChange={(v) => update({ volume: v })}
          height={100}
        />
        <span
          className="text-[9px] font-mono"
          style={{ color: accentColor }}
        >
          {channel.volume === 0
            ? '-∞'
            : `${Math.round(20 * Math.log10(channel.volume + 0.0001))} dB`}
        </span>
      </div>

      {/* Mute / Solo */}
      {!isMaster && (
        <div className="flex gap-1 py-1.5 border-b border-white/5">
          <button
            onClick={() => update({ muted: !channel.muted })}
            className="w-7 h-5 rounded text-[9px] font-mono font-bold transition-all focus:outline-none"
            style={{
              background: channel.muted
                ? '#cc3333'
                : 'rgba(255,255,255,0.06)',
              color: channel.muted ? '#fff' : '#555',
              boxShadow: channel.muted
                ? '0 0 6px rgba(204,51,51,0.5)'
                : 'none',
            }}
            title="Mute"
          >
            M
          </button>
          <button
            onClick={() => update({ solo: !channel.solo })}
            className="w-7 h-5 rounded text-[9px] font-mono font-bold transition-all focus:outline-none"
            style={{
              background: channel.solo
                ? '#ffbb00'
                : 'rgba(255,255,255,0.06)',
              color: channel.solo ? '#000' : '#555',
              boxShadow: channel.solo
                ? '0 0 6px rgba(255,187,0,0.5)'
                : 'none',
            }}
            title="Solo"
          >
            S
          </button>
        </div>
      )}

      {/* Channel number */}
      <div className="py-1 w-full flex justify-center">
        <span
          className="text-[9px] font-mono"
          style={{ color: isMaster ? '#ff8c00' : '#444' }}
        >
          {isMaster ? 'MST' : String(index + 1).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
}

// ─── Mixer ────────────────────────────────────────────────────────────────────

export default function Mixer() {
  const { mixerChannels, masterVolume, setMasterVolume, getActivePattern } =
    useDAWStore();

  const activePattern = getActivePattern();

  const regularChannels = mixerChannels.filter((c) => c.id !== 'master');
  const masterChannel = mixerChannels.find((c) => c.id === 'master');

  // Build a lookup: linkedChannelId -> channel color from the active pattern
  const channelColorMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    if (activePattern) {
      for (const ch of activePattern.channels) {
        map[ch.id] = ch.color;
      }
    }
    return map;
  }, [activePattern]);

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden font-mono"
      style={{ background: '#0a0a12' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 shrink-0 border-b border-white/10"
        style={{
          height: 32,
          background: `linear-gradient(90deg, var(--daw-panel) 0%, var(--daw-bg) 100%)`,
          borderLeft: '4px solid var(--daw-accent)',
        }}
      >
        <span
          className="font-mono text-xs font-bold tracking-widest neon-accent"
        >
          MIXER
        </span>
        <div className="flex items-center gap-3">
          <span className="text-white/40 text-[10px] tracking-wider">
            MASTER VOL
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
            className="w-28 h-1.5 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: 'var(--daw-accent)' }}
          />
          <span className="text-[10px] font-mono w-12 text-right" style={{ color: 'var(--daw-accent)' }}>
            {masterVolume === 0
              ? '-∞ dB'
              : `${Math.round(20 * Math.log10(masterVolume + 0.0001))} dB`}
          </span>
        </div>
      </div>

      {/* Channel strips area */}
      <div
        className="flex-1 flex flex-row overflow-x-auto overflow-y-hidden"
        style={{
          background:
            'linear-gradient(90deg, #0e0e1a 0%, #0a0a12 50%, #0e0e1a 100%)',
        }}
      >
        {/* Regular channels */}
        <div className="flex flex-row h-full">
          {regularChannels.map((ch, i) => (
            <ChannelStrip
              key={ch.id}
              channel={ch}
              index={i}
              channelColor={
                ch.linkedChannelId
                  ? channelColorMap[ch.linkedChannelId]
                  : undefined
              }
            />
          ))}
        </div>

        {/* Spacer with Send/Return placeholder */}
        <div
          className="flex-1 border-r border-white/5 flex flex-col items-center justify-center gap-2 min-w-[80px]"
          style={{ background: 'rgba(0,0,0,0.2)' }}
        >
          <div className="flex flex-col items-center gap-1">
            <span
              className="text-[8px] font-mono tracking-[0.2em] uppercase"
              style={{ color: 'rgba(255,255,255,0.12)' }}
            >
              SEND
            </span>
            <div
              className="w-px rounded-full"
              style={{ height: 32, background: 'rgba(255,255,255,0.06)' }}
            />
            <span
              className="text-[8px] font-mono tracking-[0.2em] uppercase"
              style={{ color: 'rgba(255,255,255,0.12)' }}
            >
              RETURN
            </span>
          </div>
        </div>

        {/* Master channel */}
        {masterChannel && (
          <div className="shrink-0 h-full">
            <ChannelStrip channel={masterChannel} index={-1} isMaster />
          </div>
        )}
      </div>
    </div>
  );
}
