/** Suivi d'usage : types et fonctions pures (appareil, seuil d'ouverture, file d'attente, regroupement des courbes). */

export type UsageType = 'open' | 'login' | 'activate';

export interface UsageEvent {
  member: string;
  type: UsageType;
  ts: number;
  os: string;
  browser: string;
  standalone: boolean;
}

/** Une « ouverture » = retour au premier plan après au moins 30 minutes d'inactivité (ou lancement de l'app). */
export const OPEN_GAP_MS = 30 * 60_000;
export const QUEUE_MAX = 500;
export const BATCH_MAX = 50;

export const shouldOpen = (lastActive: number | undefined, now: number, gap = OPEN_GAP_MS) =>
  lastActive === undefined || !(now - lastActive < gap) || now < lastActive;

/** Système et navigateur à partir du user-agent (grossier, volontairement). */
export function deviceInfo(ua: string): { os: string; browser: string } {
  const os = /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS'
    : /Linux|X11/i.test(ua) ? 'Linux' : 'Autre';
  const browser = /SamsungBrowser/i.test(ua) ? 'Samsung'
    : /Edg\//i.test(ua) ? 'Edge'
    : /Firefox|FxiOS/i.test(ua) ? 'Firefox'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /CriOS|Chrome/i.test(ua) ? 'Chrome'
    : /Safari/i.test(ua) ? 'Safari' : 'Autre';
  return { os, browser };
}

/** Ajoute un événement à la file d'attente (les plus anciens sautent au-delà de QUEUE_MAX). */
export function pushQueue(queue: UsageEvent[], ev: UsageEvent, max = QUEUE_MAX): UsageEvent[] {
  const q = [...queue, ev];
  return q.length > max ? q.slice(q.length - max) : q;
}

export interface DailyRow { d: string; opens: number; logins: number; members: number }
export interface Bar { label: string; opens: number; logins: number }

/** Barres de la courbe : un jour par barre ; au-delà de maxBars, regroupées par semaines (lundi) puis par mois. */
export function bucketDaily(daily: DailyRow[], maxBars = 60): Bar[] {
  if (daily.length <= maxBars) return daily.map((r) => ({ label: r.d, opens: r.opens ?? 0, logins: r.logins ?? 0 }));
  const key = (d: string, mode: 'week' | 'month') => {
    if (mode === 'month') return d.slice(0, 7);
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  };
  const group = (mode: 'week' | 'month') => {
    const m = new Map<string, Bar>();
    for (const r of daily) {
      const k = key(r.d, mode);
      const b = m.get(k) ?? { label: k, opens: 0, logins: 0 };
      b.opens += r.opens ?? 0; b.logins += r.logins ?? 0;
      m.set(k, b);
    }
    return [...m.values()];
  };
  const weeks = group('week');
  return weeks.length <= maxBars ? weeks : group('month');
}

export interface MemberStat {
  member: string; opens: number; logins: number; activations: number;
  opens7: number; opens30: number; logins30: number;
  first: number | null; lastOpen: number | null; lastLogin: number | null;
}
export interface DeviceStat { member: string; os: string; browser: string; standalone: number; n: number }
export interface Stats {
  days: number; tz: number; now: number;
  totals: { opens: number | null; logins: number | null; activations: number | null; active7: number | null; active30: number | null; since: number | null };
  daily: DailyRow[]; members: MemberStat[]; devices: DeviceStat[];
}

/** Appareil le plus utilisé d'un membre : « Android · Chrome (app installée) ». */
export function topDevice(devices: DeviceStat[], member: string): string {
  const d = devices.filter((x) => x.member === member).sort((a, b) => b.n - a.n)[0];
  return d ? `${d.os} · ${d.browser}${d.standalone ? ' (app)' : ''}` : '—';
}

/** Taux d'utilisation : membres actifs (au moins une ouverture) ÷ membres inscrits. */
export const usageRate = (active: number, registered: number) => (registered > 0 ? Math.round((active / registered) * 100) : 0);

/** Délai lisible : « aujourd'hui », « hier », « il y a 5 j », « il y a 3 mois », « jamais ». */
export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'jamais';
  const days = Math.floor((now - ts) / 86_400_000);
  if (days <= 0) return 'aujourd\'hui';
  if (days === 1) return 'hier';
  if (days < 60) return `il y a ${days} j`;
  return `il y a ${Math.round(days / 30)} mois`;
}
