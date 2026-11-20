import { describe, expect, it } from 'vitest';
import { deploy, DeployUnavailable, stateOf, trackDeploy, type RunLite } from '../src/lib/deploy';

const run = (o: Partial<RunLite> = {}): RunLite => ({ name: 'deploy', status: 'completed', conclusion: 'success', html_url: 'https://gh/run/1', ...o });

describe('stateOf', () => {
  it('aucun run (pas encore créé) ou run en cours : pending', () => {
    expect(stateOf([]).state).toBe('pending');
    expect(stateOf([run({ status: 'queued', conclusion: null })]).state).toBe('pending');
    expect(stateOf([run({ status: 'in_progress', conclusion: null })]).state).toBe('pending');
  });
  it('succès / échec, et seuls les runs « deploy » comptent', () => {
    expect(stateOf([run()])).toEqual({ state: 'success', url: 'https://gh/run/1' });
    expect(stateOf([run({ conclusion: 'failure' })])).toMatchObject({ state: 'failure', detail: 'failure', url: 'https://gh/run/1' });
    expect(stateOf([run({ name: 'ci', conclusion: 'failure' }), run()]).state).toBe('success');
    expect(stateOf([run({ name: 'ci' })]).state).toBe('pending');
  });
});

describe('trackDeploy', () => {
  const clock = () => { let t = 1000; return { now: () => t, sleep: async (ms: number) => { t += ms; } }; };

  it('pending puis succès', async () => {
    const c = clock();
    const answers = [[], [run({ status: 'in_progress', conclusion: null })], [run()]];
    let i = 0;
    await trackDeploy('abc', c.now(), { ...c, fetchRuns: async () => answers[i++], intervalMs: 15_000 });
    expect(i).toBe(3);
    expect(deploy.value).toMatchObject({ sha: 'abc', state: 'success' });
  });
  it('échec avec lien vers le run', async () => {
    const c = clock();
    await trackDeploy('def', c.now(), { ...c, fetchRuns: async () => [run({ conclusion: 'failure' })] });
    expect(deploy.value).toMatchObject({ state: 'failure', url: 'https://gh/run/1' });
  });
  it('droit manquant : indisponible, une seule requête', async () => {
    const c = clock(); let n = 0;
    await trackDeploy('ghi', c.now(), { ...c, fetchRuns: async () => { n++; throw new DeployUnavailable('droit « Actions : lecture » manquant'); } });
    expect(n).toBe(1);
    expect(deploy.value).toMatchObject({ state: 'unavailable', detail: expect.stringContaining('Actions') });
  });
  it('réseau coupé : on retente, puis résultat', async () => {
    const c = clock(); let n = 0;
    await trackDeploy('jkl', c.now(), { ...c, fetchRuns: async () => { if (n++ < 2) throw new Error('offline'); return [run()]; } });
    expect(n).toBe(3);
    expect(deploy.value?.state).toBe('success');
  });
  it('limite de durée : indisponible avec lien vers Actions', async () => {
    const c = clock(); let n = 0;
    await trackDeploy('mno', c.now(), { ...c, fetchRuns: async () => { n++; return []; }, intervalMs: 15_000, maxMs: 60_000 });
    expect(n).toBe(4);
    expect(deploy.value).toMatchObject({ state: 'unavailable', url: expect.stringContaining('/actions') });
  });
  it('sha vide (rien envoyé / démo) : aucun suivi', async () => {
    deploy.value = null;
    await trackDeploy('');
    expect(deploy.value).toBeNull();
  });
});
