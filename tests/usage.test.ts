import { describe, expect, it } from 'vitest';
import { ago, bucketDaily, deviceInfo, OPEN_GAP_MS, pushQueue, shouldOpen, topDevice, usageRate, type DailyRow, type UsageEvent } from '../src/model/usage';

describe('deviceInfo', () => {
  it('Android Chrome, iPhone Safari, Samsung, Windows Edge', () => {
    expect(deviceInfo('Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36')).toEqual({ os: 'Android', browser: 'Chrome' });
    expect(deviceInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1')).toEqual({ os: 'iOS', browser: 'Safari' });
    expect(deviceInfo('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/24.0 Chrome/117 Mobile Safari/537.36')).toEqual({ os: 'Android', browser: 'Samsung' });
    expect(deviceInfo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0')).toEqual({ os: 'Windows', browser: 'Edge' });
    expect(deviceInfo('')).toEqual({ os: 'Autre', browser: 'Autre' });
  });
});

describe('shouldOpen', () => {
  const t = 1_000_000_000_000;
  it('jamais vu, après 30 min, avant 30 min, horloge reculée', () => {
    expect(shouldOpen(undefined, t)).toBe(true);
    expect(shouldOpen(t - OPEN_GAP_MS, t)).toBe(true);
    expect(shouldOpen(t - OPEN_GAP_MS + 1, t)).toBe(false);
    expect(shouldOpen(t - 5_000, t)).toBe(false);
    expect(shouldOpen(t + 60_000, t)).toBe(true);
  });
});

describe('file d\'attente, courbes, libellés', () => {
  const ev = (ts: number): UsageEvent => ({ member: 'misa', type: 'open', ts, os: 'Android', browser: 'Chrome', standalone: true });
  it('pushQueue garde les plus récents', () => {
    let q: UsageEvent[] = [];
    for (let i = 1; i <= 5; i++) q = pushQueue(q, ev(i), 3);
    expect(q.map((e) => e.ts)).toEqual([3, 4, 5]);
  });
  it('bucketDaily : jours, puis semaines, puis mois', () => {
    const rows = (n: number): DailyRow[] => Array.from({ length: n }, (_, i) => ({ d: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), opens: 1, logins: i % 2, members: 1 }));
    expect(bucketDaily(rows(10)).length).toBe(10);
    const w = bucketDaily(rows(100), 60);
    expect(w.length).toBeLessThanOrEqual(60);
    expect(w.reduce((s, b) => s + b.opens, 0)).toBe(100);
    expect(w[0].label).toBe('2025-12-29'); // lundi de la semaine du 1er janvier 2026 (jeudi)
    const m = bucketDaily(rows(500), 60);
    expect(m.length).toBeLessThanOrEqual(60);
    expect(m.reduce((s, b) => s + b.opens, 0)).toBe(500);
    expect(m[0].label).toBe('2026-01');
  });
  it('topDevice, usageRate, ago', () => {
    const d = [{ member: 'a', os: 'iOS', browser: 'Safari', standalone: 0, n: 2 }, { member: 'a', os: 'Android', browser: 'Chrome', standalone: 1, n: 9 }];
    expect(topDevice(d, 'a')).toBe('Android · Chrome (app)');
    expect(topDevice(d, 'z')).toBe('—');
    expect(usageRate(3, 12)).toBe(25);
    expect(usageRate(0, 0)).toBe(0);
    const now = Date.UTC(2026, 10, 23, 12);
    expect(ago(null, now)).toBe('jamais');
    expect(ago(now - 3_600_000, now)).toBe('aujourd\'hui');
    expect(ago(now - 86_400_000, now)).toBe('hier');
    expect(ago(now - 5 * 86_400_000, now)).toBe('il y a 5 j');
    expect(ago(now - 120 * 86_400_000, now)).toBe('il y a 4 mois');
  });
});
