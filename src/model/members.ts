/**
 * Membres autorisés à ouvrir l'app (protection simple : le site et le dépôt restent publics).
 * Seule une empreinte salée du mot de passe est publiée (PBKDF2-SHA256), jamais le mot de passe.
 */
export interface Member {
  /** Identifiant, en minuscules. */
  id: string;
  admin?: boolean;
  /** Sel et empreinte en base64. */
  salt: string;
  hash: string;
  iter: number;
}

export interface Session {
  id: string;
  admin: boolean;
  /** Date de connexion (ms). */
  at: number;
  /** Empreinte publiée du membre au moment de la connexion : un nouveau mot de passe temporaire la change et clôt la session. */
  bind: string;
}

/**
 * Mot de passe personnel, choisi par le membre à sa première connexion sur un appareil.
 * Il reste sur l'appareil (jamais publié) ; `bind` le relie au mot de passe temporaire publié :
 * si l'administrateur redéfinit le temporaire, `bind` ne correspond plus et il faut réactiver.
 */
export interface LocalCredential {
  id: string;
  salt: string;
  hash: string;
  iter: number;
  bind: string;
}

export const ITERATIONS = 210_000;
export const SESSION_DAYS = 120;
/** Mot de passe temporaire (défini par l'administrateur). */
export const PASSWORD_MIN = 6;
/** Mot de passe personnel (choisi par le membre). */
export const PERSONAL_MIN = 8;

export const normalizeId = (s: string) => s.trim().toLowerCase().normalize('NFC');

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return b64(new Uint8Array(bits));
}

export async function makeMember(id: string, password: string, admin = false, iter = ITERATIONS): Promise<Member> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const m: Member = { id: normalizeId(id), salt: b64(salt), hash: await derive(password, salt, iter), iter };
  return admin ? { ...m, admin: true } : m;
}

/** Vérifie identifiant + mot de passe temporaire (celui qui est publié) ; renvoie le membre ou null. */
export async function verify(members: Member[], id: string, password: string): Promise<Member | null> {
  const m = members.find((x) => x.id === normalizeId(id));
  if (!m) {
    // Même durée de calcul qu'un identifiant existant
    await derive(password, new Uint8Array(16), ITERATIONS);
    return null;
  }
  const h = await derive(password, unb64(m.salt), m.iter);
  return h === m.hash ? m : null;
}

/** Crée le mot de passe personnel d'un membre, relié à son empreinte publiée. */
export async function makeLocalCredential(member: Member, password: string, iter = ITERATIONS): Promise<LocalCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { id: member.id, salt: b64(salt), hash: await derive(password, salt, iter), iter, bind: member.hash };
}

/** Faux si le temporaire a été redéfini depuis l'activation (empreinte différente). */
export const credentialCurrent = (c: LocalCredential | null | undefined, member: Member | undefined): c is LocalCredential =>
  !!c && !!member && c.id === member.id && c.bind === member.hash;

export async function verifyLocal(c: LocalCredential, password: string): Promise<boolean> {
  return (await derive(password, unb64(c.salt), c.iter)) === c.hash;
}

/** Session encore valable : non expirée, membre toujours publié et mot de passe temporaire inchangé. */
export function sessionValid(s: Session | null | undefined, members: Member[], now = Date.now()): boolean {
  if (!s || !s.bind) return false;
  if (now - s.at > SESSION_DAYS * 86_400_000 || now < s.at - 86_400_000) return false;
  return members.some((m) => m.id === s.id && m.hash === s.bind);
}

/** Droits admin de la session, relus dans la liste publiée (un retrait du drapeau s'applique). */
export const isAdmin = (s: Session | null | undefined, members: Member[]) =>
  !!s && !!members.find((m) => m.id === s.id)?.admin;

export function validateId(id: string, members: Member[]): string | null {
  const n = normalizeId(id);
  if (!n) return "L'identifiant est obligatoire.";
  if (!/^[\p{L}\p{N}._-]{2,32}$/u.test(n)) return 'Identifiant : 2 à 32 caractères, lettres, chiffres, . _ - (sans espace).';
  if (members.some((m) => m.id === n)) return `« ${n} » existe déjà.`;
  return null;
}

export const validatePassword = (p: string) =>
  p.length < PASSWORD_MIN ? `Mot de passe temporaire : au moins ${PASSWORD_MIN} caractères.` : null;

/** Mot de passe personnel : 8 caractères minimum, double saisie identique, différent du temporaire. */
export function validatePersonal(p: string, confirm: string, temporary: string): string | null {
  if (p.length < PERSONAL_MIN) return `Mot de passe personnel : au moins ${PERSONAL_MIN} caractères.`;
  if (p === temporary) return 'Choisis un mot de passe différent du mot de passe temporaire.';
  if (p !== confirm) return 'Les deux saisies sont différentes.';
  return null;
}

/** Il doit toujours rester au moins un admin dès qu'il y a des membres. */
export const hasAdmin = (members: Member[]) => !members.length || members.some((m) => m.admin);

export function serializeMembers(members: Member[]): string {
  const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(sorted.map(({ id, admin, salt, hash, iter }) => (admin ? { id, admin, salt, hash, iter } : { id, salt, hash, iter })), null, 2) + '\n';
}

export const sameMembers = (a: Member[], b: Member[]) => serializeMembers(a) === serializeMembers(b);

export function parseMembers(raw: unknown): Member[] {
  if (!Array.isArray(raw)) throw new Error('members.json : tableau attendu');
  return raw.map((m, i) => {
    if (!m || typeof m.id !== 'string' || typeof m.salt !== 'string' || typeof m.hash !== 'string' || typeof m.iter !== 'number') {
      throw new Error(`members.json : entrée ${i} invalide`);
    }
    return m.admin ? { id: m.id, admin: true, salt: m.salt, hash: m.hash, iter: m.iter } : { id: m.id, salt: m.salt, hash: m.hash, iter: m.iter };
  });
}
