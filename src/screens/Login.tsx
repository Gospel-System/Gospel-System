import { EDITION } from '../edition';
import { useState } from 'preact/hooks';
import { activate, login } from '../lib/members';
import { PERSONAL_MIN } from '../model/members';
import { DEMO } from '../lib/demo';

const logo = `${import.meta.env.BASE_URL}${EDITION.logo.src}`;
const HINT = `Accès réservé aux membres ${EDITION.groupWord === 'chorale' ? 'de la chorale' : 'du groupe'}. Identifiant et mot de passe temporaire fournis par ${EDITION.admin} ; tu choisiras ton mot de passe personnel à la première connexion.`;
const hero = EDITION.loginImage ? `${import.meta.env.BASE_URL}${EDITION.loginImage}` : null;

/** Page de connexion (dès qu'une liste de membres est publiée). Fonctionne hors ligne. */
export function Login() {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Première connexion sur cet appareil : choix du mot de passe personnel
  const [step, setStep] = useState<'login' | 'activate'>('login');
  const [np, setNp] = useState('');
  const [np2, setNp2] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!id.trim() || !pw) return;
    setBusy(true); setErr(null);
    const r = await login(id, pw);
    setBusy(false);
    if (r === 'activate') setStep('activate');
    else if (r === 'bad') { setErr('Identifiant ou mot de passe incorrect.'); setPw(''); }
  };

  const submitActivate = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const m = await activate(id, pw, np, np2);
    setBusy(false);
    if (m) setErr(m);
  };

  const back = () => { setStep('login'); setPw(''); setNp(''); setNp2(''); setErr(null); };

  const banner = hero
    ? <img class="login-banner" src={hero} alt={EDITION.logo.alt} />
    : <img class="login-logo" src={logo} alt={EDITION.logo.alt} width={EDITION.logo.width} height={EDITION.logo.height} />;

  if (step === 'activate') {
    return (
      <main class="login">
        <form class="login-box" onSubmit={submitActivate}>
          {banner}
          <p class="login-hint"><b>Première connexion de « {id.trim().toLowerCase()} »</b> sur cet appareil. Choisis ton mot de passe personnel
            ({PERSONAL_MIN} caractères minimum) : il reste sur cet appareil et remplace le mot de passe temporaire ici.</p>
          <label class="login-f">
            <span>Nouveau mot de passe</span>
            <span class="login-pw">
              <input class="in" type={(show ? 'text' : 'password') as 'password'} name="new-password" autoComplete="new-password"
                value={np} onInput={(e) => setNp((e.target as HTMLInputElement).value)} autoFocus />
              <button type="button" class="chip-btn" onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                {show ? 'Masquer' : 'Voir'}
              </button>
            </span>
          </label>
          <label class="login-f">
            <span>Confirmer le mot de passe</span>
            <input class="in" type={(show ? 'text' : 'password') as 'password'} name="confirm-password" autoComplete="new-password"
              value={np2} onInput={(e) => setNp2((e.target as HTMLInputElement).value)} />
          </label>
          {err && <p class="msg err" role="alert">{err}</p>}
          <button class="btn primary wide" type="submit" disabled={busy || !np || !np2}>{busy ? 'Enregistrement…' : 'ENREGISTRER ET ENTRER'}</button>
          <button class="btn ghost wide" type="button" onClick={back}>Retour</button>
          <p class="login-hint">Mot de passe oublié ou nouvel appareil : demande à {EDITION.admin} un nouveau mot de passe temporaire.</p>
        </form>
      </main>
    );
  }

  return (
    <main class="login">
      <form class="login-box" onSubmit={submit}>
        {banner}
        <label class="login-f">
          <span>Identifiant</span>
          <input class="in" type="text" name="username" autoComplete="username" autoCapitalize="none" spellcheck={false}
            value={id} onInput={(e) => setId((e.target as HTMLInputElement).value)} autoFocus />
        </label>
        <label class="login-f">
          <span>Mot de passe <small>(temporaire la 1re fois)</small></span>
          <span class="login-pw">
            <input class="in" type={(show ? 'text' : 'password') as 'password'} name="password" autoComplete="current-password"
              value={pw} onInput={(e) => setPw((e.target as HTMLInputElement).value)} />
            <button type="button" class="chip-btn" onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
              {show ? 'Masquer' : 'Voir'}
            </button>
          </span>
        </label>
        {err && <p class="msg err" role="alert">{err}</p>}
        <button class="btn primary wide" type="submit" disabled={busy || !id.trim() || !pw}>{busy ? 'Vérification…' : 'SE CONNECTER'}</button>
        <p class="login-hint">{HINT}</p>
        {DEMO && <p class="msg warn">Mode démonstration. En mode éditeur, n'importe quel jeton est accepté et rien n'est envoyé.</p>}
      </form>
    </main>
  );
}
