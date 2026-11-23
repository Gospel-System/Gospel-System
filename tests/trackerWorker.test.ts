import { describe, expect, it } from 'vitest';
// @ts-expect-error worker JavaScript (collé tel quel dans Cloudflare)
import worker, { cleanEvent, stats } from '../tracker/worker.js';

let sqlite: typeof import('node:sqlite') | null = null;
try { sqlite = await import('node:sqlite'); } catch { /* Node sans node:sqlite : tests SQL ignorés */ }

/** Mini adaptateur D1 par-dessus SQLite (même SQL que Cloudflare). */
function fakeD1() {
  const db = new sqlite!.DatabaseSync(':memory:');
  db.exec((globalThis as any).__schema);
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    run: async () => { db.prepare(sql).run(...(args as any[])); return {}; },
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    exec: () => db.prepare(sql).run(...(args as any[])),
  });
  return { prepare: (sql: string) => stmt(sql), batch: async (list: any[]) => { list.forEach((s) => s.exec()); return []; }, raw: db };
}

import { readFileSync } from 'node:fs';
(globalThis as any).__schema = readFileSync('tracker/schema.sql', 'utf8');

const NOW = Date.UTC(2026, 10, 23, 15, 0, 0);

describe('cleanEvent', () => {
  it('accepte un événement valide et nettoie les champs', () => {
    expect(cleanEvent({ member: ' Misa ', type: 'open', ts: NOW - 1000, os: 'Android<script>', browser: 'Chrome', standalone: true }, NOW))
      .toEqual({ member: 'misa', type: 'open', ts: NOW - 1000, os: 'Androidscript', browser: 'Chrome', standalone: 1, ver: '' });
  });
  it('refuse : id invalide, type inconnu, date trop ancienne ou future', () => {
    const ok = { member: 'misa', type: 'open', ts: NOW };
    expect(cleanEvent({ ...ok, member: 'a b' }, NOW)).toBeNull();
    expect(cleanEvent({ ...ok, member: 'x' }, NOW)).toBeNull();
    expect(cleanEvent({ ...ok, type: 'delete' }, NOW)).toBeNull();
    expect(cleanEvent({ ...ok, ts: NOW - 32 * 86_400_000 }, NOW)).toBeNull();
    expect(cleanEvent({ ...ok, ts: NOW + 2 * 3_600_000 }, NOW)).toBeNull();
    expect(cleanEvent({ ...ok, ts: 'abc' }, NOW)).toBeNull();
    expect(cleanEvent(null, NOW)).toBeNull();
  });
});

describe.skipIf(!sqlite)('Worker : envoi, statistiques, export', () => {
  const mkEnv = () => ({ DB: fakeD1(), INGEST_KEY: 'ingest-key', ADMIN_KEY: 'admin-key', ALLOWED_ORIGIN: 'https://gospel-system.github.io' });
  const post = (env: any, body: unknown, origin = 'https://gospel-system.github.io') =>
    worker.fetch(new Request('https://w.test/e', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }), env);
  const get = (env: any, path: string, key = 'admin-key') =>
    worker.fetch(new Request(`https://w.test${path}`, { headers: { Authorization: `Bearer ${key}`, Origin: 'https://gospel-system.github.io' } }), env);

  it('refuse mauvaise clé d\'envoi et mauvaise origine ; accepte et dédoublonne', async () => {
    const env = mkEnv();
    const ev = [{ member: 'misa', type: 'open', ts: Date.now() - 1000, os: 'Android', browser: 'Chrome', standalone: true }];
    expect((await post(env, { k: 'faux', ev })).status).toBe(401);
    expect((await post(env, { k: 'ingest-key', ev }, 'https://evil.example')).status).toBe(403);
    const r = await post(env, { k: 'ingest-key', ev: [...ev, { member: '??', type: 'open', ts: 1 }] });
    expect(await r.json()).toMatchObject({ ok: true, accepted: 1, received: 2 });
    await post(env, { k: 'ingest-key', ev }); // renvoi après coupure : pas de doublon
    expect((env.DB.raw.prepare('SELECT COUNT(*) n FROM events').get() as any).n).toBe(1);
  });

  it('statistiques : ouvertures, connexions par membre, actifs 7/30 jours, appareils', async () => {
    const env = mkEnv();
    const day = 86_400_000, now = Date.now();
    const ins = env.DB.raw.prepare('INSERT INTO events (member, type, ts, os, browser, standalone) VALUES (?,?,?,?,?,?)');
    ins.run('misa', 'activate', now - 40 * day, 'Android', 'Chrome', 1);
    ins.run('misa', 'login', now - 40 * day + 1, 'Android', 'Chrome', 1);
    ins.run('misa', 'open', now - 40 * day, 'Android', 'Chrome', 1);
    ins.run('misa', 'open', now - 2 * day, 'Android', 'Chrome', 1);
    ins.run('misa', 'open', now - 1 * day, 'Android', 'Chrome', 1);
    ins.run('misa', 'login', now - 1 * day, 'Android', 'Chrome', 1);
    ins.run('paul', 'open', now - 20 * day, 'iOS', 'Safari', 0);
    ins.run('paul', 'login', now - 20 * day, 'iOS', 'Safari', 0);
    const s = await stats(env, 90, 60, now);
    expect(s.totals).toMatchObject({ opens: 4, logins: 3, activations: 1, active7: 1, active30: 2 });
    const misa = s.members.find((m: any) => m.member === 'misa');
    expect(misa).toMatchObject({ opens: 3, logins: 2, activations: 1, opens7: 2, opens30: 2, logins30: 1 });
    expect(misa.lastOpen).toBe(now - day);
    expect(s.members.find((m: any) => m.member === 'paul')).toMatchObject({ opens: 1, logins: 1, opens30: 1, opens7: 0 });
    expect(s.daily.reduce((n: number, d: any) => n + d.opens, 0)).toBe(4);
    expect(s.daily.reduce((n: number, d: any) => n + d.logins, 0)).toBe(4); // connexions + activation
    expect(s.devices[0]).toMatchObject({ member: 'misa', os: 'Android', n: 3 });
    // Période courte : seules les 7 dernières journées dans la courbe
    expect((await stats(env, 7, 60, now)).daily.reduce((n: number, d: any) => n + d.opens, 0)).toBe(2);
  });

  it('routes d\'administration : clé requise, JSON puis export CSV', async () => {
    const env = mkEnv();
    env.DB.raw.prepare('INSERT INTO events (member, type, ts) VALUES (?,?,?)').run('misa', 'open', Date.now() - 1000);
    expect((await get(env, '/stats', 'faux')).status).toBe(401);
    expect((await worker.fetch(new Request('https://w.test/stats'), env)).status).toBe(401);
    const j = await (await get(env, '/stats?days=30&tz=60')).json();
    expect(j.totals.opens).toBe(1);
    const csv = await get(env, '/export.csv');
    expect(csv.headers.get('Content-Type')).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\n')[0]).toBe('date_utc,membre,type,systeme,navigateur,app_installee,version');
    expect(text).toContain(',misa,open,');
    expect((await worker.fetch(new Request('https://w.test/'), env)).status).toBe(200);
    expect((await worker.fetch(new Request('https://w.test/nope'), env)).status).toBe(404);
  });
});
