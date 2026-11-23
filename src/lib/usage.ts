/**
 * Suivi d'usage (si EDITION.tracker.url est renseigné) : ouvertures, connexions et activations par membre.
 * Les événements sont mis en file d'attente sur l'appareil puis envoyés au Worker (tracker/) ; hors ligne ils partent au retour du réseau.
 * Lecture des statistiques : Réglages > Utilisation (clé d'administration stockée sur l'appareil de l'admin).
 */
import { effect, signal } from '@preact/signals';
import { EDITION } from '../edition';
import { DEMO } from './demo';
import { session, sessionHooks } from './members';
import { kvDel, kvGet, kvSet } from './store';
import { BATCH_MAX, deviceInfo, pushQueue, shouldOpen, type Stats, type UsageEvent, type UsageType } from '../model/usage';

const CFG = EDITION.tracker;
export const trackingEnabled = !DEMO && !!CFG?.url && !!CFG?.key;

const QUEUE_KEY = 'usage.queue';
const ADMIN_KEY = 'usage.adminKey';
const ACTIVE_KEY = `${EDITION.storage}.usage.active`;

const base = () => CFG!.url.replace(/\/+$/, '');

function lastActive(): number | undefined {
  try { const v = Number(localStorage.getItem(ACTIVE_KEY)); return v > 0 ? v : undefined; } catch { return undefined; }
}
function touch(now = Date.now()) {
  try { localStorage.setItem(ACTIVE_KEY, String(now)); } catch { /* stockage indisponible */ }
}

/** Les écritures de la file passent l'une après l'autre : deux événements simultanés ne s'écrasent pas. */
let chain: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const r = chain.then(fn, fn); chain = r.catch(() => undefined); return r; };

let flushing = false;
/** Envoie la file d'attente (50 par envoi). En cas d'échec les événements restent en file. */
export async function flush(): Promise<void> {
  if (!trackingEnabled || flushing) return;
  flushing = true;
  try {
    for (let i = 0; i < 20; i++) {
      const queue = (await kvGet<UsageEvent[]>(QUEUE_KEY)) ?? [];
      if (!queue.length) return;
      const batch = queue.slice(0, BATCH_MAX);
      // text/plain : requête « simple », sans pré-vérification CORS
      const res = await fetch(`${base()}/e`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, keepalive: true,
        body: JSON.stringify({ k: CFG!.key, ev: batch }),
      });
      if (!res.ok) return;
      const sent = new Set(batch.map((e) => `${e.member}|${e.type}|${e.ts}`));
      await serial(async () => {
        const rest = ((await kvGet<UsageEvent[]>(QUEUE_KEY)) ?? []).filter((e) => !sent.has(`${e.member}|${e.type}|${e.ts}`));
        await kvSet(QUEUE_KEY, rest);
      });
    }
  } catch { /* hors ligne : on réessaiera */ } finally { flushing = false; }
}

async function track(type: UsageType, member: string, now = Date.now()) {
  if (!trackingEnabled) return;
  const standalone = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  const ev: UsageEvent = { member, type, ts: now, ...deviceInfo(navigator.userAgent), standalone };
  await serial(async () => kvSet(QUEUE_KEY, pushQueue((await kvGet<UsageEvent[]>(QUEUE_KEY)) ?? [], ev)));
  void flush();
}

/** Ouverture si le membre revient après 30 min d'inactivité (ou lancement de l'app). */
function maybeOpen() {
  const s = session.value;
  if (!s) return;
  const now = Date.now();
  const open = shouldOpen(lastActive(), now);
  touch(now);
  if (open) void track('open', s.id, now);
}

let started = false;
export function initUsage() {
  if (!trackingEnabled || started) return;
  started = true;
  sessionHooks.onLogin = (id, kind) => { void track(kind, id); };
  effect(() => { if (session.value) maybeOpen(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') touch();
    else maybeOpen();
  });
  addEventListener('pagehide', () => touch());
  addEventListener('online', () => void flush());
  void flush();
}

/* ---------- Administration : lecture des statistiques ---------- */

export const adminKeySet = signal(false);
export const getAdminKey = () => kvGet<string>(ADMIN_KEY);
export async function setAdminKey(k: string) {
  if (k.trim()) await kvSet(ADMIN_KEY, k.trim()); else await kvDel(ADMIN_KEY);
  adminKeySet.value = !!k.trim();
}
export async function initAdminKey() { adminKeySet.value = !!(await getAdminKey()); }

export class UsageError extends Error {}

async function adminFetch(path: string): Promise<Response> {
  if (!trackingEnabled) throw new UsageError('suivi non configuré');
  const key = await getAdminKey();
  if (!key) throw new UsageError('clé d\'administration absente');
  const res = await fetch(`${base()}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401) throw new UsageError('clé d\'administration refusée');
  if (!res.ok) throw new UsageError(`erreur ${res.status}`);
  return res;
}

export async function fetchStats(days: number): Promise<Stats> {
  const tz = -new Date().getTimezoneOffset();
  return (await adminFetch(`/stats?days=${days}&tz=${tz}`)).json();
}

export async function downloadCsv(): Promise<void> {
  const blob = await (await adminFetch('/export.csv')).blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gospel-system-usage-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
