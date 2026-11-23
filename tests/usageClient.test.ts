import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/edition', async (orig) => {
  const m = await orig<typeof import('../src/edition')>();
  return { ...m, EDITION: { ...m.EDITION, tracker: { url: 'https://w.test/', key: 'KEY' } } };
});

const store = new Map<string, string>();
const sent: any[] = [];
const handlers: Record<string, () => void> = {};
let online = true;

beforeAll(() => {
  const g = globalThis as any;
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.document = { visibilityState: 'visible', addEventListener: (t: string, fn: () => void) => { handlers[t] = fn; } };
  g.addEventListener = () => undefined;
  g.fetch = async (_url: string, init: any) => {
    if (!online) throw new Error('offline');
    sent.push({ url: _url, ...JSON.parse(init.body) });
    return { ok: true, status: 200 };
  };
});

const flushAll = () => new Promise((r) => setTimeout(r, 20));

describe('suivi côté app', () => {
  let usage: typeof import('../src/lib/usage');
  let members: typeof import('../src/lib/members');
  const T0 = Date.UTC(2026, 10, 23, 10, 0, 0);

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    usage = await import('../src/lib/usage');
    members = await import('../src/lib/members');
    usage.initUsage();
  });
  afterEach(() => { sent.length = 0; });
  beforeEach(() => { online = true; });

  const events = () => sent.flatMap((b) => b.ev);

  it('activé : adresse + clé renseignées', () => { expect(usage.trackingEnabled).toBe(true); });

  it('ouverture au lancement avec une session, pas de doublon avant 30 min, nouvelle ouverture après', async () => {
    members.session.value = { id: 'misa', admin: false, at: T0, bind: 'h' };
    await flushAll();
    expect(events().map((e: any) => [e.member, e.type])).toEqual([['misa', 'open']]);
    expect(sent[0]).toMatchObject({ url: 'https://w.test/e', k: 'KEY' });
    sent.length = 0;

    vi.setSystemTime(T0 + 10 * 60_000);
    handlers.visibilitychange();
    await flushAll();
    expect(events()).toHaveLength(0);

    vi.setSystemTime(T0 + 45 * 60_000);
    handlers.visibilitychange();
    await flushAll();
    expect(events().map((e: any) => e.type)).toEqual(['open']);
  });

  it('connexion et activation : événements dédiés', async () => {
    members.sessionHooks.onLogin!('misa', 'login');
    members.sessionHooks.onLogin!('paul', 'activate');
    await flushAll();
    expect(events().map((e: any) => `${e.member}:${e.type}`)).toEqual(['misa:login', 'paul:activate']);
  });

  it('hors ligne : mis en file puis envoyés au retour du réseau, sans doublon', async () => {
    online = false;
    members.sessionHooks.onLogin!('misa', 'login');
    await flushAll();
    expect(sent).toHaveLength(0);
    online = true;
    await usage.flush();
    expect(events().filter((e: any) => e.type === 'login')).toHaveLength(1);
    sent.length = 0;
    await usage.flush();
    expect(sent).toHaveLength(0);
  });

  it('compte administrateur : ni ouverture ni connexion enregistrées', async () => {
    vi.setSystemTime(T0 + 5 * 3_600_000);
    members.session.value = { id: 'chef', admin: true, at: Date.now(), bind: 'h' };
    members.sessionHooks.onLogin!('chef', 'login');
    handlers.visibilitychange();
    await flushAll();
    expect(events()).toHaveLength(0);
  });
});
