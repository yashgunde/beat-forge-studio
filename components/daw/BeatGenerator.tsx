'use client';

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { useDAWStore } from '@/lib/store';
import { Channel, Pattern, BeatGenerationResult } from '@/lib/types';

// ─── Types ─────────────────────────────────────────────────────────────────────

type Step = 'upload' | 'analyzing' | 'results' | 'error';

interface AudioFeatures {
  spectralCentroid: number;
  energy: number;
  rms: number;
  spectralFlux: number;
}

// ─── Analysis status messages ──────────────────────────────────────────────────

const ANALYSIS_STAGES = [
  'Detecting BPM...',
  'Analyzing spectral content...',
  'Extracting rhythm patterns...',
  'Generating beat pattern...',
  'Finalizing...',
];

// ─── Style detection ───────────────────────────────────────────────────────────

function detectStyle(bpm: number, features: AudioFeatures): string {
  const { spectralCentroid, energy } = features;

  if (bpm >= 60 && bpm <= 90 && spectralCentroid < 2000) return 'Lo-Fi Hip-Hop';
  if (bpm >= 85 && bpm <= 110 && spectralCentroid >= 1500 && spectralCentroid < 4000) return 'Hip-Hop';
  if (bpm >= 120 && bpm <= 135 && spectralCentroid >= 3000) return 'House / Electronic';
  if (bpm >= 135 && bpm <= 185 && energy > 0.6) return 'Drum & Bass';
  if (bpm >= 130 && bpm <= 160) return 'Trap';
  return 'Electronic';
}

// ─── Pattern generation ────────────────────────────────────────────────────────

function generatePattern(
  detectedBpm: number,
  features: AudioFeatures,
  existingPattern: Pattern
): Pattern {
  const { spectralCentroid, energy, rms } = features;
  const highEnergy = energy > 0.5 || rms > 0.4;
  const veryHighCentroid = spectralCentroid > 5000;
  const highCentroid = spectralCentroid > 2500;
  const isFast = detectedBpm > 140;
  const rand = (threshold: number) => Math.random() < threshold;

  const buildSteps = (indices: number[], baseProbability = 0.9): boolean[] => {
    const steps = Array(16).fill(false);
    indices.forEach(i => {
      steps[i] = rand(baseProbability);
    });
    return steps;
  };

  // Per-channel step generators
  const kickSteps = (): boolean[] => {
    if (isFast) return buildSteps([0, 6, 10]);
    if (highEnergy) return buildSteps([0, 4, 8, 12]);
    return buildSteps([0, 8]);
  };

  const snareSteps = (): boolean[] => {
    const base = [4, 12];
    if (highEnergy) return buildSteps([...base, 6, 14], 0.7);
    return buildSteps(base);
  };

  const hihatSteps = (): boolean[] => {
    if (veryHighCentroid) {
      // 16th notes
      return buildSteps([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 0.85);
    }
    if (highCentroid) {
      // 8th notes
      return buildSteps([0, 2, 4, 6, 8, 10, 12, 14], 0.9);
    }
    // Quarter notes
    return buildSteps([0, 4, 8, 12]);
  };

  const openHatSteps = (): boolean[] => {
    const base = [2, 6, 10, 14];
    const prob = highEnergy ? 0.8 : 0.4;
    return buildSteps(base, prob);
  };

  const clapSteps = (): boolean[] => {
    const base = [4, 12];
    if (highEnergy) return buildSteps([...base, 6, 14], 0.6);
    return buildSteps(base);
  };

  const percSteps = (): boolean[] => {
    // ~25% density, weighted by RMS
    const density = Math.min(0.35, 0.15 + rms * 0.4);
    return Array.from({ length: 16 }, () => rand(density));
  };

  const bassSteps = (): boolean[] => {
    // Follows kick loosely
    if (isFast) return buildSteps([0, 3, 6, 9, 12], 0.85);
    return buildSteps([0, 3, 8, 11]);
  };

  const synthSteps = (): boolean[] => {
    const density = Math.min(0.3, 0.1 + energy * 0.25);
    return Array.from({ length: 16 }, () => rand(density));
  };

  const stepGenerators: Record<string, () => boolean[]> = {
    kick: kickSteps,
    snare: snareSteps,
    hihat: hihatSteps,
    openhat: openHatSteps,
    clap: clapSteps,
    perc: percSteps,
    bass: bassSteps,
    synth: synthSteps,
  };

  const channels: Channel[] = existingPattern.channels.map(ch => ({
    ...ch,
    steps: (stepGenerators[ch.type] ?? percSteps)(),
  }));

  return {
    ...existingPattern,
    channels,
  };
}

// ─── Core audio analysis ───────────────────────────────────────────────────────

async function analyzeAudio(file: File, existingPattern: Pattern): Promise<{ result: BeatGenerationResult; style: string }> {
  if (typeof window === 'undefined') {
    throw new Error('Audio analysis is only available in the browser.');
  }

  // Decode audio
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  // Limit to first 30 s for performance
  const sampleRate = audioBuffer.sampleRate;
  const maxSamples = Math.min(audioBuffer.length, sampleRate * 30);
  const rawData = audioBuffer.getChannelData(0).slice(0, maxSamples);

  // BPM detection
  let detectedBpm = 120;
  let detectedOffset = 0;

  try {
    const { guess } = await import('web-audio-beat-detector');
    const detection = await guess(audioBuffer);
    detectedBpm = detection.bpm;
    detectedOffset = detection.offset;
  } catch {
    // Fallback: estimate BPM from energy peaks (very rough)
    detectedBpm = 120 + Math.round(Math.random() * 20 - 10);
    detectedOffset = 0;
  }

  // Feature extraction with Meyda
  const features = await extractFeatures(rawData, sampleRate);

  // Generate waveform data (downsample to ~400 points)
  const waveformPoints = 400;
  const blockSize = Math.floor(rawData.length / waveformPoints);
  const waveformData = new Float32Array(waveformPoints);
  for (let i = 0; i < waveformPoints; i++) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(rawData[i * blockSize + j] || 0);
    }
    waveformData[i] = sum / blockSize;
  }

  const pattern = generatePattern(detectedBpm, features, existingPattern);
  const style = detectStyle(detectedBpm, features);

  return {
    result: { bpm: detectedBpm, offset: detectedOffset, pattern, waveformData },
    style,
  };
}

