'use client';

/**
 * IndexedDB storage adapter for Zustand's `persist` middleware.
 *
 * Uses `idb-keyval` for the store state, plus a separate "samples" store
 * for raw audio ArrayBuffers so blob: URLs survive page refresh.
 */

import { get, set, del, createStore } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

// ── Zustand state store ──────────────────────────────────────────────────────

const stateStore = createStore('ygbeatz-state', 'keyval');

export const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const value = await get<string>(name, stateStore);
    return value ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value, stateStore);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name, stateStore);
  },
};

// ── Sample audio blob store ──────────────────────────────────────────────────

const sampleStore = createStore('ygbeatz-samples', 'keyval');

/**
 * Save an audio file's ArrayBuffer into IndexedDB keyed by a stable ID.
 * Returns a persistent key that can be used to retrieve it later.
 */
export async function saveSampleToIDB(
  sampleId: string,
  arrayBuffer: ArrayBuffer
): Promise<string> {
  await set(sampleId, arrayBuffer, sampleStore);
  return sampleId;
}

/**
 * Retrieve a stored audio ArrayBuffer and create a fresh blob: URL.
 * Returns null if not found.
 */
export async function loadSampleFromIDB(
  sampleId: string
): Promise<string | null> {
  const buffer = await get<ArrayBuffer>(sampleId, sampleStore);
  if (!buffer) return null;
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Delete a stored sample from IndexedDB.
 */
export async function deleteSampleFromIDB(sampleId: string): Promise<void> {
  await del(sampleId, sampleStore);
}
