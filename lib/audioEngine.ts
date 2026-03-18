'use client';

/**
 * Beat Forge Studio — AudioEngine
 * A singleton Tone.js audio engine for the browser DAW.
 *
 * Architecture:
 *   Synth → [Distortion?] → [Reverb?] → [Delay?] → Panner → Channel Gain → Master Gain → Tone.Destination
 *   Player (sample channels) → Panner → Channel Gain → Master Gain → Tone.Destination
 */

import { useEffect, useRef } from 'react';
import * as Tone from 'tone';
import { useDAWStore } from './store';
import type { AudioLatencyHint, AudioSampleRate } from './store';
import type { Channel, ChannelType, Note, Pattern } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a MIDI note number to frequency in Hz. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Clamp a value to [min, max]. */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Convert a linear 0-1 volume to decibels for Tone.js Gain nodes. */
function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

// ---------------------------------------------------------------------------
// Per-channel node bundle
// ---------------------------------------------------------------------------

type ToneSynth =
  | Tone.MembraneSynth
  | Tone.MetalSynth
  | Tone.NoiseSynth
  | Tone.Synth
  | Tone.FMSynth
  | Tone.AMSynth
  | Tone.PolySynth<Tone.Synth>
  | Tone.PolySynth<Tone.FMSynth>
  | Tone.PolySynth<Tone.AMSynth>;

interface ChannelNodes {
  synth: ToneSynth;
  player?: Tone.Player; // used when channel.type === 'sample'
  panner: Tone.Panner;
  gain: Tone.Gain;
  distortion?: Tone.Distortion;
  reverb?: Tone.Reverb;
  delay?: Tone.FeedbackDelay;
}

// ---------------------------------------------------------------------------
// AudioEngine singleton
// ---------------------------------------------------------------------------

class AudioEngine {
  private static _instance: AudioEngine | null = null;

  /** Returns the singleton instance (created lazily). */
  static getInstance(): AudioEngine {
    if (!AudioEngine._instance) {
      AudioEngine._instance = new AudioEngine();
    }
    return AudioEngine._instance;
  }

  // ---- internal state ----
  private masterGain: Tone.Gain | null = null;
  private channelNodes: Map<string, ChannelNodes> = new Map();
  /** Per-clip channel nodes for playlist mode — avoids shared-synth conflicts */
  private playlistClipNodes: Map<string, Map<string, ChannelNodes>> = new Map();
  private repeatId: number | null = null;
  private initialized = false;
  private storeUnsubscribers: Array<() => void> = [];
  private _mixerUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private _channelPropsUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pre-rendered Tone.Player instances for frozen channels — keyed by channel ID. */
  private frozenPlayers: Map<string, Tone.Player> = new Map();

  // ---- AudioWorklet step scheduler state ----
  /** The AudioWorkletNode for sample-accurate step scheduling (null if unsupported or failed to load). */
  private _workletNode: AudioWorkletNode | null = null;
  /** Whether the worklet scheduler is available and should be used instead of Tone.Transport. */
  private _useWorklet = false;
  /** Whether the worklet is currently running (started via message). */
  private _workletRunning = false;
  /** Playback mode: 'pattern' for channel rack, 'playlist' for playlist view. */
  private _playbackMode: 'pattern' | 'playlist' = 'pattern';
  /** Playlist-mode total steps (computed from clip arrangement). */
  private _playlistTotalSteps = 0;

  // Private constructor — use getInstance()
  private constructor() {}

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Initialize the engine. Safe to call multiple times; idempotent.
   * Sets up the audio graph and store subscriptions synchronously so they
   * are ready before the user's first interaction. The AudioContext is
   * unlocked lazily on first play (user gesture required).
   */
  async init(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (this.initialized) return;
    this.initialized = true; // Set early to prevent re-entry

    // Create a Tone.js context with user-configured latency and sample rate.
    // Tone.Context options don't expose sampleRate, so we create a raw
    // AudioContext with both latencyHint and sampleRate, then wrap it.
    const { audioLatency, audioSampleRate } = useDAWStore.getState();
    try {
      const rawCtx = new AudioContext({
        latencyHint: audioLatency,
        sampleRate: audioSampleRate,
      });
      const ctx = new Tone.Context(rawCtx);
      Tone.setContext(ctx);
    } catch (err) {
      console.warn('[AudioEngine] Failed to create custom context, using default:', err);
    }

    // Tune scheduling for dense step-sequencer patterns
    Tone.getContext().lookAhead = 0.1; // 100ms lookahead (default 0.05)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Tone.getContext() as any).updateInterval = 0.05; // 50ms update cycle

    // Master gain node — works even while AudioContext is suspended
    this.masterGain = new Tone.Gain(
      Tone.dbToGain(linearToDb(useDAWStore.getState().masterVolume))
    ).toDestination();

    // Set transport BPM
    Tone.getTransport().bpm.value = useDAWStore.getState().bpm;

    // Seed synths for the active pattern's channels
    const pattern = useDAWStore.getState().getActivePattern();
    if (pattern) {
      this.syncChannels(pattern.channels);
    }

    // Subscribe to store changes — MUST happen before any user interaction
    this._subscribeToStore();

    // Attempt to initialize the AudioWorklet step scheduler (non-blocking).
    // Falls back to Tone.Transport if this fails.
    await this._initWorkletScheduler();

    // Edge case: if isPlaying was set before subscriptions existed, start now
    if (useDAWStore.getState().isPlaying) {
      this._transportStart();
    }

    // Attempt early AudioContext unlock (non-blocking, non-fatal)
    Tone.start().catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Audio context reinit with new settings
  // ---------------------------------------------------------------------------

  /**
   * Reinitialise the audio context with new latency / sample-rate settings.
   * Stops playback, disposes all nodes, creates a fresh Tone.Context, then
   * rebuilds the audio graph. This is called when the user changes audio
   * settings from the UI.
   */
  async reinitWithSettings(latency: AudioLatencyHint, sampleRate: AudioSampleRate): Promise<void> {
    if (typeof window === 'undefined') return;

    // Stop playback if running
    const wasPlaying = useDAWStore.getState().isPlaying;
    if (wasPlaying) {
      useDAWStore.getState().stop();
    }

    // Tear down existing transport repeat
    const transport = Tone.getTransport();
    if (this.repeatId !== null) {
      transport.clear(this.repeatId);
      this.repeatId = null;
    }
    transport.stop();
    transport.position = 0;

    // Dispose all channel nodes
    for (const nodes of Array.from(this.channelNodes.values())) {
      this._disposeChannelNodes(nodes);
    }
    this.channelNodes.clear();
    this._disposePlaylistClipNodes();

    // Dispose master gain
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain.dispose();
      this.masterGain = null;
    }

    // Dispose the worklet node if present
    if (this._workletNode) {
      try {
        this._workletNode.port.postMessage({ type: 'stop' });
        this._workletNode.disconnect();
      } catch { /* non-fatal */ }
      this._workletNode = null;
      this._useWorklet = false;
      this._workletRunning = false;
    }

    // Close the old context and create a new one with a raw AudioContext
    try {
      const oldCtx = Tone.getContext();
      const rawCtx = new AudioContext({
        latencyHint: latency,
        sampleRate: sampleRate,
      });
      const newCtx = new Tone.Context(rawCtx);
      Tone.setContext(newCtx);
      // Dispose old context after switching
      try { await (oldCtx.rawContext as AudioContext).close(); } catch { /* non-fatal */ }
      oldCtx.dispose();
    } catch (err) {
      console.warn('[AudioEngine] Failed to create new context, continuing with current:', err);
    }

    // Re-tune scheduling
    Tone.getContext().lookAhead = 0.1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Tone.getContext() as any).updateInterval = 0.05;

