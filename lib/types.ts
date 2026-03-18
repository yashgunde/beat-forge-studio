export type ChannelType =
  | 'kick' | 'snare' | 'hihat' | 'openhat' | 'clap' | 'perc'
  | 'synth' | 'bass' | 'pad' | 'lead' | 'bell' | 'pluck'
  | 'brass' | 'strings' | 'keys' | 'vocal' | 'fx' | 'sub808'
  | 'sample';

export type ViewType = 'channelrack' | 'piano-roll' | 'mixer' | 'playlist';

export interface InstrumentSettings {
  synthType?: 'membrane' | 'metal' | 'noise' | 'fm' | 'am' | 'synth';
  tune?: number;       // semitone offset
  pitch?: number;      // for membrane synth (Hz)
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  distortion?: number; // 0-1
  reverb?: number;     // 0-1
  delay?: number;      // 0-1
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  color: string;
  volume: number;   // 0-1
  pan: number;      // -1 to 1
  muted: boolean;
  solo: boolean;
  steps: boolean[]; // 16 steps
  instrument: InstrumentSettings;
  sampleUrl?: string;   // Object URL or data URL of uploaded sample
  sampleId?: string;    // IndexedDB key for persisted sample audio data
  sampleStart?: number; // Slice start time in seconds (for sample channels)
  sampleEnd?: number;   // Slice end time in seconds (for sample channels)
}

export interface Note {
  id: string;
  pitch: number;    // MIDI note number 0-127
  start: number;    // in 16th note units
  duration: number; // in 16th note units
  velocity: number; // 0-1
}

export interface Pattern {
  id: string;
  name: string;
  channels: Channel[];
  pianoRollNotes: Record<string, Note[]>;
  length: number; // in bars
  bars: number;   // number of bars (1, 2, 4, 8) — default 1, meaning 16 steps
}

export function patternStepCount(pattern: Pattern): number {
  return (pattern.bars ?? 1) * 16;
}

export interface PlaylistClip {
  id: string;
  patternId: string;
  track: number;
  startBar: number;
  lengthBars: number;
  color?: string;
}

export interface MixerChannel {
  id: string;
  name: string;
  linkedChannelId?: string;
  volume: number; // 0-1 (displayed as 0-100%)
  pan: number;    // -1 to 1
  muted: boolean;
  solo: boolean;
  eq: { low: number; mid: number; high: number }; // -12 to +12 dB
}

export interface BeatGenerationResult {
  bpm: number;
  offset: number; // seconds to first beat
  pattern: Pattern;
  waveformData?: Float32Array;
}

export interface SoundPreset {
  id: string;
  name: string;
  type: ChannelType;
  color: string;
  instrument: InstrumentSettings;
  tags: string[]; // e.g. ['trap', 'metro boomin', 'dark']
  description: string;
}

