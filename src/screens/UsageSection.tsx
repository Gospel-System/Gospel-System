import { useEffect, useState } from 'preact/hooks';
import { adminKeySet, downloadCsv, fetchStats, setAdminKey, trackingEnabled, UsageError } from '../lib/usage';
import { publishedMembers } from '../lib/members';
import { ago, bucketDaily, topDevice, usageRate, type Bar, type Stats } from '../model/usage';

const PERIODS: { days: number; label: string }[] = [
  { days: 30, label: '30 j' }, { days: 90, label: '90 j' }, { days: 365, label: '1 an' }, { days: 730, label: 'Tout' },
];

function Chart({ bars }: { bars: Bar[] }) {
  if (!bars.length) return <p class="hint">Aucune ouverture sur cette période.</p>;
  const max = Math.max(1, ...bars.map((b) => b.opens));
  const W = 320, H = 110, gap = 2, bw = Math.max(2, (W - gap * (bars.length - 1)) / bars.length);
  return (
    <figure class="usage-chart">
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label="Ouvertures par période">
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--line)" />
        {bars.map((b, i) => {
          const x = i * (bw + gap), h = (b.opens / max) * H, hl = (Math.min(b.logins, b.opens) / max) * H;
          return (
            <g key={b.label}>
              <title>{`${b.label} : ${b.opens} ouverture${b.opens > 1 ? 's' : ''}, ${b.logins} connexion${b.logins > 1 ? 's' : ''}`}</title>
              <rect x={x} y={H - h} width={bw} height={Math.max(h, b.opens ? 1 : 0)} fill="var(--gold)" rx="1" />
              {b.logins > 0 && <rect x={x + bw * 0.25} y={H - hl} width={bw * 0.5} height={hl} fill="#fff" opacity="0.7" rx="1" />}
            </g>
          );
        })}
        <text x="0" y={H + 13} fill="var(--fg-dim)" font-size="10">{bars[0].label}</text>
        <text x={W} y={H + 13} fill="var(--fg-dim)" font-size="10" text-anchor="end">{bars[bars.length - 1].label}</text>
        <text x={W} y="10" fill="var(--fg-dim)" font-size="10" text-anchor="end">max {max}</text>
      </svg>
      <figcaption><i class="dot gold" /> ouvertures <i class="dot white" /> connexions</figcaption>
    </figure>
  );
}

/** Réglages (admin) : usage de l'app par membre (ouvertures, connexions) d'après le suivi Cloudflare (tracker/). */
export function UsageSection() {
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const keySet = adminKeySet.value;
  // Les comptes administrateur ne sont pas suivis : ni comptés ni listés
  const adminIds = new Set((publishedMembers.value ?? []).filter((m) => m.admin).map((m) => m.id));
  const registered = (publishedMembers.value ?? []).filter((m) => !m.admin).map((m) => m.id);

  const load = async (d = days) => {
    setBusy(true); setErr(null);
    try { setStats(await fetchStats(d)); }
    catch (e) { setErr(e instanceof UsageError ? e.message : 'Pas de connexion : réessaie avec du réseau.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (trackingEnabled && keySet) void load(days); }, [days, keySet]);

  if (!trackingEnabled) {
    return (<><h3 class="sheet-h">Utilisation</h3><p class="hint">Suivi non configuré. Mise en place : dossier <code>tracker/</code> du dépôt (README).</p></>);
  }
  if (!keySet) {
    return (
      <>
        <h3 class="sheet-h">Utilisation</h3>
        <p class="hint">Colle la clé d'administration du suivi (<code>ADMIN_KEY</code> du Worker). Elle reste sur cet appareil.</p>
        <input class="in" type="password" autoComplete="off" placeholder="Clé d'administration" value={key}
          onInput={(e) => setKey((e.target as HTMLInputElement).value)} aria-label="Clé d'administration du suivi" />
        <button class="btn primary wide" disabled={!key.trim()} onClick={async () => { await setAdminKey(key); setKey(''); }}>Enregistrer la clé</button>
      </>
    );
  }

  const t = stats?.totals;
  const now = stats?.now ?? Date.now();
  const byMember = new Map((stats?.members ?? []).map((m) => [m.member, m]));
  const ids = [...new Set([...registered, ...byMember.keys()])].filter((id) => !adminIds.has(id));
  const never = ids.filter((id) => !(byMember.get(id)?.opens));
  const active = ids.filter((id) => (byMember.get(id)?.opens ?? 0) > 0)
    .sort((a, b) => (byMember.get(b)!.lastOpen ?? 0) - (byMember.get(a)!.lastOpen ?? 0));

  return (
    <>
      <h3 class="sheet-h">Utilisation</h3>
      <div class="usage-periods" role="group" aria-label="Période">
        {PERIODS.map((p) => (
          <button key={p.days} class={`chip-btn${days === p.days ? ' on' : ''}`} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>{p.label}</button>
        ))}
        <button class="chip-btn" disabled={busy} onClick={() => load()}>{busy ? '…' : 'Actualiser'}</button>
      </div>
      {err && <p class="msg err" role="alert">{err}</p>}
      {stats && t && (
        <>
          <div class="usage-tiles">
            <div><b>{t.opens ?? 0}</b><span>ouvertures</span></div>
            <div><b>{(t.logins ?? 0) + (t.activations ?? 0)}</b><span>connexions</span></div>
            <div><b>{usageRate(t.active30 ?? 0, registered.length)} %</b><span>actifs 30 j ({t.active30 ?? 0}/{registered.length})</span></div>
            <div><b>{t.active7 ?? 0}</b><span>actifs 7 j</span></div>
          </div>
          <Chart bars={bucketDaily(stats.daily)} />
          {never.length > 0 && <p class="msg warn">Jamais ouvert ({never.length}) : {never.join(', ')}</p>}
          <ul class="usage-list">
            {active.map((id) => {
              const m = byMember.get(id)!;
              return (
                <li key={id}>
                  <div class="usage-h"><b>{id}</b><span>{ago(m.lastOpen, now)}</span></div>
                  <div class="usage-s">
                    <span>{m.opens} ouverture{m.opens > 1 ? 's' : ''} <small>(7 j : {m.opens7} · 30 j : {m.opens30})</small></span>
                    <span>{m.logins + m.activations} connexion{m.logins + m.activations > 1 ? 's' : ''}{m.activations ? <small> (dont {m.activations} première{m.activations > 1 ? 's' : ''} sur un appareil)</small> : ''}</span>
                    <span>{topDevice(stats.devices, id)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p class="hint">Ouverture = retour au premier plan après 30 min d'inactivité. Connexion = saisie du mot de passe (y compris la première sur un appareil). Comptes administrateur exclus. Conservation : 24 mois.</p>
        </>
      )}
      <div class="usage-periods">
        <button class="chip-btn" disabled={busy} onClick={async () => { try { await downloadCsv(); } catch (e) { setErr(e instanceof UsageError ? e.message : 'Export impossible : réessaie avec du réseau.'); } }}>Exporter en CSV</button>
        <button class="chip-btn" onClick={async () => { await setAdminKey(''); setStats(null); }}>Changer la clé</button>
      </div>
    </>
  );
}
