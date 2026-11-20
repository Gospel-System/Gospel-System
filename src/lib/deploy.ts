/**
 * Suivi du déploiement après une publication (admin seulement) : lecture des runs GitHub Actions du commit publié.
 * Lecture seule, quelques requêtes espacées de 15 s ; sans le droit « Actions : lecture » le suivi est simplement indisponible.
 */
import { signal } from '@preact/signals';
import { getToken, REPO } from './publish';
import { kvGet, kvSet } from './store';

export type DeployState = 'pending' | 'success' | 'failure' | 'unavailable';
export interface DeployInfo { sha: string; state: DeployState; url?: string; detail?: string; at: number }

export interface RunLite { name: string; status: string; conclusion: string | null; html_url: string }

const KEY = 'deploy.last';
const WORKFLOW = 'deploy';
export const POLL_MS = 15_000;
export const POLL_MAX_MS = 10 * 60_000;
const RESUME_MAX_MS = 15 * 60_000;
export const SHOW_MAX_MS = 24 * 3_600_000;

export const deploy = signal<DeployInfo | null>(null);

/** Indisponible durablement (droit manquant, jeton invalide) : inutile de réessayer. */
export class DeployUnavailable extends Error {}

/** État d'un commit d'après ses runs (le plus récent en premier, comme l'API). */
export function stateOf(runs: RunLite[], workflow = WORKFLOW): { state: 'pending' | 'success' | 'failure'; url?: string; detail?: string } {
  const run = runs.find((r) => r.name === workflow);
  if (!run || run.status !== 'completed') return { state: 'pending', url: run?.html_url };
  if (run.conclusion === 'success') return { state: 'success', url: run.html_url };
  return { state: 'failure', url: run.html_url, detail: run.conclusion ?? 'échec' };
}

type FetchRuns = (sha: string) => Promise<RunLite[]>;

async function fetchRunsGitHub(sha: string): Promise<RunLite[]> {
  const token = await getToken();
  if (!token) throw new DeployUnavailable('aucun jeton sur cet appareil');
  const res = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/actions/runs?head_sha=${sha}&per_page=10`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (res.status === 401) throw new DeployUnavailable('jeton invalide ou expiré');
  if (res.status === 403 || res.status === 404) throw new DeployUnavailable('droit « Actions : lecture » manquant sur le jeton');
  if (!res.ok) throw new Error(`erreur GitHub ${res.status}`);
  return ((await res.json()) as { workflow_runs: RunLite[] }).workflow_runs;
}

let tracking = 0;

async function set(info: DeployInfo) {
  deploy.value = info;
  await kvSet(KEY, info).catch(() => undefined);
}

const actionsUrl = `https://github.com/${REPO.owner}/${REPO.repo}/actions`;

export interface PollOpts {
  fetchRuns?: FetchRuns; sleep?: (ms: number) => Promise<void>; now?: () => number; intervalMs?: number; maxMs?: number;
}

/** Interroge les runs jusqu'à un résultat définitif (succès / échec), une indisponibilité ou la limite de durée. */
export async function trackDeploy(sha: string, since = Date.now(), o: PollOpts = {}): Promise<void> {
  if (!sha) return;
  const { fetchRuns = fetchRunsGitHub, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, intervalMs = POLL_MS, maxMs = POLL_MAX_MS } = o;
  const id = ++tracking;
  await set({ sha, state: 'pending', at: since });
  while (now() - since < maxMs) {
    if (id !== tracking) return;
    try {
      const r = stateOf(await fetchRuns(sha));
      if (id !== tracking) return;
      await set({ sha, ...r, at: since });
      if (r.state !== 'pending') return;
    } catch (e) {
      if (e instanceof DeployUnavailable) { await set({ sha, state: 'unavailable', detail: e.message, at: since }); return; }
      // réseau coupé : on retente
    }
    await sleep(intervalMs);
  }
  if (id === tracking) await set({ sha, state: 'unavailable', detail: 'toujours pas de résultat après 10 min : vérifie l\'onglet Actions', url: actionsUrl, at: since });
}

/** Au démarrage : dernier état connu ; un suivi interrompu (fermeture de l'app) reprend s'il est récent. */
export async function resumeDeploy(): Promise<void> {
  const last = await kvGet<DeployInfo>(KEY);
  if (!last || Date.now() - last.at > SHOW_MAX_MS) return;
  deploy.value = last;
  if (last.state === 'pending' && Date.now() - last.at < RESUME_MAX_MS) void trackDeploy(last.sha, last.at);
}