export const SOUND_PRESETS: SoundPreset[] = [
  // KICKS
  {
    id: 'kick-808-metro',
    name: '808 Metro Kick',
    type: 'kick',
    color: '#ff3333',
    instrument: { synthType: 'membrane', pitch: 55, decay: 0.8, distortion: 0.3 },
    tags: ['kick', 'trap', 'metro boomin'],
    description: 'Deep 808 kick with pitch decay — Metro Boomin style',
  },
  {
    id: 'kick-punchy',
    name: 'Punchy Trap Kick',
    type: 'kick',
    color: '#ff5555',
    instrument: { synthType: 'membrane', pitch: 80, decay: 0.2, distortion: 0.1 },
    tags: ['kick', 'trap', 'punchy'],
    description: 'Short punchy kick for trap patterns',
  },
  {
    id: 'kick-vintage-808',
    name: 'Vintage 808 Boom',
    type: 'kick',
    color: '#ff2222',
    instrument: { synthType: 'membrane', pitch: 42, decay: 1.2, distortion: 0.4 },
    tags: ['kick', 'trap', '808', 'vintage', 'boom'],
    description: 'Long booming vintage 808 kick — classic trap foundation',
  },
  {
    id: 'kick-hard-boom',
    name: 'Hard Boom Kick',
    type: 'kick',
    color: '#dd1111',
    instrument: { synthType: 'membrane', pitch: 65, decay: 0.5, distortion: 0.5 },
    tags: ['kick', 'hard', 'distorted', 'boom'],
    description: 'Hard distorted boom kick',
  },
  {
    id: 'kick-soft-thump',
    name: 'Soft Thump Kick',
    type: 'kick',
    color: '#ff7777',
    instrument: { synthType: 'membrane', pitch: 50, decay: 0.35, distortion: 0.0 },
    tags: ['kick', 'soft', 'thump', 'clean'],
    description: 'Clean soft thump kick — good for layering',
  },
  {
    id: 'kick-808-slide',
    name: '808 Slide Kick',
    type: 'kick',
    color: '#ff4422',
    instrument: { synthType: 'membrane', pitch: 35, decay: 1.8, distortion: 0.25 },
    tags: ['kick', '808', 'slide', 'pierre bourne', 'long'],
    description: 'Extremely long 808 kick with slide — Pierre Bourne style',
  },
  // SUB 808
  {
    id: 'sub808-dark',
    name: 'Dark Sub 808',
    type: 'sub808',
    color: '#cc2200',
    instrument: { synthType: 'synth', attack: 0.01, decay: 1.5, sustain: 0.8, release: 0.5, distortion: 0.2 },
    tags: ['808', 'bass', 'metro boomin', 'dark'],
    description: 'Rumbling sub 808 — dark trap foundation',
  },
  {
    id: 'sub808-pierre',
    name: 'Pierre 808 Slide',
    type: 'sub808',
    color: '#dd3300',
    instrument: { synthType: 'synth', attack: 0.005, decay: 2.0, sustain: 0.7, release: 1.0, distortion: 0.15 },
    tags: ['808', 'pierre bourne', 'slide'],
    description: 'Smooth 808 with long decay — Pierre Bourne vibe',
  },
  // SNARES
  {
    id: 'snare-trap-hard',
    name: 'Hard Trap Snare',
    type: 'snare',
    color: '#4499ff',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.18, reverb: 0.3 },
    tags: ['snare', 'trap', 'hard'],
    description: 'Crispy hard snare with short reverb tail',
  },
  {
    id: 'snare-metro-verb',
    name: 'Metro Reverb Snare',
    type: 'snare',
    color: '#3388ff',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.35, reverb: 0.7 },
    tags: ['snare', 'metro boomin', 'reverb'],
    description: 'Huge reverb snare — cinematic Metro Boomin signature',
  },
  {
    id: 'snare-rimshot',
    name: 'Rimshot Snare',
    type: 'snare',
    color: '#5599ff',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.1 },
    tags: ['snare', 'rimshot', 'sharp', 'crack'],
    description: 'Sharp cracking rimshot',
  },
  {
    id: 'snare-ghost',
    name: 'Ghost Snare',
    type: 'snare',
    color: '#2266cc',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.12, reverb: 0.1 },
    tags: ['snare', 'ghost', 'soft', 'quiet'],
    description: 'Quiet ghost snare for secondary hits and fills',
  },
  {
    id: 'snare-clap-layer',
    name: 'Clap Layer Snare',
    type: 'snare',
    color: '#6699ff',
    instrument: { synthType: 'noise', attack: 0.002, decay: 0.3, reverb: 0.5 },
    tags: ['snare', 'clap', 'layered', 'wide'],
    description: 'Snare layered with clap for maximum impact',
  },
  {
    id: 'snare-trap-crispy',
    name: 'Crispy Trap Snare',
    type: 'snare',
    color: '#77aaff',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.15 },
    tags: ['snare', 'crispy', 'trap', 'dry'],
    description: 'Dry crispy trap snare — no reverb, very tight',
  },
  // CLAPS
  {
    id: 'clap-trap',
    name: 'Trap Clap',
    type: 'clap',
    color: '#ff8800',
    instrument: { synthType: 'noise', attack: 0.002, decay: 0.12 },
    tags: ['clap', 'trap'],
    description: 'Tight trap clap',
  },
  {
    id: 'clap-layered',
    name: 'Layered Clap',
    type: 'clap',
    color: '#ff9911',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.22, reverb: 0.4 },
    tags: ['clap', 'layered', 'big', 'metro boomin'],
    description: 'Big layered clap with reverb shimmer',
  },
  {
    id: 'clap-bright',
    name: 'Bright Clap',
    type: 'clap',
    color: '#ffaa33',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.08 },
    tags: ['clap', 'bright', 'snappy'],
    description: 'Bright snappy clap — very short and crisp',
  },
  {
    id: 'clap-metro-smack',
    name: 'Metro Smack',
    type: 'clap',
    color: '#ff7700',
    instrument: { synthType: 'noise', attack: 0.003, decay: 0.28, reverb: 0.6 },
    tags: ['clap', 'metro boomin', 'smack', 'wide'],
    description: 'Wide smacking clap — Metro Boomin signature hit',
  },
  {
    id: 'clap-ghost',
    name: 'Ghost Clap',
    type: 'clap',
    color: '#cc6600',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.06 },
    tags: ['clap', 'ghost', 'soft', 'quiet'],
    description: 'Quiet ghost clap for syncopated patterns',
  },
  // HI-HATS
  {
    id: 'hihat-rapid',
    name: 'Rapid Trap Hat',
    type: 'hihat',
    color: '#ffdd00',
    instrument: { synthType: 'metal', decay: 0.07 },
    tags: ['hihat', 'trap', 'rapid'],
    description: 'Fast hi-hat for trap rolls',
  },
  {
    id: 'hihat-metro',
    name: 'Metro Hi-Hat',
    type: 'hihat',
    color: '#ffcc00',
    instrument: { synthType: 'metal', decay: 0.12 },
    tags: ['hihat', 'metro boomin'],
    description: 'Standard trap hi-hat',
  },
  {
    id: 'hihat-shuffle',
    name: 'Shuffle Hat',
    type: 'hihat',
    color: '#eecc00',
    instrument: { synthType: 'metal', decay: 0.09 },
    tags: ['hihat', 'shuffle', 'groove'],
    description: 'Slightly looser hi-hat for shuffle grooves',
  },
  {
    id: 'hihat-ghost',
    name: 'Ghost Hat',
    type: 'hihat',
    color: '#bbaa00',
    instrument: { synthType: 'metal', decay: 0.05 },
    tags: ['hihat', 'ghost', 'quiet', 'soft'],
    description: 'Whisper-quiet ghost hi-hat for subtle groove fills',
  },
  {
    id: 'hihat-closed-crispy',
    name: 'Crispy Closed Hat',
    type: 'hihat',
    color: '#ffee44',
    instrument: { synthType: 'metal', decay: 0.04 },
    tags: ['hihat', 'crispy', 'closed', 'sharp'],
    description: 'Very short crispy closed hi-hat — extremely tight',
  },
  {
    id: 'openhat-airy',
    name: 'Airy Open Hat',
    type: 'openhat',
    color: '#aacc00',
    instrument: { synthType: 'metal', decay: 0.6, reverb: 0.3 },
    tags: ['openhat', 'airy'],
    description: 'Open hi-hat with reverb shimmer',
  },
  {
    id: 'openhat-long',
    name: 'Long Open Hat',
    type: 'openhat',
    color: '#99bb00',
    instrument: { synthType: 'metal', decay: 1.0, reverb: 0.4 },
    tags: ['openhat', 'long', 'washy'],
    description: 'Long washy open hat — good for transitions',
  },
  {
    id: 'openhat-pedal',
    name: 'Pedal Hi-Hat',
    type: 'openhat',
    color: '#88aa00',
    instrument: { synthType: 'metal', decay: 0.25 },
    tags: ['openhat', 'pedal', 'groove'],
    description: 'Mid-length pedal hi-hat for groove feels',
  },
  // PADS
  {
    id: 'pad-dark-metro',
    name: 'Dark Cinematic Pad',
    type: 'pad',
    color: '#6600cc',
    instrument: { synthType: 'am', attack: 1.0, decay: 0.5, sustain: 0.8, release: 2.0, reverb: 0.8 },
    tags: ['pad', 'metro boomin', 'dark', 'cinematic'],
    description: 'Slow-attack dark pad — Metro Boomin cinematic style',
  },
  {
    id: 'pad-pierre-dreamy',
    name: 'Dreamy Atmospheric Pad',
    type: 'pad',
    color: '#8800ff',
    instrument: { synthType: 'fm', attack: 0.8, decay: 0.3, sustain: 0.9, release: 3.0, reverb: 0.9, delay: 0.4 },
    tags: ['pad', 'pierre bourne', 'dreamy', 'atmospheric'],
    description: 'Ethereal dreamy pad — Pierre Bourne signature',
  },
  {
    id: 'pad-choir',
    name: 'Choir Pad',
    type: 'pad',
    color: '#5500aa',
    instrument: { synthType: 'fm', attack: 1.2, decay: 0.4, sustain: 0.85, release: 2.5, reverb: 0.85 },
    tags: ['pad', 'choir', 'metro boomin', 'dark'],
    description: 'Gothic choir pad — dark trap atmospherics',
  },
  // LEADS
  {
    id: 'lead-fm-bright',
    name: 'Bright FM Lead',
    type: 'lead',
    color: '#00aaff',
    instrument: { synthType: 'fm', attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.3 },
    tags: ['lead', 'bright', 'melodic'],
    description: 'Cutting FM synth lead for melodies',
  },
  {
    id: 'lead-pierre-high',
    name: 'Pierre High Lead',
    type: 'lead',
    color: '#00ccff',
    instrument: { synthType: 'fm', attack: 0.005, decay: 0.05, sustain: 0.7, release: 0.4, reverb: 0.4 },
    tags: ['lead', 'pierre bourne', 'high-pitched'],
    description: 'High melodic lead — Pierre Bourne style',
  },
  // BELLS
  {
    id: 'bell-eerie',
    name: 'Eerie Bell',
    type: 'bell',
    color: '#44ffcc',
    instrument: { synthType: 'fm', attack: 0.001, decay: 1.5, sustain: 0.1, release: 1.5, reverb: 0.6 },
    tags: ['bell', 'metro boomin', 'eerie', 'dark'],
    description: 'Eerie bell tone — Metro Boomin signature sound',
  },
  {
    id: 'bell-chime',
    name: 'Bright Chime',
    type: 'bell',
    color: '#88ffdd',
    instrument: { synthType: 'fm', attack: 0.001, decay: 0.8, sustain: 0.05, release: 0.8 },
    tags: ['bell', 'chime', 'bright'],
    description: 'Bright chime bell',
  },
  // PLUCKS
  {
    id: 'pluck-pierre',
    name: 'Pierre Pluck',
    type: 'pluck',
    color: '#ff44aa',
    instrument: { synthType: 'fm', attack: 0.001, decay: 0.4, sustain: 0.0, release: 0.5, reverb: 0.5 },
    tags: ['pluck', 'pierre bourne', 'melodic'],
    description: 'Snappy pluck synth — Pierre Bourne guitar-like sound',
  },
  {
    id: 'pluck-glass',
    name: 'Glass Pluck',
    type: 'pluck',
    color: '#ff66bb',
    instrument: { synthType: 'am', attack: 0.001, decay: 0.6, sustain: 0.0, release: 0.4, reverb: 0.4 },
    tags: ['pluck', 'glass', 'wheezy'],
    description: 'Glassy pluck synth — Wheezy / ethereal style',
  },
  // KEYS
  {
    id: 'keys-dark-piano',
    name: 'Dark Piano Keys',
    type: 'keys',
    color: '#994400',
    instrument: { synthType: 'fm', attack: 0.005, decay: 0.8, sustain: 0.3, release: 1.0, reverb: 0.4 },
    tags: ['keys', 'piano', 'dark', 'southside'],
    description: 'Dark piano keys — Southside / Murda Beatz style',
  },
  {
    id: 'keys-dreamy',
    name: 'Dreamy Keys',
    type: 'keys',
    color: '#cc6600',
    instrument: { synthType: 'am', attack: 0.02, decay: 0.5, sustain: 0.6, release: 1.5, reverb: 0.6, delay: 0.3 },
    tags: ['keys', 'dreamy', 'wheezy'],
    description: 'Dreamy keys with reverb and delay — Wheezy signature',
  },
  // BASS
  {
    id: 'bass-sub',
    name: 'Sub Bass',
    type: 'bass',
    color: '#ff44aa',
    instrument: { synthType: 'synth', attack: 0.01, decay: 0.3, sustain: 0.6, release: 0.2 },
    tags: ['bass', 'sub', 'trap'],
    description: 'Deep sub bass for trap',
  },
  {
    id: 'bass-distorted',
    name: 'Distorted Bass',
    type: 'bass',
    color: '#ff2299',
    instrument: { synthType: 'synth', attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3, distortion: 0.5 },
    tags: ['bass', 'distorted', 'aggressive'],
    description: 'Aggressive distorted bass line',
  },
  // BRASS
  {
    id: 'brass-dark',
    name: 'Dark Brass',
    type: 'brass',
    color: '#cc8800',
    instrument: { synthType: 'am', attack: 0.1, decay: 0.3, sustain: 0.7, release: 0.5, reverb: 0.4 },
    tags: ['brass', 'dark', 'metro boomin', 'cinematic'],
    description: 'Cinematic dark brass — Metro Boomin orchestral',
  },
  // STRINGS
  {
    id: 'strings-dark',
    name: 'Dark Strings',
    type: 'strings',
    color: '#885500',
    instrument: { synthType: 'am', attack: 0.5, decay: 0.3, sustain: 0.8, release: 1.5, reverb: 0.6 },
    tags: ['strings', 'dark', 'metro boomin', 'orchestral'],
    description: 'Dark orchestral strings — Metro Boomin signature',
  },
  // FX
  {
    id: 'fx-riser',
    name: 'Riser FX',
    type: 'fx',
    color: '#00ffaa',
    instrument: { synthType: 'fm', attack: 2.0, decay: 0.1, sustain: 0.8, release: 0.5, reverb: 0.5 },
    tags: ['fx', 'riser', 'transition'],
    description: 'Atmospheric riser for transitions',
  },
  // PERC
  {
    id: 'perc-high',
    name: 'High Perc',
    type: 'perc',
    color: '#aa44ff',
    instrument: { synthType: 'membrane', pitch: 300, decay: 0.08 },
    tags: ['perc', 'high', 'trap'],
    description: 'High-pitched percussion hit',
  },
  {
    id: 'perc-conga',
    name: 'Conga Perc',
    type: 'perc',
    color: '#cc66ff',
    instrument: { synthType: 'membrane', pitch: 150, decay: 0.15 },
    tags: ['perc', 'conga', 'groove'],
    description: 'Conga-like percussion',
  },

  // ─── HOUSE ──────────────────────────────────────────────────────────────────
  {
    id: 'kick-house-deep',
    name: 'Deep House Kick',
    type: 'kick',
    color: '#ff6633',
    instrument: { synthType: 'membrane', pitch: 50, decay: 0.5, distortion: 0.1 },
    tags: ['kick', 'house', 'deep house'],
    description: 'Round, deep kick for house and deep house',
  },
  {
    id: 'kick-tech-house',
    name: 'Tech House Kick',
    type: 'kick',
    color: '#ff5500',
    instrument: { synthType: 'membrane', pitch: 70, decay: 0.28, distortion: 0.3 },
    tags: ['kick', 'techno', 'tech house'],
    description: 'Punchy tech house kick with slight distortion',
  },
  {
    id: 'clap-house',
    name: 'House Clap',
    type: 'clap',
    color: '#ffaa55',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.16, reverb: 0.5 },
    tags: ['clap', 'house'],
    description: 'Classic house clap with reverb shimmer',
  },
  {
    id: 'snare-house-rim',
    name: 'House Rimshot',
    type: 'snare',
    color: '#44bbff',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.09 },
    tags: ['snare', 'house', 'rimshot'],
    description: 'Tight rimshot for house grooves',
  },
  {
    id: 'hihat-house-closed',
    name: 'House Closed Hat',
    type: 'hihat',
    color: '#ffee66',
    instrument: { synthType: 'metal', decay: 0.06 },
    tags: ['hihat', 'house'],
    description: 'Tight closed hi-hat for four-on-the-floor patterns',
  },
  {
    id: 'hihat-house-open',
    name: 'House Open Hat',
    type: 'openhat',
    color: '#ccdd00',
    instrument: { synthType: 'metal', decay: 0.45, reverb: 0.25 },
    tags: ['openhat', 'house'],
    description: 'Offbeat open hat essential for house grooves',
  },
  {
    id: 'pad-house-chord',
    name: 'House Chord Pad',
    type: 'pad',
    color: '#9933ff',
    instrument: { synthType: 'am', attack: 0.05, decay: 0.3, sustain: 0.8, release: 1.0, reverb: 0.6 },
    tags: ['pad', 'house', 'chord'],
    description: 'Classic piano-chord stab pad for house music',
  },
  {
    id: 'bass-house',
    name: 'House Bass',
    type: 'bass',
    color: '#ff33cc',
    instrument: { synthType: 'synth', attack: 0.01, decay: 0.15, sustain: 0.6, release: 0.2 },
    tags: ['bass', 'house'],
    description: 'Punchy house bass line',
  },
  {
    id: 'lead-house-stab',
    name: 'House Piano Stab',
    type: 'lead',
    color: '#33ccff',
    instrument: { synthType: 'fm', attack: 0.005, decay: 0.18, sustain: 0.0, release: 0.3 },
    tags: ['lead', 'house', 'stab', 'piano'],
    description: 'Stabby house piano — classic gospel chord riff',
  },
  {
    id: 'keys-house-organ',
    name: 'House Organ',
    type: 'keys',
    color: '#cc8833',
    instrument: { synthType: 'am', attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.3, reverb: 0.35 },
    tags: ['keys', 'organ', 'house'],
    description: 'Hammond-style organ for soulful house',
  },

  // ─── TECHNO ─────────────────────────────────────────────────────────────────
  {
    id: 'kick-techno-hard',
    name: 'Hard Techno Kick',
    type: 'kick',
    color: '#dd1144',
    instrument: { synthType: 'membrane', pitch: 72, decay: 0.22, distortion: 0.6 },
    tags: ['kick', 'techno', 'hard', 'industrial'],
    description: 'Driving hard techno kick with heavy distortion',
  },
  {
    id: 'kick-industrial',
    name: 'Industrial Kick',
    type: 'kick',
    color: '#991122',
    instrument: { synthType: 'membrane', pitch: 60, decay: 0.4, distortion: 0.8 },
    tags: ['kick', 'industrial', 'techno', 'hard'],
    description: 'Harsh industrial kick with extreme distortion',
  },
  {
    id: 'hihat-techno-shuffle',
    name: 'Techno Shuffle Hat',
    type: 'hihat',
    color: '#ffdd33',
    instrument: { synthType: 'metal', decay: 0.08 },
    tags: ['hihat', 'techno', 'shuffle'],
    description: 'Shuffled hi-hat for driving techno grooves',
  },
  {
    id: 'perc-techno-ride',
    name: 'Techno Ride',
    type: 'perc',
    color: '#bb9900',
    instrument: { synthType: 'metal', decay: 0.8, reverb: 0.15 },
    tags: ['perc', 'techno', 'ride'],
    description: 'Metallic ride cymbal for techno',
  },
  {
    id: 'bass-acid',
    name: 'Acid 303 Bass',
    type: 'bass',
    color: '#ff2266',
    instrument: { synthType: 'synth', attack: 0.005, decay: 0.12, sustain: 0.4, release: 0.1, distortion: 0.3 },
    tags: ['bass', 'acid', 'techno', '303'],
    description: 'TB-303 acid bass — the sound of acid house and techno',
  },
  {
    id: 'lead-techno',
    name: 'Techno Lead',
    type: 'lead',
    color: '#0099ff',
    instrument: { synthType: 'synth', attack: 0.001, decay: 0.1, sustain: 0.5, release: 0.2 },
    tags: ['lead', 'techno'],
    description: 'Cutting sawtooth lead for techno',
  },
  {
    id: 'pad-techno-drone',
    name: 'Techno Drone',
    type: 'pad',
    color: '#333388',
    instrument: { synthType: 'fm', attack: 2.5, decay: 0.5, sustain: 0.9, release: 3.0, reverb: 0.7, delay: 0.3 },
    tags: ['pad', 'techno', 'drone', 'dark'],
    description: 'Dark industrial drone pad for techno atmospheres',
  },
  {
    id: 'synth-techno-arp',
    name: 'Techno Arp Synth',
    type: 'synth',
    color: '#5544cc',
    instrument: { synthType: 'fm', attack: 0.01, decay: 0.08, sustain: 0.3, release: 0.2 },
    tags: ['synth', 'techno', 'arp'],
    description: 'Quick FM arpeggio synth for techno sequences',
  },
  {
    id: 'fx-techno-noise',
    name: 'Techno Noise Sweep',
    type: 'fx',
    color: '#445566',
    instrument: { synthType: 'noise', attack: 1.5, decay: 0.5, reverb: 0.5 },
    tags: ['fx', 'techno', 'noise', 'sweep'],
    description: 'White noise sweep for techno breakdowns',
  },
  {
    id: 'perc-techno-clap',
    name: 'Techno Clap',
    type: 'clap',
    color: '#ee4411',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.25, reverb: 0.35 },
    tags: ['clap', 'techno'],
    description: 'Dry techno clap for mechanical grooves',
  },

  // ─── DRUM & BASS ────────────────────────────────────────────────────────────
  {
    id: 'kick-dnb',
    name: 'DnB Kick',
    type: 'kick',
    color: '#ff4400',
    instrument: { synthType: 'membrane', pitch: 58, decay: 0.18, distortion: 0.2 },
    tags: ['kick', 'drum and bass', 'dnb'],
    description: 'Tight punchy kick for drum and bass',
  },
  {
    id: 'snare-dnb-break',
    name: 'DnB Breakbeat Snare',
    type: 'snare',
    color: '#3377ff',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.25, reverb: 0.2 },
    tags: ['snare', 'drum and bass', 'dnb', 'breakbeat'],
    description: 'Crisp snare inspired by amen break style',
  },
  {
    id: 'snare-dnb-snappy',
    name: 'Snappy DnB Snare',
    type: 'snare',
    color: '#2255ee',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.13 },
    tags: ['snare', 'drum and bass', 'dnb', 'snappy'],
    description: 'Extra snappy dry snare for fast DnB patterns',
  },
  {
    id: 'hihat-dnb-roll',
    name: 'DnB Rolling Hat',
    type: 'hihat',
    color: '#eebb00',
    instrument: { synthType: 'metal', decay: 0.055 },
    tags: ['hihat', 'drum and bass', 'dnb', 'roll'],
    description: 'Very short hat for rapid DnB rolls',
  },
  {
    id: 'hihat-dnb-quick',
    name: 'Quick DnB Hat',
    type: 'hihat',
    color: '#ddaa00',
    instrument: { synthType: 'metal', decay: 0.08 },
    tags: ['hihat', 'drum and bass', 'dnb'],
    description: 'Quick 16th-note hat for DnB',
  },
  {
    id: 'bass-dnb-reese',
    name: 'Reese Bass',
    type: 'bass',
    color: '#ff1188',
    instrument: { synthType: 'fm', attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.4, distortion: 0.25 },
    tags: ['bass', 'drum and bass', 'dnb', 'reese'],
    description: 'Classic Reese bass — the foundation of DnB and techno',
  },
  {
    id: 'bass-dnb',
    name: 'DnB Sub Bass',
    type: 'bass',
    color: '#ff0077',
    instrument: { synthType: 'synth', attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
    tags: ['bass', 'drum and bass', 'dnb', 'sub'],
    description: 'Sub bass for drum and bass',
  },
  {
    id: 'pad-dnb-atmospheric',
    name: 'DnB Atmospheric Pad',
    type: 'pad',
    color: '#224499',
    instrument: { synthType: 'am', attack: 0.6, decay: 0.4, sustain: 0.7, release: 2.0, reverb: 0.75, delay: 0.35 },
    tags: ['pad', 'drum and bass', 'dnb', 'atmospheric'],
    description: 'Lush atmospheric pad for liquid DnB',
  },

  // ─── JAZZ / LO-FI ───────────────────────────────────────────────────────────
  {
    id: 'kick-jazz-warm',
    name: 'Warm Jazz Kick',
    type: 'kick',
    color: '#ff8844',
    instrument: { synthType: 'membrane', pitch: 48, decay: 0.28, distortion: 0.0 },
    tags: ['kick', 'jazz', 'warm'],
    description: 'Warm, round jazz kick drum',
  },
  {
    id: 'kick-lofi-boom',
    name: 'Lo-Fi Boom Kick',
    type: 'kick',
    color: '#cc6622',
    instrument: { synthType: 'membrane', pitch: 45, decay: 0.35, distortion: 0.05 },
    tags: ['kick', 'lo-fi', 'lofi', 'boom'],
    description: 'Dusty boom kick for lo-fi hip-hop',
  },
  {
    id: 'snare-jazz-brush',
    name: 'Jazz Brush Snare',
    type: 'snare',
    color: '#5588cc',
    instrument: { synthType: 'noise', attack: 0.003, decay: 0.35, reverb: 0.2 },
    tags: ['snare', 'jazz', 'brush'],
    description: 'Soft brush snare for jazz grooves',
  },
  {
    id: 'snare-lofi',
    name: 'Lo-Fi Snare',
    type: 'snare',
    color: '#3366bb',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.22, reverb: 0.3 },
    tags: ['snare', 'lo-fi', 'lofi', 'dusty'],
    description: 'Dusty lo-fi snare with light reverb',
  },
  {
    id: 'hihat-jazz-swing',
    name: 'Jazz Swing Hat',
    type: 'hihat',
    color: '#ccaa00',
    instrument: { synthType: 'metal', decay: 0.14 },
    tags: ['hihat', 'jazz', 'swing'],
    description: 'Swinging jazz hi-hat for jazz grooves',
  },
  {
    id: 'hihat-lofi-dusty',
    name: 'Dusty Lo-Fi Hat',
    type: 'hihat',
    color: '#aa8800',
    instrument: { synthType: 'metal', decay: 0.11 },
    tags: ['hihat', 'lo-fi', 'lofi', 'dusty'],
    description: 'Dusty lo-fi closed hi-hat',
  },
  {
    id: 'keys-jazz',
    name: 'Jazz Piano',
    type: 'keys',
    color: '#996633',
    instrument: { synthType: 'fm', attack: 0.005, decay: 0.7, sustain: 0.25, release: 1.2, reverb: 0.35 },
    tags: ['keys', 'piano', 'jazz'],
    description: 'Warm jazz piano tone',
  },
  {
    id: 'keys-rhodes',
    name: 'Rhodes Electric Piano',
    type: 'keys',
    color: '#bb7722',
    instrument: { synthType: 'am', attack: 0.004, decay: 0.6, sustain: 0.4, release: 1.0, reverb: 0.3, delay: 0.2 },
    tags: ['keys', 'rhodes', 'electric piano', 'lo-fi', 'jazz'],
    description: 'Warm Rhodes electric piano — essential for soul, jazz, lo-fi',
  },
  {
    id: 'keys-lofi-piano',
    name: 'Lo-Fi Piano',
    type: 'keys',
    color: '#aa6611',
    instrument: { synthType: 'fm', attack: 0.006, decay: 0.9, sustain: 0.2, release: 1.5, reverb: 0.5, delay: 0.15 },
    tags: ['keys', 'piano', 'lo-fi', 'lofi'],
    description: 'Muffled lo-fi piano with warmth and character',
  },

  // ─── R&B / SOUL ─────────────────────────────────────────────────────────────
  {
    id: 'kick-rnb',
    name: 'R&B Kick',
    type: 'kick',
    color: '#ff6666',
    instrument: { synthType: 'membrane', pitch: 55, decay: 0.32, distortion: 0.1 },
    tags: ['kick', 'r&b', 'rnb', 'soul'],
    description: 'Smooth R&B kick drum',
  },
  {
    id: 'snare-rnb-smooth',
    name: 'Smooth R&B Snare',
    type: 'snare',
    color: '#4499ee',
    instrument: { synthType: 'noise', attack: 0.002, decay: 0.28, reverb: 0.5 },
    tags: ['snare', 'r&b', 'rnb', 'smooth'],
    description: 'Smooth R&B snare with wide reverb',
  },
  {
    id: 'snare-rnb-heavy',
    name: 'Heavy R&B Snare',
    type: 'snare',
    color: '#3388dd',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.32, reverb: 0.65 },
    tags: ['snare', 'r&b', 'rnb', 'heavy'],
    description: 'Big booming R&B snare',
  },
  {
    id: 'pad-soul',
    name: 'Soul Chord Pad',
    type: 'pad',
    color: '#7733bb',
    instrument: { synthType: 'am', attack: 0.2, decay: 0.4, sustain: 0.8, release: 2.5, reverb: 0.7 },
    tags: ['pad', 'soul', 'r&b', 'chord'],
    description: 'Lush soul chord pad with warmth',
  },
  {
    id: 'strings-rnb',
    name: 'R&B Strings',
    type: 'strings',
    color: '#885533',
    instrument: { synthType: 'am', attack: 0.35, decay: 0.3, sustain: 0.85, release: 1.8, reverb: 0.55 },
    tags: ['strings', 'r&b', 'rnb', 'soul'],
    description: 'Silky string section for R&B production',
  },
  {
    id: 'pad-rnb-warm',
    name: 'Warm R&B Pad',
    type: 'pad',
    color: '#6622aa',
    instrument: { synthType: 'fm', attack: 0.4, decay: 0.3, sustain: 0.9, release: 2.0, reverb: 0.65 },
    tags: ['pad', 'r&b', 'rnb', 'warm'],
    description: 'Warm, smooth pad for modern R&B',
  },
  {
    id: 'bass-rnb',
    name: 'R&B Bass',
    type: 'bass',
    color: '#ff33aa',
    instrument: { synthType: 'synth', attack: 0.01, decay: 0.22, sustain: 0.65, release: 0.4 },
    tags: ['bass', 'r&b', 'rnb', 'soul'],
    description: 'Smooth R&B bass line',
  },

  // ─── POP ────────────────────────────────────────────────────────────────────
  {
    id: 'kick-pop',
    name: 'Pop Kick',
    type: 'kick',
    color: '#ff5577',
    instrument: { synthType: 'membrane', pitch: 68, decay: 0.24, distortion: 0.08 },
    tags: ['kick', 'pop'],
    description: 'Clean punchy pop kick',
  },
  {
    id: 'snare-pop',
    name: 'Pop Snare',
    type: 'snare',
    color: '#55aaff',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.24, reverb: 0.45 },
    tags: ['snare', 'pop'],
    description: 'Clean pop snare with medium reverb',
  },
  {
    id: 'lead-pop-bright',
    name: 'Bright Pop Lead',
    type: 'lead',
    color: '#00ddff',
    instrument: { synthType: 'fm', attack: 0.005, decay: 0.08, sustain: 0.55, release: 0.35, reverb: 0.3 },
    tags: ['lead', 'pop', 'bright'],
    description: 'Bright sparkling pop lead synth',
  },
  {
    id: 'pad-pop',
    name: 'Pop Synth Pad',
    type: 'pad',
    color: '#aa22ff',
    instrument: { synthType: 'am', attack: 0.15, decay: 0.3, sustain: 0.8, release: 1.5, reverb: 0.55 },
    tags: ['pad', 'pop', 'bright'],
    description: 'Wide bright synth pad for pop productions',
  },
  {
    id: 'pluck-pop',
    name: 'Pop Pluck',
    type: 'pluck',
    color: '#ff55cc',
    instrument: { synthType: 'fm', attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.4, reverb: 0.4 },
    tags: ['pluck', 'pop', 'melodic'],
    description: 'Poppy pluck synth for melodic riffs',
  },
  {
    id: 'keys-pop',
    name: 'Pop Keys',
    type: 'keys',
    color: '#dd7700',
    instrument: { synthType: 'fm', attack: 0.004, decay: 0.6, sustain: 0.35, release: 0.9, reverb: 0.3 },
    tags: ['keys', 'piano', 'pop'],
    description: 'Bright pop piano keys',
  },
  {
    id: 'hihat-pop',
    name: 'Pop Hi-Hat',
    type: 'hihat',
    color: '#ffee00',
    instrument: { synthType: 'metal', decay: 0.07 },
    tags: ['hihat', 'pop'],
    description: 'Clean crisp pop hi-hat',
  },

  // ─── REGGAETON ──────────────────────────────────────────────────────────────
  {
    id: 'kick-dembow',
    name: 'Dembow Kick',
    type: 'kick',
    color: '#ff4433',
    instrument: { synthType: 'membrane', pitch: 62, decay: 0.2, distortion: 0.15 },
    tags: ['kick', 'reggaeton', 'dembow', 'latin'],
    description: 'Characteristic dembow kick for reggaeton',
  },
  {
    id: 'perc-reggaeton',
    name: 'Reggaeton Perc',
    type: 'perc',
    color: '#dd5500',
    instrument: { synthType: 'membrane', pitch: 250, decay: 0.06 },
    tags: ['perc', 'reggaeton', 'latin', 'dembow'],
    description: 'Snappy perc hit for the dembow rhythm',
  },
  {
    id: 'snare-dembow',
    name: 'Dembow Snare',
    type: 'snare',
    color: '#3399ff',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.14, reverb: 0.2 },
    tags: ['snare', 'reggaeton', 'dembow', 'latin'],
    description: 'Snappy dembow snare',
  },
  {
    id: 'bass-reggaeton',
    name: 'Reggaeton Bass',
    type: 'bass',
    color: '#ff2288',
    instrument: { synthType: 'synth', attack: 0.005, decay: 0.18, sustain: 0.7, release: 0.25, distortion: 0.15 },
    tags: ['bass', 'reggaeton', 'latin'],
    description: 'Hard-hitting reggaeton bass',
  },
  {
    id: 'synth-reggaeton',
    name: 'Reggaeton Synth',
    type: 'synth',
    color: '#5500ee',
    instrument: { synthType: 'fm', attack: 0.002, decay: 0.12, sustain: 0.4, release: 0.3 },
    tags: ['synth', 'reggaeton', 'latin', 'melodic'],
    description: 'Melodic synth hook for reggaeton',
  },

  // ─── AFROBEATS ──────────────────────────────────────────────────────────────
  {
    id: 'kick-afro',
    name: 'Afrobeats Kick',
    type: 'kick',
    color: '#ff7722',
    instrument: { synthType: 'membrane', pitch: 52, decay: 0.26, distortion: 0.08 },
    tags: ['kick', 'afrobeats', 'afro'],
    description: 'Bouncy kick for Afrobeats productions',
  },
  {
    id: 'perc-talking-drum',
    name: 'Talking Drum',
    type: 'perc',
    color: '#cc5511',
    instrument: { synthType: 'membrane', pitch: 180, decay: 0.18 },
    tags: ['perc', 'afrobeats', 'afro', 'talking drum', 'african'],
    description: 'Traditional African talking drum sound',
  },
  {
    id: 'perc-shaker',
    name: 'Shaker',
    type: 'perc',
    color: '#aa8822',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.08 },
    tags: ['perc', 'shaker', 'afrobeats', 'latin', 'groove'],
    description: 'Rattling shaker for rhythmic groove',
  },
  {
    id: 'perc-conga-afro',
    name: 'Afro Conga',
    type: 'perc',
    color: '#bb7700',
    instrument: { synthType: 'membrane', pitch: 160, decay: 0.2 },
    tags: ['perc', 'conga', 'afrobeats', 'afro'],
    description: 'Hand conga for Afrobeats groove',
  },
  {
    id: 'bass-afro',
    name: 'Afro Bass',
    type: 'bass',
    color: '#ee2277',
    instrument: { synthType: 'synth', attack: 0.008, decay: 0.2, sustain: 0.6, release: 0.3 },
    tags: ['bass', 'afrobeats', 'afro'],
    description: 'Bouncy melodic bass for Afrobeats',
  },
  {
    id: 'lead-afro',
    name: 'Afrobeats Lead',
    type: 'lead',
    color: '#00ccbb',
    instrument: { synthType: 'fm', attack: 0.005, decay: 0.12, sustain: 0.5, release: 0.4, reverb: 0.3 },
    tags: ['lead', 'afrobeats', 'afro', 'melodic'],
    description: 'Catchy melodic lead for Afrobeats',
  },
  {
    id: 'pad-afro',
    name: 'Afro Vibrant Pad',
    type: 'pad',
    color: '#ee8800',
    instrument: { synthType: 'am', attack: 0.1, decay: 0.3, sustain: 0.75, release: 1.5, reverb: 0.5 },
    tags: ['pad', 'afrobeats', 'afro', 'vibrant'],
    description: 'Vibrant chord pad for Afrobeats music',
  },

  // ─── DUBSTEP / BASS MUSIC ────────────────────────────────────────────────────
  {
    id: 'kick-dubstep',
    name: 'Dubstep Kick',
    type: 'kick',
    color: '#ee1133',
    instrument: { synthType: 'membrane', pitch: 60, decay: 0.38, distortion: 0.55 },
    tags: ['kick', 'dubstep', 'bass music', 'heavy'],
    description: 'Heavy distorted kick for dubstep',
  },
  {
    id: 'bass-wobble',
    name: 'Wobble Bass',
    type: 'bass',
    color: '#00eecc',
    instrument: { synthType: 'fm', attack: 0.01, decay: 0.15, sustain: 0.8, release: 0.3, distortion: 0.2 },
    tags: ['bass', 'dubstep', 'wobble', 'bass music'],
    description: 'Iconic wobble bass — the signature sound of dubstep',
  },
  {
    id: 'bass-dubstep-heavy',
    name: 'Heavy Dubstep Bass',
    type: 'bass',
    color: '#00ccaa',
    instrument: { synthType: 'fm', attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.5, distortion: 0.45 },
    tags: ['bass', 'dubstep', 'heavy', 'bass music'],
    description: 'Massive mid-range bass for dubstep drops',
  },
  {
    id: 'bass-reese',
    name: 'Reese Sub',
    type: 'bass',
    color: '#008899',
    instrument: { synthType: 'fm', attack: 0.01, decay: 0.3, sustain: 0.85, release: 0.4, distortion: 0.3 },
    tags: ['bass', 'dubstep', 'reese', 'sub'],
    description: 'Reese-style sub bass for bass music',
  },
  {
    id: 'fx-wobble',
    name: 'Wobble FX',
    type: 'fx',
    color: '#33ffcc',
    instrument: { synthType: 'fm', attack: 0.1, decay: 0.5, sustain: 0.7, release: 0.8, reverb: 0.4, delay: 0.3 },
    tags: ['fx', 'dubstep', 'wobble', 'transition'],
    description: 'Wobble effect for dubstep transitions',
  },
  {
    id: 'fx-sub-drop',
    name: 'Sub Drop',
    type: 'fx',
    color: '#22ddbb',
    instrument: { synthType: 'synth', attack: 0.5, decay: 2.0, sustain: 0.0, release: 0.5, reverb: 0.3 },
    tags: ['fx', 'dubstep', 'sub drop', 'impact'],
    description: 'Dramatic sub drop for bass music impacts',
  },
  {
    id: 'lead-dubstep',
    name: 'Dubstep Lead',
    type: 'lead',
    color: '#00ffee',
    instrument: { synthType: 'fm', attack: 0.005, decay: 0.1, sustain: 0.6, release: 0.35, distortion: 0.2 },
    tags: ['lead', 'dubstep', 'bass music', 'aggressive'],
    description: 'Aggressive FM lead for dubstep',
  },

  // ─── AMBIENT / DRONE ────────────────────────────────────────────────────────
  {
    id: 'pad-ambient-shimmer',
    name: 'Ambient Shimmer Pad',
    type: 'pad',
    color: '#aaddff',
    instrument: { synthType: 'am', attack: 3.0, decay: 1.0, sustain: 0.9, release: 5.0, reverb: 0.95, delay: 0.5 },
    tags: ['pad', 'ambient', 'shimmer', 'ethereal'],
    description: 'Shimmering ethereal ambient pad with massive reverb',
  },
  {
    id: 'pad-drone',
    name: 'Drone Pad',
    type: 'pad',
    color: '#224477',
    instrument: { synthType: 'fm', attack: 4.0, decay: 1.5, sustain: 1.0, release: 6.0, reverb: 0.9 },
    tags: ['pad', 'ambient', 'drone'],
    description: 'Deep evolving drone pad',
  },
  {
    id: 'pad-texture',
    name: 'Texture Pad',
    type: 'pad',
    color: '#335566',
    instrument: { synthType: 'fm', attack: 2.0, decay: 0.5, sustain: 0.95, release: 4.0, reverb: 0.85, delay: 0.4 },
    tags: ['pad', 'ambient', 'texture'],
    description: 'Textural pad for ambient soundscapes',
  },
  {
    id: 'pad-evolving',
    name: 'Evolving Ambient Pad',
    type: 'pad',
    color: '#446688',
    instrument: { synthType: 'am', attack: 5.0, decay: 2.0, sustain: 0.8, release: 8.0, reverb: 0.95 },
    tags: ['pad', 'ambient', 'evolving', 'slow'],
    description: 'Slowly evolving ambient pad for long-form compositions',
  },
  {
    id: 'fx-riser-ambient',
    name: 'Ambient Riser',
    type: 'fx',
    color: '#aabbcc',
    instrument: { synthType: 'fm', attack: 3.0, decay: 0.2, sustain: 0.7, release: 1.0, reverb: 0.7 },
    tags: ['fx', 'ambient', 'riser', 'transition'],
    description: 'Slow atmospheric riser for ambient transitions',
  },
  {
    id: 'fx-noise-sweep',
    name: 'Noise Sweep',
    type: 'fx',
    color: '#99aabb',
    instrument: { synthType: 'noise', attack: 2.0, decay: 0.8, reverb: 0.6 },
    tags: ['fx', 'ambient', 'noise', 'sweep'],
    description: 'White noise sweep for ambient washes',
  },
  {
    id: 'keys-ambient',
    name: 'Ambient Keys',
    type: 'keys',
    color: '#667788',
    instrument: { synthType: 'am', attack: 0.08, decay: 1.2, sustain: 0.6, release: 3.0, reverb: 0.85, delay: 0.45 },
    tags: ['keys', 'ambient', 'ethereal'],
    description: 'Dreamy ambient keys with long reverb tail',
  },

  // ─── FUNK ───────────────────────────────────────────────────────────────────
  {
    id: 'kick-funk',
    name: 'Funk Kick',
    type: 'kick',
    color: '#ff8833',
    instrument: { synthType: 'membrane', pitch: 58, decay: 0.22, distortion: 0.05 },
    tags: ['kick', 'funk', 'groove'],
    description: 'Tight snappy kick for funk grooves',
  },
  {
    id: 'snare-funk-crack',
    name: 'Funk Crack Snare',
    type: 'snare',
    color: '#4477cc',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.14 },
    tags: ['snare', 'funk', 'crack', 'dry'],
    description: 'Dry cracking snare for funk',
  },
  {
    id: 'snare-funk-rim',
    name: 'Funk Rimshot',
    type: 'snare',
    color: '#3366bb',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.09 },
    tags: ['snare', 'funk', 'rimshot'],
    description: 'Sharp rimshot for funky syncopated patterns',
  },
  {
    id: 'hihat-funk-tight',
    name: 'Tight Funk Hat',
    type: 'hihat',
    color: '#ffcc11',
    instrument: { synthType: 'metal', decay: 0.05 },
    tags: ['hihat', 'funk', 'tight'],
    description: 'Very tight 16th-note hat for funk',
  },
  {
    id: 'hihat-funk-ghost',
    name: 'Funk Ghost Hat',
    type: 'hihat',
    color: '#bbaa11',
    instrument: { synthType: 'metal', decay: 0.04 },
    tags: ['hihat', 'funk', 'ghost', 'quiet'],
    description: 'Ghost hi-hat for funky in-between accents',
  },
  {
    id: 'bass-funk',
    name: 'Funk Bass',
    type: 'bass',
    color: '#ff44bb',
    instrument: { synthType: 'synth', attack: 0.008, decay: 0.14, sustain: 0.5, release: 0.2 },
    tags: ['bass', 'funk', 'groove'],
    description: 'Slap-funk inspired bass with groove',
  },

  // ─── FUTURE BASS ────────────────────────────────────────────────────────────
  {
    id: 'pad-supersaw',
    name: 'Supersaw Pad',
    type: 'pad',
    color: '#ff00ff',
    instrument: { synthType: 'am', attack: 0.06, decay: 0.2, sustain: 0.85, release: 1.2, reverb: 0.7 },
    tags: ['pad', 'future bass', 'supersaw', 'edm'],
    description: 'Classic supersaw chord pad — future bass & EDM staple',
  },
  {
    id: 'pad-future-chord',
    name: 'Future Bass Chord',
    type: 'pad',
    color: '#cc00ff',
    instrument: { synthType: 'fm', attack: 0.04, decay: 0.2, sustain: 0.9, release: 1.5, reverb: 0.75, delay: 0.3 },
    tags: ['pad', 'future bass', 'chord', 'edm'],
    description: 'Characteristic future bass chord stab with reverb',
  },
  {
    id: 'lead-future',
    name: 'Future Bass Lead',
    type: 'lead',
    color: '#9900ff',
    instrument: { synthType: 'fm', attack: 0.003, decay: 0.1, sustain: 0.65, release: 0.45, reverb: 0.4 },
    tags: ['lead', 'future bass', 'edm', 'melodic'],
    description: 'Bright melodic lead for future bass drops',
  },
  {
    id: 'lead-airy',
    name: 'Airy Synth Lead',
    type: 'lead',
    color: '#bb00ee',
    instrument: { synthType: 'am', attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.8, reverb: 0.55 },
    tags: ['lead', 'future bass', 'airy', 'ethereal'],
    description: 'Airy, breath-like synth lead',
  },
  {
    id: 'bass-future',
    name: 'Future Bass',
    type: 'bass',
    color: '#ff11ff',
    instrument: { synthType: 'fm', attack: 0.01, decay: 0.18, sustain: 0.75, release: 0.3, distortion: 0.15 },
    tags: ['bass', 'future bass', 'edm'],
    description: 'Punchy midrange bass for future bass',
  },
  {
    id: 'bass-heavy-drop',
    name: 'Heavy Drop Bass',
    type: 'bass',
    color: '#ee00ee',
    instrument: { synthType: 'fm', attack: 0.008, decay: 0.25, sustain: 0.8, release: 0.4, distortion: 0.35 },
    tags: ['bass', 'future bass', 'heavy', 'drop', 'edm'],
    description: 'Massive heavy bass for drops',
  },
  {
    id: 'pluck-future',
    name: 'Future Bass Pluck',
    type: 'pluck',
    color: '#cc22ff',
    instrument: { synthType: 'fm', attack: 0.001, decay: 0.35, sustain: 0.0, release: 0.5, reverb: 0.6, delay: 0.25 },
    tags: ['pluck', 'future bass', 'edm', 'melodic'],
    description: 'Bright pluck for future bass melodies',
  },

  // ─── LATIN ──────────────────────────────────────────────────────────────────
  {
    id: 'perc-claves',
    name: 'Claves',
    type: 'perc',
    color: '#ffcc44',
    instrument: { synthType: 'membrane', pitch: 800, decay: 0.04 },
    tags: ['perc', 'latin', 'claves', 'salsa', 'afro'],
    description: 'Sharp wooden claves — essential Latin rhythm',
  },
  {
    id: 'perc-maracas',
    name: 'Maracas',
    type: 'perc',
    color: '#ddaa33',
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.06 },
    tags: ['perc', 'latin', 'maracas', 'salsa'],
    description: 'Rattling maracas for Latin groove',
  },
  {
    id: 'perc-timbale',
    name: 'Timbale',
    type: 'perc',
    color: '#ee9922',
    instrument: { synthType: 'membrane', pitch: 320, decay: 0.1, reverb: 0.1 },
    tags: ['perc', 'latin', 'timbale', 'salsa'],
    description: 'Bright timbale hit for Latin music',
  },
  {
    id: 'perc-cowbell',
    name: 'Cowbell',
    type: 'perc',
    color: '#ccbb00',
    instrument: { synthType: 'metal', decay: 0.35 },
    tags: ['perc', 'latin', 'cowbell', 'disco', 'funk'],
    description: 'Metallic cowbell — more cowbell!',
  },
  {
    id: 'bass-latin',
    name: 'Latin Bass',
    type: 'bass',
    color: '#ff5533',
    instrument: { synthType: 'synth', attack: 0.005, decay: 0.16, sustain: 0.55, release: 0.25 },
    tags: ['bass', 'latin', 'salsa', 'mambo'],
    description: 'Bouncy walking bass for Latin genres',
  },
  {
    id: 'lead-latin',
    name: 'Latin Lead',
    type: 'lead',
    color: '#00ccff',
    instrument: { synthType: 'fm', attack: 0.004, decay: 0.1, sustain: 0.6, release: 0.5, reverb: 0.3 },
    tags: ['lead', 'latin', 'salsa', 'melodic'],
    description: 'Melodic lead for Latin music',
  },
];

