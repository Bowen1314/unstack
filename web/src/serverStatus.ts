/** Server status (mode, unit ledger, LLM spend) shared by the header and every screen. */
import { useEffect, useSyncExternalStore } from 'react';
import type { StatusResponse } from '../../shared/api.ts';
import { api } from './api.ts';

export interface ServerState {
  status: StatusResponse | null;
  phase: 'loading' | 'ok' | 'offline';
  checkedAt: number | null;
}

let snapshot: ServerState = { status: null, phase: 'loading', checkedAt: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: ServerState): void {
  snapshot = next;
  for (const l of listeners) l();
}

export function refreshStatus(): Promise<void> {
  if (inflight) return inflight;
  inflight = api
    .status()
    .then((status) => set({ status, phase: 'ok', checkedAt: Date.now() }))
    .catch(() => set({ status: snapshot.status, phase: 'offline', checkedAt: Date.now() }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const POLL_MS = 20_000;
let pollers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Subscribe to server status; the first subscriber starts a light 20 s poll while the tab is visible. */
export function useServerStatus(): ServerState {
  useEffect(() => {
    pollers++;
    if (pollers === 1) {
      void refreshStatus();
      timer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') void refreshStatus();
      }, POLL_MS);
    }
    return () => {
      pollers--;
      if (pollers === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
