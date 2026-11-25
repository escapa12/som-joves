// Web Push on this device: register the service worker, ask permission, store the subscription in the backend.
import { useEffect, useState } from 'preact/hooks';
import { api } from './store';

/** Public VAPID key (the private one is a GitHub Actions secret). */
export const VAPID_PUBLIC_KEY = 'BCFGCZiILB0askpVdTheP3rHc0cJRKpzRpLGwMAI31V2PdL81sU_LSesf9PepJc_J8qE9goemD1L0tBjzbdiWAk';

export type PushStatus = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

let reg: Promise<ServiceWorkerRegistration | null> | null = null;
export function registerSW() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return (reg ??= navigator.serviceWorker.register('./sw.js').catch(() => null));
}

function b64ToBytes(b64: string) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
function toSub(s: PushSubscription) {
  const j = s.toJSON() as any;
  return { endpoint: s.endpoint, p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' };
}

export async function pushStatus(): Promise<PushStatus> {
  if (typeof window !== 'undefined' && isIos() && !standalone()) return 'ios-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const r = await registerSW();
  const s = await r?.pushManager.getSubscription();
  return s && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'permis_denegat' : 'permis_no_donat');
  const r = await registerSW();
  if (!r) throw new Error('subscripcio_invalida');
  await navigator.serviceWorker.ready;
  const s = (await r.pushManager.getSubscription()) ?? (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) }));
  await api.pushSubscribe(toSub(s));
}

export async function disablePush() {
  const r = await registerSW();
  const s = await r?.pushManager.getSubscription();
  if (!s) return;
  await api.pushUnsubscribe(s.endpoint).catch(() => {});
  await s.unsubscribe();
}

/** After login: re-send an existing subscription so it is bound to the current member (idempotent). */
export async function syncPush() {
  if (!supported() || Notification.permission !== 'granted') return;
  const s = await (await registerSW())?.pushManager.getSubscription();
  if (s) await api.pushSubscribe(toSub(s)).catch(() => {});
}

export function usePushStatus(): [PushStatus, () => void] {
  const [st, setSt] = useState<PushStatus>('loading');
  const reload = () => { pushStatus().then(setSt).catch(() => setSt('unsupported')); };
  useEffect(reload, []);
  return [st, reload];
}