export const DEFAULT_CHANNELS: Omit<Channel, 'id'>[] = [
  {
    name: 'Kick',
    type: 'kick',
    color: '#ff4444',
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'membrane', pitch: 60, decay: 0.3, distortion: 0.2 },
  },
  {
    name: 'Clap',
    type: 'clap',
    color: '#ff8800',
    volume: 0.75,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.15 },
  },
  {
    name: 'Hi-Hat',
    type: 'hihat',
    color: '#ffcc00',
    volume: 0.7,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'metal', decay: 0.1 },
  },
  {
    name: 'Open Hat',
    type: 'openhat',
    color: '#88cc00',
    volume: 0.65,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'metal', decay: 0.5 },
  },
  {
    name: 'Snare',
    type: 'snare',
    color: '#00ccff',
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'noise', attack: 0.001, decay: 0.2 },
  },
  {
    name: 'Perc',
    type: 'perc',
    color: '#aa44ff',
    volume: 0.6,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'membrane', pitch: 200, decay: 0.1 },
  },
  {
    name: 'Bass',
    type: 'bass',
    color: '#ff44aa',
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'synth', attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.5 },
  },
  {
    name: 'Lead',
    type: 'synth',
    color: '#44aaff',
    volume: 0.7,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'fm', attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.8 },
  },
  // Extended channels — trap / pluggnb producers
  {
    name: 'Sub 808',
    type: 'sub808',
    color: '#cc2200',
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'synth', attack: 0.01, decay: 1.5, sustain: 0.8, release: 0.5, distortion: 0.2 },
  },
  {
    name: 'Dark Pad',
    type: 'pad',
    color: '#6600cc',
    volume: 0.65,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'am', attack: 1.0, decay: 0.5, sustain: 0.8, release: 2.0, reverb: 0.8 },
  },
  {
    name: 'Bell',
    type: 'bell',
    color: '#44ffcc',
    volume: 0.6,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'fm', attack: 0.001, decay: 1.5, sustain: 0.1, release: 1.5, reverb: 0.6 },
  },
  {
    name: 'Pluck',
    type: 'pluck',
    color: '#ff44aa',
    volume: 0.65,
    pan: 0,
    muted: false,
    solo: false,
    steps: Array(16).fill(false),
    instrument: { synthType: 'fm', attack: 0.001, decay: 0.4, sustain: 0.0, release: 0.5, reverb: 0.5 },
  },
];

export const NOTES_PER_OCTAVE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTES_PER_OCTAVE[midi % 12];
  return `${note}${octave}`;
}

export function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const noteIndex = NOTES_PER_OCTAVE.indexOf(match[1]);
  const octave = parseInt(match[2]);
  return (octave + 1) * 12 + noteIndex;
}

export const CHANNEL_COLORS = [
  '#ff4444', '#ff8800', '#ffcc00', '#88cc00',
  '#00cc88', '#00ccff', '#4488ff', '#aa44ff',
  '#ff44aa', '#ff6644', '#aabb00', '#00bbaa',
  '#cc2200', '#6600cc', '#44ffcc', '#ff2299',
];
