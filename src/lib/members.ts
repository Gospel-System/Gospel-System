import { computed, signal } from '@preact/signals';
import {
  credentialCurrent, isAdmin, makeLocalCredential, normalizeId, parseMembers, sameMembers, sessionValid, validatePersonal,
  verify, verifyLocal, type LocalCredential, type Member, type Session,
} from '../model/members';
import { kvDel, kvGet, kvSet } from './store';

const SESSION_KEY = 'session.v1';
/** Mots de passe personnels de cet appareil, par identifiant (jamais publiés). */
const CRED_KEY = 'credentials.v1';
const OVERRIDE_KEY = 'membersOverride.v1';

/** Liste publiée (null = pas encore chargée). Vide = pas de connexion demandée (premier lancement). */
export const publishedMembers = signal<Member[] | null>(null);
export const session = signal<Session | null>(null);
export const authReady = signal(false);

export interface MembersOverride { members: Member[]; updatedAt: number; publishedAt?: number }
/** Liste modifiée sur cet appareil (éditeur), pas encore reçue dans la version publiée. */
export const membersOverride = signal<MembersOverride | null>(null);

export const currentMembers = computed<Member[]>(() => membersOverride.value?.members ?? publishedMembers.value ?? []);
export const membersUnpublished = computed(() => {
  const o = membersOverride.value;
  return !!o && (!o.publishedAt || o.updatedAt > o.publishedAt);
});

/** Connexion exigée : dès qu'une liste de membres est publiée. */
export const loginRequired = computed(() => (publishedMembers.value?.length ?? 0) > 0);
export const loggedIn = computed(() => sessionValid(session.value, publishedMembers.value ?? []));
/** Admin : connecté avec un compte admin, ou aucune liste publiée (mise en place). */
export const adminSession = computed(() => !loginRequired.value || isAdmin(session.value, publishedMembers.value ?? []));

async function fetchMembers(): Promise<Member[]> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/members.json`);
    if (!r.ok) return [];
    return parseMembers(await r.json());
  } catch {
    return [];
  }
}

/** Au démarrage : liste publiée, session (expirée ou membre retiré → déconnecté), modifs locales. */
export async function loadAuth() {
  try {
    const members = await fetchMembers();
    publishedMembers.value = members;
    const s = await kvGet<Session>(SESSION_KEY);
    if (s && sessionValid(s, members)) session.value = s;
    else if (s) await kvDel(SESSION_KEY);
    const o = await kvGet<MembersOverride>(OVERRIDE_KEY);
    if (o && !sameMembers(o.members, members)) membersOverride.value = o;
    else if (o) await kvDel(OVERRIDE_KEY);
  } finally {
    authReady.value = true;
  }
}

/** Branchement du suivi d'usage (évite une dépendance circulaire avec lib/usage). */
export const sessionHooks: { onLogin?: (id: string, kind: 'login' | 'activate') => void } = {};

async function startSession(m: Member) {
  const s: Session = { id: m.id, admin: !!m.admin, at: Date.now(), bind: m.hash };
  session.value = s;
  await kvSet(SESSION_KEY, s);
}

const readCreds = async () => (await kvGet<Record<string, LocalCredential>>(CRED_KEY)) ?? {};

/**
 * Connexion :
 * - mot de passe personnel déjà créé sur cet appareil (et temporaire inchangé) → seul le personnel est accepté ;
 * - sinon le mot de passe temporaire est vérifié → `activate` : le membre doit choisir son mot de passe personnel.
 */
export async function login(id: string, password: string): Promise<'ok' | 'activate' | 'bad'> {
  const members = publishedMembers.value ?? [];
  const m = members.find((x) => x.id === normalizeId(id));
  const cred = (await readCreds())[normalizeId(id)];
  if (m && credentialCurrent(cred, m)) {
    if (!(await verifyLocal(cred, password))) return 'bad';
    await startSession(m);
    sessionHooks.onLogin?.(m.id, 'login');
    return 'ok';
  }
  return (await verify(members, id, password)) ? 'activate' : 'bad';
}

/** Première connexion sur cet appareil : enregistre le mot de passe personnel et ouvre la session. Renvoie une erreur ou null. */
export async function activate(id: string, temporary: string, password: string, confirm: string): Promise<string | null> {
  const e = validatePersonal(password, confirm, temporary);
  if (e) return e;
  const m = await verify(publishedMembers.value ?? [], id, temporary);
  if (!m) return 'Le mot de passe temporaire n\'est plus valable : recommence la connexion.';
  const creds = await readCreds();
  creds[m.id] = await makeLocalCredential(m, password);
  await kvSet(CRED_KEY, creds);
  await startSession(m);
  sessionHooks.onLogin?.(m.id, 'activate');
  return null;
}

export async function logout() {
  session.value = null;
  await kvDel(SESSION_KEY);
}

export async function saveMembers(members: Member[]) {
  if (sameMembers(members, publishedMembers.value ?? [])) {
    membersOverride.value = null;
    await kvDel(OVERRIDE_KEY);
    return;
  }
  const o: MembersOverride = { members, updatedAt: Date.now(), publishedAt: membersOverride.value?.publishedAt };
  membersOverride.value = o;
  await kvSet(OVERRIDE_KEY, o);
}

export async function dropMembersOverride() {
  membersOverride.value = null;
  await kvDel(OVERRIDE_KEY);
}

export async function markMembersPublished(at = Date.now()) {
  const o = membersOverride.value;
  if (!o) return;
  membersOverride.value = { ...o, publishedAt: at };
  await kvSet(OVERRIDE_KEY, membersOverride.value);
}