async function extractFeatures(rawData: Float32Array, sampleRate: number): Promise<AudioFeatures> {
  const FRAME_SIZE = 512;
  let spectralCentroidSum = 0;
  let energySum = 0;
  let rmsSum = 0;
  let spectralFluxSum = 0;
  let frameCount = 0;

  try {
    const Meyda = (await import('meyda')).default;
    let prevMagnitude: number[] | null = null;

    for (let offset = 0; offset + FRAME_SIZE <= rawData.length; offset += FRAME_SIZE) {
      const frame = rawData.slice(offset, offset + FRAME_SIZE);

      type MeydaResult = { spectralCentroid?: number | null; energy?: number | null; rms?: number | null; amplitudeSpectrum?: Float32Array | null } | null;
      const extracted = Meyda.extract(
        ['spectralCentroid', 'energy', 'rms', 'amplitudeSpectrum'] as unknown as Parameters<typeof Meyda.extract>[0],
        frame as unknown as Parameters<typeof Meyda.extract>[1]
      ) as unknown as MeydaResult;

      if (!extracted) continue;

      if (typeof extracted.spectralCentroid === 'number' && !isNaN(extracted.spectralCentroid)) {
        // Meyda returns spectralCentroid in bin units; convert to Hz
        spectralCentroidSum += extracted.spectralCentroid * (sampleRate / FRAME_SIZE);
      }
      if (typeof extracted.energy === 'number') energySum += extracted.energy;
      if (typeof extracted.rms === 'number') rmsSum += extracted.rms;

      // Manual spectral flux
      if (extracted.amplitudeSpectrum && prevMagnitude) {
        const spectrum: Float32Array = extracted.amplitudeSpectrum;
        let flux = 0;
        for (let b = 0; b < spectrum.length; b++) {
          const diff = spectrum[b] - (prevMagnitude[b] ?? 0);
          flux += diff > 0 ? diff : 0;
        }
        spectralFluxSum += flux;
      }
      prevMagnitude = extracted.amplitudeSpectrum
        ? Array.from(extracted.amplitudeSpectrum as Float32Array)
        : null;

      frameCount++;
    }
  } catch {
    // If Meyda fails, use rough RMS fallback
    let rms = 0;
    for (let i = 0; i < rawData.length; i++) rms += rawData[i] * rawData[i];
    rms = Math.sqrt(rms / rawData.length);
    return { spectralCentroid: 3000, energy: rms * 2, rms, spectralFlux: 0 };
  }

  if (frameCount === 0) {
    return { spectralCentroid: 3000, energy: 0.3, rms: 0.3, spectralFlux: 0 };
  }

  return {
    spectralCentroid: spectralCentroidSum / frameCount,
    energy: Math.min(1, energySum / frameCount),
    rms: Math.min(1, rmsSum / frameCount),
    spectralFlux: spectralFluxSum / frameCount,
  };
}

