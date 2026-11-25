import { useEffect, useState } from 'preact/hooks';
import type { Api } from './api';
import { humanError } from './api';
import { DemoApi } from './demoApi';
import { SupabaseApi } from './supabaseApi';
import { syncPush } from './push';
import type { AppData, Member } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const api: Api = url && key ? new SupabaseApi(url, key) : new DemoApi();

interface State {
  ready: boolean;
  meId: string | null;
  data: AppData;
  toast: { text: string; kind: 'ok' | 'err' } | null;
}

let state: State = {
  ready: false,
  meId: null,
  data: { members: [], kids: [], eventTypes: [], meetups: [], adjustments: [] },
  toast: null,
};
const subs = new Set<() => void>();
function set(p: Partial<State>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}

export function useStore(): State {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    f(); // catch up on changes that happened before subscribing
    return () => { subs.delete(f); };
  }, []);
  return state;
}
export const getState = () => state;

export function me(): Member | undefined {
  return state.data.members.find((m) => m.id === state.meId);
}
export const isAdmin = () => me()?.role === 'admin';
export const memberById = (id: string | null | undefined) => state.data.members.find((m) => m.id === id);

let toastTimer: any;
export function toast(text: string, kind: 'ok' | 'err' = 'ok') {
  clearTimeout(toastTimer);
  set({ toast: { text, kind } });
  toastTimer = setTimeout(() => set({ toast: null }), 2400);
}

export async function boot() {
  try {
    const meId = await api.init();
    set({ meId });
    if (meId) { await refresh(); syncPush(); }
  } catch (e) {
    toast(humanError(e), 'err');
  } finally {
    set({ ready: true });
  }
}

export async function refresh() {
  const data = await api.loadAll();
  set({ data });
}

export async function setMe(id: string | null) {
  set({ meId: id });
  if (id) { await refresh(); syncPush(); }
}

/** Run a mutation, refresh data, show toast. Returns true on success. */
export async function act(fn: () => Promise<unknown>, okMsg?: string): Promise<boolean> {
  try {
    await fn();
    await refresh();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(humanError(e), 'err');
    return false;
  }
}

if (typeof window !== 'undefined') {
  const again = () => { if (state.meId && document.visibilityState === 'visible') refresh().catch(() => {}); };
  window.addEventListener('focus', again);
  document.addEventListener('visibilitychange', again);
}
