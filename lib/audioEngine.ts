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
  | Tone.AMSynth;

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
  private repeatId: number | null = null;
  private initialized = false;
  private storeUnsubscribers: Array<() => void> = [];

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

    // Edge case: if isPlaying was set before subscriptions existed, start now
    if (useDAWStore.getState().isPlaying) {
      this._transportStart();
    }

    // Attempt early AudioContext unlock (non-blocking, non-fatal)
    Tone.start().catch(() => {});
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

    // mixerChannels — sync volume/pan/mute/EQ to audio nodes when mixer changes
    const unsubMixer = useDAWStore.subscribe(
      (s) => s.mixerChannels,
      (mixerChannels) => {
        for (const mc of mixerChannels) {
          if (!mc.linkedChannelId) continue; // skip master (no linked channel)
          const vol = mc.muted ? 0 : mc.volume;
          this.updateChannelVolume(mc.linkedChannelId, vol);
          this.updateChannelPan(mc.linkedChannelId, mc.pan);
          this.updateChannelEq(mc.linkedChannelId, mc.eq);
        }
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

    // Channel volume/pan/mute — update audio nodes when these properties change.
    // Derives a lightweight key so step toggles (which don't touch vol/pan/mute)
    // don't trigger unnecessary updates.
    const unsubChannelProps = useDAWStore.subscribe(
      (s) => {
        const p = s.patterns.find((pat) => pat.id === s.activePatternId);
        if (!p) return '';
        return p.channels.map((c) => `${c.id}:${c.volume}:${c.pan}:${c.muted}:${c.solo}`).join('|');
      },
      () => {
        const pattern = useDAWStore.getState().getActivePattern();
        if (!pattern) return;
        for (const ch of pattern.channels) {
          this.updateChannelVolume(ch.id, ch.muted ? 0 : ch.volume);
          this.updateChannelPan(ch.id, ch.pan);
        }
      }
    );

    this.storeUnsubscribers.push(unsubPlaying, unsubBpm, unsubVolume, unsubMixer, unsubChannels, unsubChannelProps);
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

    // ---- Tonal: FMSynth ----
    if (inst.synthType === 'fm') {
      return new Tone.FMSynth({
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
        volume: 0,
      });
    }

    // ---- Tonal: AMSynth ----
    if (inst.synthType === 'am') {
      return new Tone.AMSynth({
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
        volume: 0,
      });
    }

    // ---- Default tonal: Synth (sawtooth for bass, sine for sub808, triangle for others) ----
    const oscType: OscillatorType = type === 'bass' ? 'sawtooth' : type === 'sub808' ? 'sine' : 'triangle';
    return new Tone.Synth({
      oscillator: { type: oscType },
      envelope: {
        attack: clamp(inst.attack ?? 0.01, 0.0001, 2),
        decay: clamp(inst.decay ?? 0.2, 0.001, 4),
        sustain: clamp(inst.sustain ?? 0.5, 0, 1),
        release: clamp(inst.release ?? 0.5, 0.001, 4),
      },
      volume: 0,
    });
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
      0.01
    );
  }

  /** Update the channel Panner value (-1 to 1). */
  updateChannelPan(id: string, pan: number): void {
    const nodes = this.channelNodes.get(id);
    if (!nodes) return;
    nodes.panner.pan.rampTo(clamp(pan, -1, 1), 0.01);
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
   * Playlist playback mode: walks through the arrangement timeline bar-by-bar,
   * triggering channels from all active clips at each step.
   */
  private _transportStartPlaylist(): void {
    // Sync channels from ALL patterns referenced by clips
    const state = useDAWStore.getState();
    const referencedPatternIds = new Set(state.playlistClips.map(c => c.patternId));
    const allChannels: Channel[] = [];
    for (const pid of referencedPatternIds) {
      const pat = state.patterns.find(p => p.id === pid);
      if (pat) {
        for (const ch of pat.channels) {
          if (!allChannels.some(c => c.id === ch.id)) {
            allChannels.push(ch);
          }
        }
      }
    }
    this.syncChannels(allChannels);

    // Find the end of the arrangement (last clip end bar)
    const lastBar = state.playlistClips.reduce(
      (max, c) => Math.max(max, c.startBar + c.lengthBars),
      0
    );
    if (lastBar === 0) {
      // No clips — nothing to play
      useDAWStore.getState().stop();
      return;
    }

    const totalPlaylistSteps = lastBar * 16;

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
            // Reached end of arrangement — stop
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
   * trigger the appropriate channels from each clip's pattern.
   */
  private _onPlaylistStep(globalStep: number, time: number): void {
    // Update playlist step in store for playhead display
    Tone.getDraw().schedule(() => {
      useDAWStore.getState().setPlaylistStep(globalStep);
    }, time);

    const state = useDAWStore.getState();
    const globalBar = Math.floor(globalStep / 16);
    const stepInBar = globalStep % 16;

    for (const clip of state.playlistClips) {
      // Is this clip active at the current global bar?
      if (globalBar < clip.startBar || globalBar >= clip.startBar + clip.lengthBars) continue;

      const pattern = state.patterns.find(p => p.id === clip.patternId);
      if (!pattern) continue;

      const patternTotalSteps = (pattern.bars ?? 1) * 16;
      const barInPattern = globalBar - clip.startBar;
      const stepInPattern = (barInPattern * 16 + stepInBar) % patternTotalSteps;

      const hasSolo = pattern.channels.some(c => c.solo);

      for (const channel of pattern.channels) {
        if (channel.muted) continue;
        if (hasSolo && !channel.solo) continue;
        if (!channel.steps[stepInPattern]) continue;

        this._triggerChannel(channel, stepInPattern, pattern, time);
      }
    }
  }

  private _transportStop(): void {
    const transport = Tone.getTransport();

    if (this.repeatId !== null) {
      transport.clear(this.repeatId);
      this.repeatId = null;
    }

    transport.stop();
    transport.position = 0;

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
        // NoiseSynth does not accept a frequency argument
        synth.triggerAttackRelease('8n', time);
      } else if (synth instanceof Tone.MembraneSynth) {
        const pitchHz = channel.instrument.pitch ?? (type === 'kick' ? 60 : 200);
        synth.triggerAttackRelease(pitchHz, '8n', time);
      } else if (synth instanceof Tone.MetalSynth) {
        synth.triggerAttackRelease('16n', time);
      } else if (isPercussion) {
        // Generic percussion fallback
        (synth as Tone.Synth | Tone.FMSynth | Tone.AMSynth).triggerAttackRelease(
          midiToFreq(60),
          '16n',
          time
        );
      } else {
        // Tonal channel — look for piano roll notes first
        const pianoNotes: Note[] = pattern.pianoRollNotes[channel.id] ?? [];
        const notesAtStep = pianoNotes.filter((n) => n.start === stepIndex);

        if (notesAtStep.length > 0) {
          for (const note of notesAtStep) {
            const freq = midiToFreq(note.pitch + (channel.instrument.tune ?? 0));
            // Convert duration in 16th-note units to Tone.js notation
            const durNotation = this._sixteenthsToDuration(note.duration);
            (synth as Tone.Synth | Tone.FMSynth | Tone.AMSynth).triggerAttackRelease(
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
          (synth as Tone.Synth | Tone.FMSynth | Tone.AMSynth).triggerAttackRelease(
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
    Tone.getTransport().bpm.value = clamp(bpm, 20, 400);
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
            (synth as Tone.Synth | Tone.FMSynth | Tone.AMSynth).triggerAttackRelease(
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

    for (const nodes of Array.from(this.channelNodes.values())) {
      this._disposeChannelNodes(nodes);
    }
    this.channelNodes.clear();

    this.masterGain?.disconnect();
    this.masterGain?.dispose();
    this.masterGain = null;

    for (const unsub of this.storeUnsubscribers) {
      unsub();
    }
    this.storeUnsubscribers = [];

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