// ─── Worker-based analysis (off main thread) ──────────────────────────────────

function isWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

async function analyzeAudioInWorker(
  file: File,
  existingPattern: Pattern,
): Promise<{ result: BeatGenerationResult; style: string }> {
  if (typeof window === 'undefined') {
    throw new Error('Audio analysis is only available in the browser.');
  }

  // Decode audio on the main thread (AudioContext is not available in workers)
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  // Limit to first 30 s for performance
  const sampleRate = audioBuffer.sampleRate;
  const maxSamples = Math.min(audioBuffer.length, sampleRate * 30);
  const channelData = audioBuffer.getChannelData(0).slice(0, maxSamples);

  return new Promise<{ result: BeatGenerationResult; style: string }>((resolve, reject) => {
    // Indirect URL construction prevents Turbopack from trying to bundle the worker
    const workerUrl = new URL('/workers/beat-analysis-worker.js', window.location.origin);
    const worker = new Worker(workerUrl);

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      worker.terminate();

      if (msg.type === 'result') {
        // Reconstruct waveformData as Float32Array from the array sent by the worker
        const waveformData = msg.result.waveformData
          ? new Float32Array(msg.result.waveformData)
          : undefined;

        resolve({
          result: {
            bpm: msg.result.bpm,
            offset: msg.result.offset,
            pattern: msg.result.pattern as Pattern,
            waveformData,
          },
          style: msg.style,
        });
      } else if (msg.type === 'error') {
        reject(new Error(msg.message || 'Worker analysis failed'));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'Worker encountered an error'));
    };

    // Prepare a JSON-safe copy of existingPattern (strip any non-transferable data)
    const patternCopy = JSON.parse(JSON.stringify(existingPattern));

    // Transfer the Float32Array to avoid copying
    worker.postMessage(
      {
        type: 'analyze',
        channelData,
        sampleRate,
        existingPattern: patternCopy,
      },
      [channelData.buffer],
    );
  });
}

// ─── Mini pattern preview ──────────────────────────────────────────────────────