    // Rebuild master gain
    this.masterGain = new Tone.Gain(
      Tone.dbToGain(linearToDb(useDAWStore.getState().masterVolume))
    ).toDestination();

    // Set transport BPM
    Tone.getTransport().bpm.value = useDAWStore.getState().bpm;

    // Rebuild channel synths
    const pattern = useDAWStore.getState().getActivePattern();
    if (pattern) {
      this.syncChannels(pattern.channels);
    }

    // Re-initialize the AudioWorklet scheduler with the new context
    await this._initWorkletScheduler();

    // Unlock new context
    Tone.start().catch(() => {});

    console.info(`[AudioEngine] Reinitialised — latency: ${latency}, sampleRate: ${sampleRate}`);
  }

  // ---------------------------------------------------------------------------
  // AudioWorklet step scheduler
  // ---------------------------------------------------------------------------

  /**
   * Attempt to register and instantiate the AudioWorklet-based step scheduler.
   * The worklet processor file lives at /audio-worklet/step-scheduler-processor.js
   * and is served as a static asset by Next.js from the public/ directory.
   *
   * If AudioWorklet is not supported or the module fails to load, the engine
   * falls back to the existing Tone.Transport.scheduleRepeat approach.
   */
  private async _initWorkletScheduler(): Promise<void> {
    try {
      // Check if AudioWorklet is supported in this browser
      const rawCtx = Tone.getContext().rawContext;
      if (!rawCtx || !('audioWorklet' in rawCtx)) {
        console.info('[AudioEngine] AudioWorklet not supported — using Tone.Transport fallback.');
        return;
      }

      // Register the worklet processor module
      await (rawCtx as AudioContext).audioWorklet.addModule('/audio-worklet/step-scheduler-processor.js');

      // Create the AudioWorkletNode
      this._workletNode = new AudioWorkletNode(rawCtx as AudioContext, 'step-scheduler-processor');

      // Connect the worklet node so it processes (it doesn't produce audio, but it
      // needs to be in the graph to keep its process() method called).
      // Connect to the raw AudioContext destination so it stays alive.
      this._workletNode.connect((rawCtx as AudioContext).destination);

      // Listen for step messages from the worklet
      this._workletNode.port.onmessage = (event: MessageEvent) => {
        const data = event.data;
        if (data.type === 'step') {
          this._onWorkletStep(data.step);
        } else if (data.type === 'stopped') {
          this._workletRunning = false;
        }
      };

      // Set initial BPM
      this._workletNode.port.postMessage({
        type: 'setBpm',
        bpm: useDAWStore.getState().bpm,
      });

      this._useWorklet = true;
      console.info('[AudioEngine] AudioWorklet step scheduler initialized successfully.');
    } catch (err) {
      console.warn('[AudioEngine] Failed to initialize AudioWorklet scheduler — using Tone.Transport fallback:', err);
      this._workletNode = null;
      this._useWorklet = false;
    }
  }

  /**
   * Handle a step message from the AudioWorklet processor.
   * This runs on the main thread — triggered by the worklet's port.postMessage.
   * We use Tone.now() for the audio time and Tone.getDraw().schedule() for UI updates.
   */
  private _onWorkletStep(step: number): void {
    const time = Tone.now();

    if (this._playbackMode === 'playlist') {
      this._onWorkletPlaylistStep(step, time);
    } else {
      this._onWorkletPatternStep(step, time);
    }
  }

  /**
   * Pattern-mode worklet step handler. Fires channels from the active pattern.
   */
  private _onWorkletPatternStep(step: number, time: number): void {
    // Sync UI step indicator via draw callback
    Tone.getDraw().schedule(() => {
      useDAWStore.getState().setCurrentStep(step);
    }, time);

    const state = useDAWStore.getState();
    const pattern = state.getActivePattern();
    if (!pattern) return;

    const channels = pattern.channels;
    const hasSolo = channels.some((c) => c.solo);

    for (const channel of channels) {
      if (channel.muted) continue;
      if (hasSolo && !channel.solo) continue;
      if (!channel.steps[step]) continue;

      this._triggerChannel(channel, step, pattern, time);
    }
  }

  /**
   * Playlist-mode worklet step handler. The worklet sends wrapped step indices
   * (0..totalSteps-1). We map these to global playlist steps and trigger clips.
   */
  private _onWorkletPlaylistStep(step: number, time: number): void {
    // The worklet's step IS our global step since we set totalSteps = playlistTotalSteps
    const globalStep = step;

    if (globalStep >= this._playlistTotalSteps) {
      // Arrangement ended — stop playback
      Tone.getDraw().schedule(() => {
        useDAWStore.getState().stop();
      }, time);
      return;
    }

    // Sync UI
    Tone.getDraw().schedule(() => {
      useDAWStore.getState().setPlaylistStep(globalStep);
    }, time);

    const state = useDAWStore.getState();
    const globalBar = Math.floor(globalStep / 16);
    const stepInBar = globalStep % 16;

    for (const clip of state.playlistClips) {
      if (globalBar < clip.startBar || globalBar >= clip.startBar + clip.lengthBars) continue;

      const pattern = state.patterns.find(p => p.id === clip.patternId);
      if (!pattern) continue;

      const patternTotalSteps = (pattern.bars ?? 1) * 16;
      const barInPattern = globalBar - clip.startBar;
      const stepInPattern = (barInPattern * 16 + stepInBar) % patternTotalSteps;

      const hasSolo = pattern.channels.some(c => c.solo);
      const clipNodes = this.playlistClipNodes.get(clip.id);

      for (const channel of pattern.channels) {
        if (channel.muted) continue;
        if (hasSolo && !channel.solo) continue;
        if (!channel.steps[stepInPattern]) continue;

        const nodes = clipNodes?.get(channel.id);
        if (nodes) {
          this._triggerChannelWithNodes(channel, stepInPattern, pattern, time, nodes);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Store subscriptions
  // ---------------------------------------------------------------------------

  private _subscribeToStore(): void {
    // isPlaying
    const unsubPlaying = useDAWStore.subscribe(
      (s) => s.isPlaying,
      (isPlaying) => {
        if (isPlaying) {
          this._transportStart();
        } else {
          this._transportStop();
        }
      }
    );

    // bpm
    const unsubBpm = useDAWStore.subscribe(
      (s) => s.bpm,
      (bpm) => {
        this.setBpm(bpm);
      }
    );

    // masterVolume
    const unsubVolume = useDAWStore.subscribe(
      (s) => s.masterVolume,
      (vol) => {
        this.setMasterVolume(vol);
      }
    );

    // mixerChannels — debounced sync to avoid gain-ramp storms during playback
    const unsubMixer = useDAWStore.subscribe(
      (s) => s.mixerChannels,
      (mixerChannels) => {
        if (this._mixerUpdateTimer) clearTimeout(this._mixerUpdateTimer);
        this._mixerUpdateTimer = setTimeout(() => {
          for (const mc of mixerChannels) {
            if (!mc.linkedChannelId) continue;
            const vol = mc.muted ? 0 : mc.volume;
            this.updateChannelVolume(mc.linkedChannelId, vol);
            this.updateChannelPan(mc.linkedChannelId, mc.pan);
            this.updateChannelEq(mc.linkedChannelId, mc.eq);
          }
        }, 32);
      }
    );

    // Active pattern channels — sync audio nodes when channels are added/removed.
    // We derive a lightweight key (sorted channel IDs) so this only fires on
    // structural changes, NOT on every step toggle or volume tweak.
    const unsubChannels = useDAWStore.subscribe(
      (s) => {
        const p = s.patterns.find((pat) => pat.id === s.activePatternId);
        return p ? p.channels.map((c) => c.id).join(',') : '';
      },
      () => {
        const pattern = useDAWStore.getState().getActivePattern();
        if (pattern) {
          this.syncChannels(pattern.channels);
        }
      }
    );

    // Channel volume/pan/mute — debounced to batch rapid changes
    const unsubChannelProps = useDAWStore.subscribe(
      (s) => {
        const p = s.patterns.find((pat) => pat.id === s.activePatternId);
        if (!p) return '';
        return p.channels.map((c) => `${c.id}:${c.volume}:${c.pan}:${c.muted}:${c.solo}`).join('|');
      },
      () => {
        if (this._channelPropsUpdateTimer) clearTimeout(this._channelPropsUpdateTimer);
        this._channelPropsUpdateTimer = setTimeout(() => {
          const pattern = useDAWStore.getState().getActivePattern();
          if (!pattern) return;
          for (const ch of pattern.channels) {
            this.updateChannelVolume(ch.id, ch.muted ? 0 : ch.volume);
            this.updateChannelPan(ch.id, ch.pan);
          }
        }, 32);
      }
    );

    // audioLatency + audioSampleRate — reinit context when either changes
    const unsubAudioLatency = useDAWStore.subscribe(
      (s) => s.audioLatency,
      (latency) => {
        const sr = useDAWStore.getState().audioSampleRate;
        this.reinitWithSettings(latency, sr);
      }
    );

    const unsubAudioSampleRate = useDAWStore.subscribe(
      (s) => s.audioSampleRate,
      (sampleRate) => {
        const lat = useDAWStore.getState().audioLatency;
        this.reinitWithSettings(lat, sampleRate);
      }
    );

    this.storeUnsubscribers.push(unsubPlaying, unsubBpm, unsubVolume, unsubMixer, unsubChannels, unsubChannelProps, unsubAudioLatency, unsubAudioSampleRate);
  }

  // ---------------------------------------------------------------------------
  // Synth creation
  // ---------------------------------------------------------------------------

  /**
   * Build a Tone.js synth appropriate for the channel type and instrument
   * settings. Returns the synth disconnected — caller must connect it to a
   * signal chain.
   *
   * For 'sample' type channels, a fallback NoiseSynth is returned here;
   * the actual Tone.Player is set up separately via loadSampleForChannel().
   */
  createSynthForChannel(channel: Channel): ToneSynth {
    const inst = channel.instrument;
    const type = channel.type as ChannelType;

    // ---- Sample channel: return silent fallback NoiseSynth ----
    // The actual audio comes from the Tone.Player loaded in loadSampleForChannel.
    if (type === 'sample') {
      return new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: {
          attack: 0.001,
          decay: 0.001,
          sustain: 0,
          release: 0.001,
        },
        volume: -Infinity, // silent — player handles audio
      });
    }

    // ---- Percussion: kick / perc → MembraneSynth ----
    if (type === 'kick' || type === 'perc' || inst.synthType === 'membrane') {
      return new Tone.MembraneSynth({
        pitchDecay: clamp(inst.decay ?? 0.05, 0.001, 1),
        octaves: 6,
        envelope: {
          attack: clamp(inst.attack ?? 0.001, 0.0001, 1),
          decay: clamp(inst.decay ?? 0.3, 0.001, 4),
          sustain: clamp(inst.sustain ?? 0, 0, 1),
          release: clamp(inst.release ?? 0.1, 0.001, 4),
        },
        // pitchDecay controls the descending pitch sweep — pitchHz is triggered at play time
        volume: 0,
      });
    }

    // ---- Percussion: hihat / openhat → MetalSynth ----
    if (type === 'hihat' || type === 'openhat' || inst.synthType === 'metal') {
      const decayTime = type === 'openhat'
        ? clamp(inst.decay ?? 0.5, 0.01, 2)
        : clamp(inst.decay ?? 0.1, 0.01, 0.5);
      return new Tone.MetalSynth({
        envelope: {
          attack: clamp(inst.attack ?? 0.001, 0.0001, 0.1),
          decay: decayTime,
          release: clamp(inst.release ?? 0.01, 0.001, 1),
        },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5,
        volume: 0,
      });
    }

    // ---- Percussion: snare / clap → NoiseSynth ----
    if (type === 'snare' || type === 'clap' || inst.synthType === 'noise') {
      return new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: {
          attack: clamp(inst.attack ?? 0.001, 0.0001, 0.1),
          decay: clamp(inst.decay ?? 0.2, 0.01, 1),
          sustain: 0,
          release: clamp(inst.release ?? 0.05, 0.001, 1),
        },
        volume: 0,
      });
    }

    // ---- Tonal: FMSynth (PolySynth for overlapping notes) ----
    if (inst.synthType === 'fm') {
      const poly = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 10,
        oscillator: { type: 'sine' },
        envelope: {
          attack: clamp(inst.attack ?? 0.01, 0.0001, 2),
          decay: clamp(inst.decay ?? 0.2, 0.001, 4),
          sustain: clamp(inst.sustain ?? 0.5, 0, 1),
          release: clamp(inst.release ?? 0.5, 0.001, 4),
        },
        modulation: { type: 'square' },
        modulationEnvelope: {
          attack: 0.002,
          decay: 0.2,
          sustain: 0.3,
          release: 0.01,
        },
      });
      poly.maxPolyphony = 6;
      poly.volume.value = 0;
      return poly;
    }

    // ---- Tonal: AMSynth (PolySynth for overlapping notes) ----
    if (inst.synthType === 'am') {
      const poly = new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 2,
        oscillator: { type: 'sine' },
        envelope: {
          attack: clamp(inst.attack ?? 0.01, 0.0001, 2),
          decay: clamp(inst.decay ?? 0.2, 0.001, 4),
          sustain: clamp(inst.sustain ?? 0.5, 0, 1),
          release: clamp(inst.release ?? 0.5, 0.001, 4),
        },
        modulation: { type: 'square' },
        modulationEnvelope: {
          attack: 0.5,
          decay: 0,
          sustain: 1,
          release: 0.5,
        },
      });
      poly.maxPolyphony = 6;
      poly.volume.value = 0;
      return poly;
    }

    // ---- Default tonal: Synth (PolySynth — sawtooth for bass, sine for sub808, triangle for others) ----
    const oscType: OscillatorType = type === 'bass' ? 'sawtooth' : type === 'sub808' ? 'sine' : 'triangle';
    const poly = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: oscType },
      envelope: {
        attack: clamp(inst.attack ?? 0.01, 0.0001, 2),
        decay: clamp(inst.decay ?? 0.2, 0.001, 4),
        sustain: clamp(inst.sustain ?? 0.5, 0, 1),
        release: clamp(inst.release ?? 0.5, 0.001, 4),
      },
    });
    poly.maxPolyphony = 6;
    poly.volume.value = 0;
    return poly;
  }

  // ---------------------------------------------------------------------------
  // Sample loading
  // ---------------------------------------------------------------------------

  /**
   * Load the audio file at channel.sampleUrl into a Tone.Player and wire it
   * into the channel's existing panner → gain → master chain.
   * No-op if the channel has no sampleUrl or no registered nodes.
   */
  async loadSampleForChannel(channel: Channel): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!channel.sampleUrl) return;
    if (!this.masterGain) return;

    const nodes = this.channelNodes.get(channel.id);
    if (!nodes) return;

    // Dispose any previously loaded player for this channel
    if (nodes.player) {
      try {
        nodes.player.stop();
        nodes.player.disconnect();
        nodes.player.dispose();
      } catch {
        // Non-fatal
      }
      nodes.player = undefined;
    }

    try {
      const player = new Tone.Player({
        url: channel.sampleUrl,
        loop: false,
        autostart: false,
      });

      // Connect player directly: player → panner → gain → master
      // (bypasses the synth effects chain intentionally for sample channels)
      player.connect(nodes.panner);

      // Wait for the buffer to load
      await player.load(channel.sampleUrl);

      nodes.player = player;
    } catch (err) {
      console.error(`[AudioEngine] Failed to load sample for channel "${channel.name}":`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Signal chain construction
  // ---------------------------------------------------------------------------

  private _buildChannelSignalChain(channel: Channel): ChannelNodes {
    if (!this.masterGain) {
      throw new Error('[AudioEngine] Master gain not initialized');
    }

    const inst = channel.instrument;
    const synth = this.createSynthForChannel(channel);

    // Gain (channel volume)
    const gain = new Tone.Gain(Tone.dbToGain(linearToDb(channel.volume)));

    // Panner
    const panner = new Tone.Panner(clamp(channel.pan, -1, 1));

    // Optional effects
    let distortion: Tone.Distortion | undefined;
    let reverb: Tone.Reverb | undefined;
    let delay: Tone.FeedbackDelay | undefined;

    if ((inst.distortion ?? 0) > 0) {
      distortion = new Tone.Distortion(clamp(inst.distortion!, 0, 1));
    }
    if ((inst.reverb ?? 0) > 0) {
      reverb = new Tone.Reverb({
        decay: 1 + clamp(inst.reverb!, 0, 1) * 4, // 1–5 s
        wet: clamp(inst.reverb!, 0, 1),
      });
    }
    if ((inst.delay ?? 0) > 0) {
      delay = new Tone.FeedbackDelay({
        delayTime: '8n',
        feedback: clamp(inst.delay! * 0.5, 0, 0.9),
        wet: clamp(inst.delay!, 0, 1),
      });
    }

    // Wire up chain: synth → [dist?] → [reverb?] → [delay?] → panner → gain → master
    let current: Tone.ToneAudioNode = synth as unknown as Tone.ToneAudioNode;

    if (distortion) {
      (current as Tone.ToneAudioNode).connect(distortion);
      current = distortion;
    }
    if (reverb) {
      (current as Tone.ToneAudioNode).connect(reverb);
      current = reverb;
    }
    if (delay) {
      (current as Tone.ToneAudioNode).connect(delay);
      current = delay;
    }

    (current as Tone.ToneAudioNode).connect(panner);
    panner.connect(gain);
    gain.connect(this.masterGain);

    return { synth, panner, gain, distortion, reverb, delay };
  }

  // ---------------------------------------------------------------------------
  // Channel management
  // ---------------------------------------------------------------------------

  /**
   * Synchronise the engine's internal synth map with the provided channel
   * list. New channels get synths created; removed channels get disposed.
   * Existing channels have their volume/pan updated without full recreation.
   * Sample channels also have their Tone.Player loaded asynchronously.
   */
  syncChannels(channels: Channel[]): void {
    if (typeof window === 'undefined') return;
    if (!this.masterGain) return;

    const incoming = new Set(channels.map((c) => c.id));

    // Dispose channels that are no longer present
    for (const [id, nodes] of Array.from(this.channelNodes.entries())) {
      if (!incoming.has(id)) {
        this._disposeChannelNodes(nodes);
        this.channelNodes.delete(id);
      }
    }

    // Create / update each channel
    for (const channel of channels) {
      if (this.channelNodes.has(channel.id)) {
        // Already exists — just refresh volume / pan (cheap update)
        this.updateChannelVolume(channel.id, channel.volume);
        this.updateChannelPan(channel.id, channel.pan);

        // If this is a sample channel with a URL and no player yet, load it
        if (channel.type === 'sample' && channel.sampleUrl) {
          const nodes = this.channelNodes.get(channel.id);
          if (nodes && !nodes.player) {
            this.loadSampleForChannel(channel).catch((err) =>
              console.error(`[AudioEngine] loadSampleForChannel failed for "${channel.name}":`, err)
            );
          }
        }
      } else {
        // Brand new channel
        try {
          const nodes = this._buildChannelSignalChain(channel);
          this.channelNodes.set(channel.id, nodes);

          // Kick off async sample load for sample-type channels
          if (channel.type === 'sample' && channel.sampleUrl) {
            this.loadSampleForChannel(channel).catch((err) =>
              console.error(`[AudioEngine] loadSampleForChannel failed for "${channel.name}":`, err)
            );
          }
        } catch (err) {
          console.error(`[AudioEngine] Failed to build channel "${channel.name}":`, err);
        }
      }
    }
  }

  /** Rebuild the synth for a single channel (e.g. after instrument settings change). */
  rebuildChannel(channel: Channel): void {
    if (typeof window === 'undefined') return;
    if (!this.masterGain) return;

    const old = this.channelNodes.get(channel.id);
    if (old) {
      this._disposeChannelNodes(old);
      this.channelNodes.delete(channel.id);
    }

    try {
      const nodes = this._buildChannelSignalChain(channel);
      this.channelNodes.set(channel.id, nodes);

      // Re-load sample if applicable
      if (channel.type === 'sample' && channel.sampleUrl) {
        this.loadSampleForChannel(channel).catch((err) =>
          console.error(`[AudioEngine] loadSampleForChannel failed for "${channel.name}":`, err)
        );
      }
    } catch (err) {
      console.error(`[AudioEngine] Failed to rebuild channel "${channel.name}":`, err);
    }
  }

  private _disposeChannelNodes(nodes: ChannelNodes): void {
    try {
      // Dispose sample player if present
      if (nodes.player) {
        try {
          nodes.player.stop();
        } catch {
          // already stopped
        }
        nodes.player.disconnect();
        nodes.player.dispose();
        nodes.player = undefined;
      }

      nodes.synth.disconnect();
      nodes.synth.dispose();
      nodes.panner.disconnect();
      nodes.panner.dispose();
      nodes.gain.disconnect();
      nodes.gain.dispose();
      nodes.distortion?.disconnect();
      nodes.distortion?.dispose();
      nodes.reverb?.disconnect();
      nodes.reverb?.dispose();
      nodes.delay?.disconnect();
      nodes.delay?.dispose();
    } catch (err) {
      // Disposal errors are non-fatal
      console.warn('[AudioEngine] Error during node disposal:', err);
    }
  }

  /** Update the channel Gain node volume (0-1 linear). */
  updateChannelVolume(id: string, volume: number): void {
    const nodes = this.channelNodes.get(id);
    if (!nodes) return;
    nodes.gain.gain.rampTo(
      Tone.dbToGain(linearToDb(clamp(volume, 0, 1))),
      0.03
    );
  }

  /** Update the channel Panner value (-1 to 1). */
  updateChannelPan(id: string, pan: number): void {
    const nodes = this.channelNodes.get(id);
    if (!nodes) return;
    nodes.panner.pan.rampTo(clamp(pan, -1, 1), 0.03);
  }

  /** Update the channel EQ bands — no-op until Tone.EQ3 is available in the installed version. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateChannelEq(_id: string, _eq: { low: number; mid: number; high: number }): void {
    // Tone.EQ3 is not exported by tone/build/esm in the installed version.
    // EQ knobs are stored in the store but do not affect audio until this is resolved.
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  private _transportStart(): void {
    if (typeof window === 'undefined') return;

    const state = useDAWStore.getState();

    // If activeView is 'playlist', use playlist playback mode
    if (state.activeView === 'playlist') {
      this._transportStartPlaylist();
      return;
    }

    // ---- AudioWorklet path: sample-accurate step scheduling on the audio thread ----
    if (this._useWorklet && this._workletNode) {
      Tone.start().then(() => {
        this._playbackMode = 'pattern';

        const activePattern = useDAWStore.getState().getActivePattern();
        const totalSteps = (activePattern?.bars ?? 1) * 16;

        // Tell the worklet the total steps and BPM, then start
        this._workletNode!.port.postMessage({ type: 'setTotalSteps', totalSteps });
        this._workletNode!.port.postMessage({ type: 'setBpm', bpm: useDAWStore.getState().bpm });
        this._workletNode!.port.postMessage({ type: 'start' });
        this._workletRunning = true;
      }).catch((err) =>
        console.warn('[AudioEngine] Tone.start() error (worklet pattern):', err)
      );
      return;
    }

    // ---- Fallback: Tone.Transport.scheduleRepeat ----
    // Await context unlock BEFORE starting transport so audio actually plays
    Tone.start().then(() => {
      const transport = Tone.getTransport();

      // Clear any previously scheduled repeats
      if (this.repeatId !== null) {
        transport.clear(this.repeatId);
        this.repeatId = null;
      }

      let stepIndex = 0;

      this.repeatId = transport.scheduleRepeat(
        (time: number) => {
          const activePattern = useDAWStore.getState().getActivePattern();
          const totalSteps = (activePattern?.bars ?? 1) * 16;
          this._onStep(stepIndex, time);
          stepIndex = (stepIndex + 1) % totalSteps;
        },
        '16n'
      );

      transport.start();
    }).catch((err) =>
      console.warn('[AudioEngine] Tone.start() error:', err)
    );
  }

  /**
   * Build dedicated channel nodes for each playlist clip so overlapping clips
   * that reference the same pattern get independent synth instances.
   */
  private _syncPlaylistClipNodes(): void {
    if (!this.masterGain) return;

    const state = useDAWStore.getState();
    const activeClipIds = new Set(state.playlistClips.map(c => c.id));

    // Dispose nodes for clips that no longer exist
    for (const [clipId, channelMap] of Array.from(this.playlistClipNodes.entries())) {
      if (!activeClipIds.has(clipId)) {
        for (const nodes of channelMap.values()) {
          this._disposeChannelNodes(nodes);
        }
        this.playlistClipNodes.delete(clipId);
      }
    }

    // Build nodes for each clip's channels
    for (const clip of state.playlistClips) {
      const pattern = state.patterns.find(p => p.id === clip.patternId);
      if (!pattern) continue;

      let clipMap = this.playlistClipNodes.get(clip.id);
      if (!clipMap) {
        clipMap = new Map();
        this.playlistClipNodes.set(clip.id, clipMap);
      }

      for (const channel of pattern.channels) {
        if (clipMap.has(channel.id)) continue; // already built
        try {
          const nodes = this._buildChannelSignalChain(channel);
          clipMap.set(channel.id, nodes);

          if (channel.type === 'sample' && channel.sampleUrl) {
            this.loadSampleForChannel(channel).catch(() => {});
          }
        } catch (err) {
          console.error(`[AudioEngine] Failed to build playlist clip channel "${channel.name}":`, err);
        }
      }
    }
  }

  /** Dispose all playlist clip nodes. */
  private _disposePlaylistClipNodes(): void {
    for (const channelMap of this.playlistClipNodes.values()) {
      for (const nodes of channelMap.values()) {
        this._disposeChannelNodes(nodes);
      }
    }
    this.playlistClipNodes.clear();
  }

  /**
   * Playlist playback mode: walks through the arrangement timeline bar-by-bar,
   * triggering channels from all active clips at each step.
   */
  private _transportStartPlaylist(): void {
    const state = useDAWStore.getState();

    // Build per-clip channel nodes so overlapping clips don't share synths
    this._syncPlaylistClipNodes();

    // Find the end of the arrangement (last clip end bar)
    const lastBar = state.playlistClips.reduce(
      (max, c) => Math.max(max, c.startBar + c.lengthBars),
      0
    );
    if (lastBar === 0) {
      useDAWStore.getState().stop();
      return;
    }

    const totalPlaylistSteps = lastBar * 16;

    // ---- AudioWorklet path ----
    if (this._useWorklet && this._workletNode) {
      Tone.start().then(() => {
        this._playbackMode = 'playlist';
        this._playlistTotalSteps = totalPlaylistSteps;

        // Set total steps so the worklet counts from 0 to totalPlaylistSteps-1
        this._workletNode!.port.postMessage({ type: 'setTotalSteps', totalSteps: totalPlaylistSteps });
        this._workletNode!.port.postMessage({ type: 'setBpm', bpm: useDAWStore.getState().bpm });
        this._workletNode!.port.postMessage({ type: 'start' });
        this._workletRunning = true;
      }).catch((err) =>
        console.warn('[AudioEngine] Tone.start() error (worklet playlist):', err)
      );
      return;
    }

    // ---- Fallback: Tone.Transport.scheduleRepeat ----
    Tone.start().then(() => {
      const transport = Tone.getTransport();

      if (this.repeatId !== null) {
        transport.clear(this.repeatId);
        this.repeatId = null;
      }

      let globalStep = 0;

      this.repeatId = transport.scheduleRepeat(
        (time: number) => {
          if (globalStep >= totalPlaylistSteps) {
            Tone.getDraw().schedule(() => {
              useDAWStore.getState().stop();
            }, time);
            return;
          }

          this._onPlaylistStep(globalStep, time);
          globalStep++;
        },
        '16n'
      );

      transport.start();
    }).catch((err) =>
      console.warn('[AudioEngine] Tone.start() error (playlist):', err)
    );
  }

  /**
   * Playlist step handler: at each global step, find all active clips and
   * trigger the appropriate channels using per-clip nodes.
   */
  private _onPlaylistStep(globalStep: number, time: number): void {
    Tone.getDraw().schedule(() => {
      useDAWStore.getState().setPlaylistStep(globalStep);
    }, time);

    const state = useDAWStore.getState();
    const globalBar = Math.floor(globalStep / 16);
    const stepInBar = globalStep % 16;

    for (const clip of state.playlistClips) {
      if (globalBar < clip.startBar || globalBar >= clip.startBar + clip.lengthBars) continue;

      const pattern = state.patterns.find(p => p.id === clip.patternId);
      if (!pattern) continue;

      const patternTotalSteps = (pattern.bars ?? 1) * 16;
      const barInPattern = globalBar - clip.startBar;
      const stepInPattern = (barInPattern * 16 + stepInBar) % patternTotalSteps;

      const hasSolo = pattern.channels.some(c => c.solo);
      const clipNodes = this.playlistClipNodes.get(clip.id);

      for (const channel of pattern.channels) {
        if (channel.muted) continue;
        if (hasSolo && !channel.solo) continue;
        if (!channel.steps[stepInPattern]) continue;

        // Use per-clip nodes to avoid shared-synth conflicts
        const nodes = clipNodes?.get(channel.id);
        if (nodes) {
          this._triggerChannelWithNodes(channel, stepInPattern, pattern, time, nodes);
        }
      }
    }
  }

  /** Trigger a channel using specific nodes (for playlist per-clip isolation). */
  private _triggerChannelWithNodes(
    channel: Channel,
    stepIndex: number,
    pattern: Pattern,
    time: number,
    nodes: ChannelNodes
  ): void {
    // Sample playback
    if (nodes.player && nodes.player.loaded) {
      try {
        const offset = channel.sampleStart ?? 0;
        const end = channel.sampleEnd;
        const duration = (end != null && end > offset) ? end - offset : undefined;
        nodes.player.start(time, offset, duration);
      } catch (err) {
        console.warn(`[AudioEngine] player.start() failed for channel "${channel.name}":`, err);
      }
      return;
    }

    const { synth } = nodes;
    const type = channel.type as ChannelType;
    const isPercussion =
      type === 'kick' || type === 'snare' || type === 'clap' ||
      type === 'hihat' || type === 'openhat' || type === 'perc';

    if (type === 'sample') return;

    try {
      if (synth instanceof Tone.NoiseSynth) {
        try { synth.triggerRelease(time); } catch { /* may not be playing */ }
        synth.triggerAttackRelease('8n', time + 0.001);
      } else if (synth instanceof Tone.MembraneSynth) {
        try { synth.triggerRelease(time); } catch { /* may not be playing */ }
        const pitchHz = channel.instrument.pitch ?? (type === 'kick' ? 60 : 200);
        synth.triggerAttackRelease(pitchHz, '8n', time + 0.001);
      } else if (synth instanceof Tone.MetalSynth) {
        try { synth.triggerRelease(time); } catch { /* may not be playing */ }
        synth.triggerAttackRelease('16n', time + 0.001);
      } else if (isPercussion) {
        (synth as ToneSynth).triggerAttackRelease(midiToFreq(60), '16n', time);
      } else {
        const pianoNotes: Note[] = pattern.pianoRollNotes[channel.id] ?? [];
        const notesAtStep = pianoNotes.filter((n) => n.start === stepIndex);

        if (notesAtStep.length > 0) {
          for (const note of notesAtStep) {
            const freq = midiToFreq(note.pitch + (channel.instrument.tune ?? 0));
            const durNotation = this._sixteenthsToDuration(note.duration);
            (synth as ToneSynth).triggerAttackRelease(freq, durNotation, time, note.velocity);
          }
        } else {
          const midiBase = 60 + (channel.instrument.tune ?? 0);
          (synth as ToneSynth).triggerAttackRelease(midiToFreq(midiBase), '8n', time);
        }
      }
    } catch (err) {
      console.warn(`[AudioEngine] triggerAttackRelease failed for channel "${channel.name}":`, err);
    }
  }

  private _transportStop(): void {
    // Stop the AudioWorklet scheduler if it's running
    if (this._workletRunning && this._workletNode) {
      this._workletNode.port.postMessage({ type: 'stop' });
      this._workletRunning = false;
    }

    const transport = Tone.getTransport();

    if (this.repeatId !== null) {
      transport.clear(this.repeatId);
      this.repeatId = null;
    }

    transport.stop();
    transport.position = 0;

    // Clean up per-clip playlist nodes to free memory
    this._disposePlaylistClipNodes();

    useDAWStore.getState().setCurrentStep(0);
  }

  private _onStep(stepIndex: number, time: number): void {
    // Sync UI step indicator
    Tone.getDraw().schedule(() => {
      useDAWStore.getState().setCurrentStep(stepIndex);
    }, time);

    const state = useDAWStore.getState();
    const pattern = state.getActivePattern();
    if (!pattern) return;

    const channels = pattern.channels;
    const hasSolo = channels.some((c) => c.solo);

    for (const channel of channels) {
      if (channel.muted) continue;
      if (hasSolo && !channel.solo) continue;

      // Frozen channels: the pre-rendered buffer is triggered at step 0 only,
      // regardless of individual step states (they're baked into the buffer).
      if (channel.frozen) {
        if (stepIndex === 0) {
          this._triggerChannel(channel, stepIndex, pattern, time);
        }
        continue;
      }

      if (!channel.steps[stepIndex]) continue;

      this._triggerChannel(channel, stepIndex, pattern, time);
    }
  }

  private _triggerChannel(
    channel: Channel,
    stepIndex: number,
    pattern: Pattern,
    time: number
  ): void {
    const nodes = this.channelNodes.get(channel.id);
    if (!nodes) return;

    // Frozen channel: play the pre-rendered buffer instead of live synth.
    // The frozen buffer contains the entire pattern, so we trigger it once at step 0.
    if (channel.frozen) {
      const frozenPlayer = this.frozenPlayers.get(channel.id);
      if (frozenPlayer && frozenPlayer.loaded && stepIndex === 0) {
        try {
          try { frozenPlayer.stop(); } catch { /* may not be playing */ }
          frozenPlayer.start(time);
        } catch (err) {
          console.warn(`[AudioEngine] frozen player.start() failed for "${channel.name}":`, err);
        }
      }
      return;
    }

    // If this channel has a loaded Tone.Player (sample type), use it instead of synth
    if (nodes.player && nodes.player.loaded) {
      try {
        const offset = channel.sampleStart ?? 0;
        const end = channel.sampleEnd;
        const duration = (end != null && end > offset) ? end - offset : undefined;
        nodes.player.start(time, offset, duration);
      } catch (err) {
        console.warn(`[AudioEngine] player.start() failed for channel "${channel.name}":`, err);
      }
      return;
    }

    const { synth } = nodes;
    const type = channel.type as ChannelType;
    const isPercussion =
      type === 'kick' || type === 'snare' || type === 'clap' ||
      type === 'hihat' || type === 'openhat' || type === 'perc';

    // Skip triggering the silent fallback synth on sample channels
    // (player may still be loading — just skip this step)
    if (type === 'sample') return;

    try {
      if (synth instanceof Tone.NoiseSynth) {
        // Clean release before retrigger to prevent abrupt cuts
        try { synth.triggerRelease(time); } catch { /* may not be playing */ }
        synth.triggerAttackRelease('8n', time + 0.001);
      } else if (synth instanceof Tone.MembraneSynth) {
        try { synth.triggerRelease(time); } catch { /* may not be playing */ }
        const pitchHz = channel.instrument.pitch ?? (type === 'kick' ? 60 : 200);
        synth.triggerAttackRelease(pitchHz, '8n', time + 0.001);
      } else if (synth instanceof Tone.MetalSynth) {
        try { synth.triggerRelease(time); } catch { /* may not be playing */ }
        synth.triggerAttackRelease('16n', time + 0.001);
      } else if (isPercussion) {
        // Generic percussion fallback
        (synth as ToneSynth).triggerAttackRelease(
          midiToFreq(60),
          '16n',
          time
        );
      } else {
        // Tonal channel (PolySynth) — look for piano roll notes first
        const pianoNotes: Note[] = pattern.pianoRollNotes[channel.id] ?? [];
        const notesAtStep = pianoNotes.filter((n) => n.start === stepIndex);

        if (notesAtStep.length > 0) {
          for (const note of notesAtStep) {
            const freq = midiToFreq(note.pitch + (channel.instrument.tune ?? 0));
            const durNotation = this._sixteenthsToDuration(note.duration);
            (synth as ToneSynth).triggerAttackRelease(
              freq,
              durNotation,
              time,
              note.velocity
            );
          }
        } else {
          // Default: play middle C with semitone tune offset
          const midiBase = 60 + (channel.instrument.tune ?? 0);
          const freq = midiToFreq(midiBase);
          (synth as ToneSynth).triggerAttackRelease(
            freq,
            '8n',
            time
          );
        }
      }
    } catch (err) {
      console.warn(`[AudioEngine] triggerAttackRelease failed for channel "${channel.name}":`, err);
    }
  }

  /** Convert a duration expressed in 16th-note units to a Tone.js time string. */
  private _sixteenthsToDuration(sixteenths: number): string {
    if (sixteenths <= 0) return '16n';
    if (sixteenths === 1) return '16n';
    if (sixteenths === 2) return '8n';
    if (sixteenths === 4) return '4n';
    if (sixteenths === 8) return '2n';
    if (sixteenths === 16) return '1n';
    // Arbitrary: express as 16n multiples (Tone time multiplication syntax)
    return `${sixteenths * Tone.Time('16n').toSeconds()}`;
  }

  // ---------------------------------------------------------------------------
  // Track Freeze — offline rendering
  // ---------------------------------------------------------------------------

  /**
   * Pre-render a channel's step pattern to an AudioBuffer using Tone.OfflineContext.
   * Replicates the channel's synth type, envelope, and effects chain offline so
   * that during playback we play a simple buffer instead of live synthesis.
   */
  async renderChannelToBuffer(
    channel: Channel,
    bpm: number,
    totalSteps: number,
    pianoRollNotes: Note[] = []
  ): Promise<AudioBuffer> {
    const secondsPer16th = 60 / bpm / 4;
    const tailSeconds = 2;
    const totalDuration = totalSteps * secondsPer16th + tailSeconds;
    const sampleRate = 44100;
    const type = channel.type as ChannelType;
    const inst = channel.instrument;

    const offlineToneCtx = new Tone.OfflineContext(2, totalDuration, sampleRate);
    const prevCtx = Tone.getContext();
    Tone.setContext(offlineToneCtx);

    try {
      const synth = this.createSynthForChannel(channel);

      let distortion: Tone.Distortion | undefined;
      let reverb: Tone.Reverb | undefined;
      let delay: Tone.FeedbackDelay | undefined;

      if ((inst.distortion ?? 0) > 0) {
        distortion = new Tone.Distortion(clamp(inst.distortion!, 0, 1));
      }
      if ((inst.reverb ?? 0) > 0) {
        reverb = new Tone.Reverb({
          decay: 1 + clamp(inst.reverb!, 0, 1) * 4,
          wet: clamp(inst.reverb!, 0, 1),
        });
        await reverb.ready;
      }
      if ((inst.delay ?? 0) > 0) {
        delay = new Tone.FeedbackDelay({
          delayTime: '8n',
          feedback: clamp(inst.delay! * 0.5, 0, 0.9),
          wet: clamp(inst.delay!, 0, 1),
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let current: any = synth;
      if (distortion) { current.connect(distortion); current = distortion; }
      if (reverb) { current.connect(reverb); current = reverb; }
      if (delay) { current.connect(delay); current = delay; }
      (current as Tone.ToneAudioNode).toDestination();

      const isPercussion =
        type === 'kick' || type === 'snare' || type === 'clap' ||
        type === 'hihat' || type === 'openhat' || type === 'perc';

      for (let step = 0; step < totalSteps; step++) {
        if (!channel.steps[step]) continue;
        const time = step * secondsPer16th;
        if (type === 'sample') continue;

        if (synth instanceof Tone.NoiseSynth) {
          synth.triggerAttackRelease('8n', time + 0.001);
        } else if (synth instanceof Tone.MembraneSynth) {
          const pitchHz = inst.pitch ?? (type === 'kick' ? 60 : 200);
          synth.triggerAttackRelease(pitchHz, '8n', time + 0.001);
        } else if (synth instanceof Tone.MetalSynth) {
          synth.triggerAttackRelease('16n', time + 0.001);
        } else if (isPercussion) {
          (synth as ToneSynth).triggerAttackRelease(midiToFreq(60), '16n', time);
        } else {
          const notesAtStep = pianoRollNotes.filter((n) => n.start === step);
          if (notesAtStep.length > 0) {
            for (const note of notesAtStep) {
              const freq = midiToFreq(note.pitch + (inst.tune ?? 0));
              const durSec = note.duration * secondsPer16th;
              (synth as ToneSynth).triggerAttackRelease(freq, durSec, time, note.velocity);
            }
          } else {
            const midiBase = 60 + (inst.tune ?? 0);
            (synth as ToneSynth).triggerAttackRelease(midiToFreq(midiBase), '8n', time);
          }
        }
      }

      const renderedBuffer = await offlineToneCtx.render();
      synth.disconnect(); synth.dispose();
      distortion?.disconnect(); distortion?.dispose();
      reverb?.disconnect(); reverb?.dispose();
      delay?.disconnect(); delay?.dispose();
      return renderedBuffer as unknown as AudioBuffer;
    } finally {
      Tone.setContext(prevCtx);
    }
  }

  /**
   * Load a frozen buffer (blob URL) into a Tone.Player and wire it into
   * the channel's existing panner -> gain -> master chain.
   */
  async loadFrozenPlayer(channelId: string, blobUrl: string): Promise<void> {
    if (!this.masterGain) return;
    this.disposeFrozenPlayer(channelId);
    const nodes = this.channelNodes.get(channelId);
    if (!nodes) return;
    const player = new Tone.Player({ url: blobUrl, loop: false, autostart: false });
    await player.load(blobUrl);
    player.connect(nodes.panner);
    this.frozenPlayers.set(channelId, player);
  }

  /** Dispose a frozen player for the given channel. */
  disposeFrozenPlayer(channelId: string): void {
    const existing = this.frozenPlayers.get(channelId);
    if (existing) {
      try { existing.stop(); } catch { /* may not be playing */ }
      existing.disconnect();
      existing.dispose();
      this.frozenPlayers.delete(channelId);
    }
  }

  // ---------------------------------------------------------------------------
  // Public transport controls
  // ---------------------------------------------------------------------------

  /** Start playback. Also calls Tone.start() for Web Audio context unlock. */
  start(): void {
    if (typeof window === 'undefined') return;
    this._transportStart();
  }

  /** Stop playback and reset the step counter. */
  stop(): void {
    this._transportStop();
  }

  /** Set the sequencer BPM. */
  setBpm(bpm: number): void {
    const clampedBpm = clamp(bpm, 20, 400);
    Tone.getTransport().bpm.value = clampedBpm;

    // Also update the worklet scheduler if active
    if (this._workletNode) {
      this._workletNode.port.postMessage({ type: 'setBpm', bpm: clampedBpm });
    }
  }

  /** Set master output volume (0-1 linear). */
  setMasterVolume(volume: number): void {
    if (!this.masterGain) return;
    this.masterGain.gain.rampTo(
      Tone.dbToGain(linearToDb(clamp(volume, 0, 1))),
      0.05
    );
  }

  // ---------------------------------------------------------------------------
  // Piano roll preview
  // ---------------------------------------------------------------------------

  /**
   * Immediately trigger a note on the given channel's synth for preview.
   * Safe to call at any time without affecting the transport.
   */
  previewNote(
    channel: Channel,
    pitch: number,
    duration: string = '8n'
  ): void {
    if (typeof window === 'undefined') return;

    const nodes = this.channelNodes.get(channel.id);

    // For sample channels, preview via the player (respecting slice boundaries)
    if (channel.type === 'sample') {
      if (nodes?.player && nodes.player.loaded) {
        Tone.start().then(() => {
          try {
            const offset = channel.sampleStart ?? 0;
            const end = channel.sampleEnd;
            const dur = (end != null && end > offset) ? end - offset : undefined;
            nodes.player!.start(Tone.now(), offset, dur);
          } catch (err) {
            console.warn(`[AudioEngine] previewNote player.start() failed for "${channel.name}":`, err);
          }
        }).catch(() => {});
      }
      return;
    }

    if (!nodes) {
      // Channel not yet registered — build a temporary one-shot synth
      try {
        const tempNodes = this._buildChannelSignalChain(channel);
        this._triggerPreview(channel, tempNodes.synth, pitch, duration);
        // Schedule disposal after the note ends
        setTimeout(() => this._disposeChannelNodes(tempNodes), 5000);
      } catch (err) {
        console.warn('[AudioEngine] previewNote temp synth failed:', err);
      }
      return;
    }

    this._triggerPreview(channel, nodes.synth, pitch, duration);
  }

  private _triggerPreview(
    channel: Channel,
    synth: ToneSynth,
    pitch: number,
    duration: string
  ): void {
    try {
      Tone.start().then(() => {
        try {
          if (synth instanceof Tone.NoiseSynth) {
            synth.triggerAttackRelease(duration);
          } else if (synth instanceof Tone.MembraneSynth) {
            const pitchHz = channel.instrument.pitch ?? midiToFreq(pitch);
            synth.triggerAttackRelease(pitchHz, duration);
          } else if (synth instanceof Tone.MetalSynth) {
            synth.triggerAttackRelease(duration, Tone.now());
          } else {
            const freq = midiToFreq(pitch + (channel.instrument.tune ?? 0));
            (synth as ToneSynth).triggerAttackRelease(
              freq,
              duration
            );
          }
        } catch (inner) {
          console.warn(`[AudioEngine] previewNote inner trigger failed for "${channel.name}":`, inner);
        }
      }).catch((err) => {
        console.warn('[AudioEngine] Tone.start() in previewNote failed:', err);
      });
    } catch (err) {
      console.warn('[AudioEngine] previewNote failed:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Tear-down
  // ---------------------------------------------------------------------------

  /** Fully dispose of all audio nodes and unsubscribe from the store. */
  dispose(): void {
    this.stop();

    // Dispose the AudioWorklet node
    if (this._workletNode) {
      try {
        this._workletNode.port.postMessage({ type: 'stop' });
        this._workletNode.disconnect();
      } catch {
        // non-fatal
      }
      this._workletNode = null;
      this._useWorklet = false;
      this._workletRunning = false;
    }

    for (const nodes of Array.from(this.channelNodes.values())) {
      this._disposeChannelNodes(nodes);
    }
    this.channelNodes.clear();

    this._disposePlaylistClipNodes();

    // Dispose all frozen players
    for (const channelId of Array.from(this.frozenPlayers.keys())) {
      this.disposeFrozenPlayer(channelId);
    }

    this.masterGain?.disconnect();
    this.masterGain?.dispose();
    this.masterGain = null;

    for (const unsub of this.storeUnsubscribers) {
      unsub();
    }
    this.storeUnsubscribers = [];

    if (this._mixerUpdateTimer) clearTimeout(this._mixerUpdateTimer);
    if (this._channelPropsUpdateTimer) clearTimeout(this._channelPropsUpdateTimer);

    this.initialized = false;
    AudioEngine._instance = null;
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * `useAudioEngine()` — Returns the AudioEngine singleton and ensures it is
 * initialised exactly once per application lifetime. SSR-safe: no-ops on the
 * server.
 */
export function useAudioEngine(): AudioEngine {
  const engineRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const engine = AudioEngine.getInstance();
    engineRef.current = engine;

    // Initialise (idempotent — safe to call multiple times)
    engine.init().catch((err) => {
      console.error('[AudioEngine] init() failed:', err);
    });

    // No cleanup on unmount — the engine is a singleton that outlives
    // individual React components. Disposal is only done on explicit teardown.
  }, []);

  return AudioEngine.getInstance();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { AudioEngine };
export default AudioEngine;