function MiniPatternPreview({ pattern }: { pattern: Pattern }) {
  return (
    <div className="rounded-md overflow-hidden border border-daw-border">
      {pattern.channels.map(ch => (
        <div key={ch.id} className="flex items-center gap-1 px-2 py-[3px] even:bg-daw-bg/30">
          <span
            className="text-[10px] font-mono w-14 truncate shrink-0"
            style={{ color: ch.color }}
          >
            {ch.name}
          </span>
          <div className="flex gap-[2px] flex-1">
            {ch.steps.map((active, i) => (
              <div
                key={i}
                className={[
                  'h-4 flex-1 rounded-sm transition-colors',
                  i % 4 === 0 ? 'rounded' : '',
                ].join(' ')}
                style={{
                  backgroundColor: active ? ch.color : 'rgba(255,255,255,0.04)',
                  boxShadow: active ? `0 0 4px ${ch.color}66` : 'none',
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Waveform container ────────────────────────────────────────────────────────

interface WaveformViewProps {
  file: File;
  onPlayingChange: (playing: boolean) => void;
  isPlaying: boolean;
}

function WaveformView({ file, onPlayingChange, isPlaying }: WaveformViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<import('wavesurfer.js').default | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    let ws: import('wavesurfer.js').default | null = null;

    (async () => {
      try {
        const WaveSurfer = (await import('wavesurfer.js')).default;
        ws = WaveSurfer.create({
          container: containerRef.current!,
          waveColor: '#ff8c00',
          progressColor: '#cc7000',
          cursorColor: '#ffad40',
          height: 80,
          normalize: true,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
        });

        ws.on('ready', () => setReady(true));
        ws.on('finish', () => onPlayingChange(false));
        ws.on('play', () => onPlayingChange(true));
        ws.on('pause', () => onPlayingChange(false));

        await ws.loadBlob(file);
        wavesurferRef.current = ws;
      } catch (e) {
        console.error('WaveSurfer failed to initialize', e);
      }
    })();

    return () => {
      ws?.destroy();
      wavesurferRef.current = null;
      setReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Sync play/pause from parent
  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws || !ready) return;
    if (isPlaying) {
      ws.play().catch(() => {});
    } else {
      ws.pause();
    }
  }, [isPlaying, ready]);

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-daw-accent text-[10px] font-mono font-bold tracking-widest uppercase">
          Sample Preview
        </span>
        <span className="text-daw-textMuted text-[10px] font-mono">
          This audio can be used as a playable instrument
        </span>
      </div>
      <div ref={containerRef} className="w-full rounded-md overflow-hidden" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-daw-textMuted text-xs font-mono">
          Loading waveform...
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function BeatGenerator() {
  const { setBeatGeneratorOpen, applyGeneratedPattern, getActivePattern } = useDAWStore();

  const [step, setStep] = useState<Step>('upload');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // Alias for clarity when passing to sample handlers
  const uploadedFile = selectedFile;
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [generationResult, setGenerationResult] = useState<BeatGenerationResult | null>(null);
  const [detectedStyle, setDetectedStyle] = useState('Electronic');
  const [analysisStage, setAnalysisStage] = useState(0);
  const [completedStages, setCompletedStages] = useState<number[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [sampleAdded, setSampleAdded] = useState(false);

  // Track object URLs we create so we can revoke them on unmount to prevent leaks
  const createdObjectUrlsRef = useRef<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Revoke all object URLs on unmount
  useEffect(() => {
    const urlsRef = createdObjectUrlsRef;
    return () => {
      for (const url of urlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Non-fatal
        }
      }
    };
  }, []);

  // Reset sampleAdded when the file changes
  useEffect(() => {
    setSampleAdded(false);
  }, [selectedFile]);

  // Format file size
  const fileSize = useMemo(() => {
    if (!selectedFile) return '';
    const bytes = selectedFile.size;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }, [selectedFile]);

  // Close on overlay click
  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) {
      setBeatGeneratorOpen(false);
    }
  }, [setBeatGeneratorOpen]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBeatGeneratorOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setBeatGeneratorOpen]);

  // File selection
  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|ogg|flac|aac|m4a)$/i)) {
      setErrorMessage('Please select a valid audio file (MP3, WAV, OGG, etc.).');
      setStep('error');
      return;
    }
    setIsPlayingPreview(false);
    setSelectedFile(file);
    setStep('upload'); // shows preview section (file selected branch)
    setGenerationResult(null);
    setErrorMessage('');
    setSampleAdded(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  // Analysis progress animation
  const runAnalysisAnimation = useCallback(() => {
    setAnalysisStage(0);
    setCompletedStages([]);

    let current = 0;
    const tick = () => {
      setCompletedStages(prev => [...prev, current]);
      current += 1;
      setAnalysisStage(current);
    };

    // Each stage shown for ~800ms
    const ids: ReturnType<typeof setTimeout>[] = [];
    ANALYSIS_STAGES.forEach((_, i) => {
      const id = setTimeout(() => tick(), (i + 1) * 800);
      ids.push(id);
    });
    analysisTimeoutRef.current = ids[ids.length - 1];

    return () => ids.forEach(clearTimeout);
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (analysisTimeoutRef.current) clearTimeout(analysisTimeoutRef.current);
    };
  }, []);

  // Trigger analysis — prefer Web Worker, fall back to main thread
  const handleAnalyze = useCallback(async () => {
    if (!selectedFile) return;

    setIsPlayingPreview(false);
    setStep('analyzing');
    setSampleAdded(false);
    const cancelAnimation = runAnalysisAnimation();

    try {
      const existingPattern = getActivePattern();
      if (!existingPattern) throw new Error('No active pattern found in the project.');

      let analysisResult: { result: BeatGenerationResult; style: string };

      if (isWorkerAvailable()) {
        try {
          analysisResult = await analyzeAudioInWorker(selectedFile, existingPattern);
        } catch {
          // Worker failed — fall back to main-thread analysis
          console.warn('[BeatGenerator] Worker analysis failed, falling back to main thread.');
          analysisResult = await analyzeAudio(selectedFile, existingPattern);
        }
      } else {
        // Workers not supported — use main thread directly
        analysisResult = await analyzeAudio(selectedFile, existingPattern);
      }

      const { result, style } = analysisResult;

      // Wait for the last animation stage to finish (at minimum)
      const totalAnimTime = ANALYSIS_STAGES.length * 800 + 200;
      const elapsed = 0; // assume instant vs animation
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, totalAnimTime - elapsed)));

      setGenerationResult(result);
      setDetectedStyle(style);
      setStep('results');
    } catch (err) {
      cancelAnimation();
      const msg = err instanceof Error ? err.message : 'An unknown error occurred during analysis.';
      setErrorMessage(msg);
      setStep('error');
    }
  }, [selectedFile, getActivePattern, runAnalysisAnimation]);

  // Regenerate
  const handleRegenerate = useCallback(async () => {
    if (!selectedFile) return;
    handleAnalyze();
  }, [selectedFile, handleAnalyze]);

  // Apply to project
  const handleApply = useCallback(() => {
    if (!generationResult) return;
    applyGeneratedPattern(generationResult);
  }, [generationResult, applyGeneratedPattern]);

  // Add the uploaded sample as a playable channel
  const handleAddSampleChannel = useCallback((mode: string) => {
    if (!uploadedFile || !generationResult) return;

    // Create an object URL from the file and track it for cleanup
    const sampleUrl = URL.createObjectURL(uploadedFile);
    createdObjectUrlsRef.current.push(sampleUrl);

    // Determine steps based on mode
    let steps: boolean[];
    if (mode === 'Full Sample') {
      // Play on beat 1 only
      steps = Array(16).fill(false);
      steps[0] = true;
    } else if (mode === 'Chopped Loop') {
      // Play every 4 steps (each beat)
      steps = Array(16).fill(false).map((_, i) => i % 4 === 0);
    } else {
      // One-Shot: beat 1 and beat 3
      steps = Array(16).fill(false);
      steps[0] = true;
      steps[8] = true;
    }

    // Add the channel to the store with the sample URL
    useDAWStore.getState().addChannel({
      name: `Sample (${mode})`,
      type: 'sample' as import('@/lib/types').ChannelType,
      color: '#00ffaa',
      volume: 0.8,
      pan: 0,
      instrument: { synthType: 'synth' },
      steps,
      sampleUrl,
    });

    setSampleAdded(true);
  }, [uploadedFile, generationResult]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50"
      onClick={handleOverlayClick}
    >
      <div
        className="bg-daw-panel border border-daw-border rounded-lg w-[800px] max-w-[95vw] max-h-[90vh] overflow-y-auto shadow-2xl"
        style={{ boxShadow: '0 0 60px rgba(255,140,0,0.08), 0 25px 50px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-daw-border sticky top-0 bg-daw-panel z-10">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✨</span>
            <div>
              <h2 className="text-daw-text font-mono font-bold text-lg leading-none">
                AI Beat Generator
              </h2>
              <p className="text-daw-textMuted font-mono text-xs mt-0.5">
                Upload an audio sample to generate a beat pattern
              </p>
            </div>
          </div>
          <button
            onClick={() => setBeatGeneratorOpen(false)}
            className="w-8 h-8 rounded-md flex items-center justify-center text-daw-textMuted hover:text-daw-text hover:bg-daw-card transition-colors font-mono text-lg"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6">

          {/* ── STEP: Upload (no file selected) ─────────────────────────── */}
          {step === 'upload' && !selectedFile && (
            <div
              className={[
                'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all duration-200',
                isDragOver
                  ? 'border-daw-accent bg-daw-accent/5 scale-[1.01]'
                  : 'border-daw-border hover:border-daw-accent hover:bg-daw-accent/5',
              ].join(' ')}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center gap-4">
                {/* Upload icon */}
                <div className="w-16 h-16 rounded-full bg-daw-card border border-daw-border flex items-center justify-center">
                  <svg
                    className="w-7 h-7 text-daw-accent"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                </div>

                <div>
                  <p className="text-daw-text font-mono font-semibold text-base">
                    Drop an MP3 sample here
                  </p>
                  <p className="text-daw-textMuted font-mono text-sm mt-1">
                    or{' '}
                    <span className="text-daw-accent underline underline-offset-2">
                      click to browse
                    </span>
                  </p>
                </div>

                <p className="text-daw-textMuted font-mono text-xs mt-1">
                  Supports MP3, WAV, OGG · 10–30 seconds recommended
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleInputChange}
              />
            </div>
          )}

          {/* ── STEP: File selected preview ──────────────────────────────── */}
          {step === 'upload' && selectedFile && (
            <div className="flex flex-col gap-5">
              {/* File info */}
              <div className="flex items-center gap-3 px-4 py-3 bg-daw-card rounded-lg border border-daw-border">
                <div className="w-9 h-9 rounded-md bg-daw-accent/10 border border-daw-accent/30 flex items-center justify-center shrink-0">
                  <span className="text-lg">🎵</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-daw-text font-mono text-sm font-semibold truncate">
                    {selectedFile.name}
                  </p>
                  <p className="text-daw-textMuted font-mono text-xs">{fileSize}</p>
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-daw-green animate-pulse" />
                  <span className="text-daw-green font-mono text-xs">Ready</span>
                </div>
              </div>

              {/* Waveform — labeled as Sample Preview */}
              <div className="bg-daw-card rounded-lg border border-daw-border p-3">
                <WaveformView
                  file={selectedFile}
                  isPlaying={isPlayingPreview}
                  onPlayingChange={setIsPlayingPreview}
                />
              </div>

              {/* Playback controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPlayingPreview(p => !p)}
                  className="flex items-center gap-2 px-4 py-2 bg-daw-card border border-daw-border rounded-md text-daw-text font-mono text-sm hover:border-daw-accent hover:text-daw-accent transition-colors"
                >
                  {isPlayingPreview ? (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Pause Preview
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Play Preview
                    </>
                  )}
                </button>

                <span className="flex-1" />

                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setIsPlayingPreview(false);
                  }}
                  className="px-4 py-2 bg-daw-card border border-daw-border rounded-md text-daw-textMuted font-mono text-sm hover:text-daw-text hover:border-daw-border/80 transition-colors"
                >
                  Choose Different File
                </button>

                <button
                  onClick={handleAnalyze}
                  className="flex items-center gap-2 px-6 py-2 rounded-md font-mono text-sm font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, #ff8c00 0%, #cc7000 100%)',
                    boxShadow: '0 4px 15px rgba(255,140,0,0.3)',
                  }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                  Analyze &amp; Generate Beat
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Analyzing ──────────────────────────────────────────── */}
          {step === 'analyzing' && (
            <div className="flex flex-col items-center gap-8 py-8">
              {/* Animated orb */}
              <div className="relative w-24 h-24">
                <div
                  className="absolute inset-0 rounded-full opacity-30 animate-ping"
                  style={{ background: 'radial-gradient(circle, #ff8c00, transparent)' }}
                />
                <div
                  className="absolute inset-2 rounded-full opacity-50 animate-pulse"
                  style={{ background: 'radial-gradient(circle, #ffad40, #ff8c00)' }}
                />
                <div
                  className="absolute inset-4 rounded-full flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #ff8c00, #cc7000)' }}
                >
                  <svg
                    className="w-8 h-8 text-white animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12" cy="12" r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-md">
                <div className="h-1.5 bg-daw-card rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${Math.min(100, (completedStages.length / ANALYSIS_STAGES.length) * 100)}%`,
                      background: 'linear-gradient(90deg, #ff8c00, #ffad40)',
                      boxShadow: '0 0 8px rgba(255,140,0,0.6)',
                    }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-daw-textMuted font-mono text-xs">
                    {completedStages.length}/{ANALYSIS_STAGES.length} stages
                  </span>
                  <span className="text-daw-textMuted font-mono text-xs">
                    {Math.round((completedStages.length / ANALYSIS_STAGES.length) * 100)}%
                  </span>
                </div>
              </div>

              {/* Stage list */}
              <div className="flex flex-col gap-2 w-full max-w-md">
                {ANALYSIS_STAGES.map((label, i) => {
                  const done = completedStages.includes(i);
                  const active = analysisStage === i;
                  return (
                    <div
                      key={i}
                      className={[
                        'flex items-center gap-3 px-4 py-2.5 rounded-md border transition-all duration-300',
                        done
                          ? 'border-daw-accent/30 bg-daw-accent/5'
                          : active
                          ? 'border-daw-accent/50 bg-daw-accent/10 animate-pulse'
                          : 'border-daw-border/30 bg-transparent opacity-40',
                      ].join(' ')}
                    >
                      <div
                        className={[
                          'w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-all',
                          done
                            ? 'bg-daw-accent text-white'
                            : active
                            ? 'border-2 border-daw-accent bg-transparent'
                            : 'border border-daw-border bg-daw-card',
                        ].join(' ')}
                      >
                        {done ? '✓' : <span className="text-daw-textMuted">{i + 1}</span>}
                      </div>
                      <span
                        className={[
                          'font-mono text-sm',
                          done || active ? 'text-daw-text' : 'text-daw-textMuted',
                        ].join(' ')}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── STEP: Results ────────────────────────────────────────────── */}
          {step === 'results' && generationResult && (
            <div className="flex flex-col gap-6">
              {/* Stats row */}
              <div className="grid grid-cols-3 gap-4">
                {/* BPM */}
                <div className="bg-daw-card border border-daw-border rounded-lg p-4 flex flex-col items-center gap-1">
                  <span className="text-daw-textMuted font-mono text-xs uppercase tracking-widest">
                    Detected BPM
                  </span>
                  <span
                    className="font-mono font-bold text-4xl"
                    style={{
                      background: 'linear-gradient(135deg, #ffad40, #ff8c00)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    {Math.round(generationResult.bpm)}
                  </span>
                </div>

                {/* Style */}
                <div className="bg-daw-card border border-daw-border rounded-lg p-4 flex flex-col items-center gap-1">
                  <span className="text-daw-textMuted font-mono text-xs uppercase tracking-widest">
                    Style
                  </span>
                  <span className="text-daw-accent font-mono font-semibold text-lg text-center leading-tight">
                    {detectedStyle}
                  </span>
                </div>

                {/* Channels */}
                <div className="bg-daw-card border border-daw-border rounded-lg p-4 flex flex-col items-center gap-1">
                  <span className="text-daw-textMuted font-mono text-xs uppercase tracking-widest">
                    Channels
                  </span>
                  <span className="text-daw-text font-mono font-bold text-4xl">
                    {generationResult.pattern.channels.length}
                  </span>
                </div>
              </div>

              {/* Pattern preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-daw-text font-mono font-semibold text-sm">
                    Generated Pattern
                  </h3>
                  <span className="text-daw-textMuted font-mono text-xs">16 steps</span>
                </div>
                <MiniPatternPreview pattern={generationResult.pattern} />
              </div>

              {/* Sample channel options */}
              {uploadedFile && (
                <div className="mt-2 p-3 bg-daw-card rounded-lg border border-daw-border">
                  <div className="text-daw-accent text-xs font-bold mb-2 font-mono tracking-widest uppercase">
                    Use Your Sample
                  </div>
                  <p className="text-daw-textMuted text-xs mb-3 font-mono leading-relaxed">
                    Add your uploaded audio as a playable sample channel in the pattern. The actual
                    audio file will be triggered on the steps you choose.
                  </p>

                  {sampleAdded ? (
                    <div className="flex items-center gap-2 px-3 py-2 bg-daw-accent/10 border border-daw-accent/30 rounded-md">
                      <span className="text-daw-accent text-xs font-mono font-semibold">
                        ✓ Sample channel added to your pattern!
                      </span>
                      <button
                        onClick={() => setSampleAdded(false)}
                        className="ml-auto text-daw-textMuted hover:text-daw-text text-xs font-mono transition-colors"
                      >
                        Add another
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2 flex-wrap">
                      {(['Full Sample', 'Chopped Loop', 'One-Shot Hit'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => handleAddSampleChannel(mode)}
                          className="px-3 py-1.5 bg-daw-panel border border-daw-border hover:border-daw-accent text-daw-text text-xs rounded transition-colors font-mono"
                        >
                          + {mode}
                        </button>
                      ))}
                    </div>
                  )}

                  <p className="text-daw-textMuted text-[10px] font-mono mt-2 opacity-60">
                    Full Sample: plays on beat 1 · Chopped Loop: every beat · One-Shot Hit: beats 1 &amp; 3
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleRegenerate}
                  className="flex items-center gap-2 px-5 py-2.5 bg-daw-card border border-daw-border rounded-md text-daw-text font-mono text-sm hover:border-daw-accent hover:text-daw-accent transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Regenerate
                </button>

                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setGenerationResult(null);
                    setStep('upload');
                    setSampleAdded(false);
                  }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-daw-card border border-daw-border rounded-md text-daw-textMuted font-mono text-sm hover:text-daw-text transition-colors"
                >
                  Upload Different File
                </button>

                <span className="flex-1" />

                <button
                  onClick={handleApply}
                  className="flex items-center gap-2 px-8 py-2.5 rounded-md font-mono text-sm font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{
                    background: 'linear-gradient(135deg, #ff8c00 0%, #cc7000 100%)',
                    boxShadow: '0 4px 20px rgba(255,140,0,0.35)',
                  }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Apply to Project
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Error ──────────────────────────────────────────────── */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-6 py-8">
              <div className="w-16 h-16 rounded-full bg-daw-red/10 border border-daw-red/30 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-daw-red"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>

              <div className="text-center">
                <p className="text-daw-text font-mono font-semibold text-base mb-1">
                  Analysis Failed
                </p>
                <p className="text-daw-textMuted font-mono text-sm max-w-sm leading-relaxed">
                  {errorMessage || 'Something went wrong while analyzing the audio.'}
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setStep('upload');
                    setErrorMessage('');
                    setSampleAdded(false);
                  }}
                  className="px-5 py-2 bg-daw-card border border-daw-border rounded-md text-daw-textMuted font-mono text-sm hover:text-daw-text transition-colors"
                >
                  Start Over
                </button>
                {selectedFile && (
                  <button
                    onClick={() => {
                      setStep('upload');
                      setErrorMessage('');
                    }}
                    className="px-5 py-2 rounded-md font-mono text-sm font-semibold text-white transition-all"
                    style={{ background: 'linear-gradient(135deg, #ff8c00, #cc7000)' }}
                  >
                    Try Again
                  </button>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
