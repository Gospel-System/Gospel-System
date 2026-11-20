import { deploy, SHOW_MAX_MS } from '../lib/deploy';

/** État du déploiement du dernier commit publié (éditeur). */
export function DeployStatus() {
  const d = deploy.value;
  if (!d || Date.now() - d.at > SHOW_MAX_MS) return null;
  const link = d.url && <> <a href={d.url} target="_blank" rel="noopener">Voir le run</a></>;
  if (d.state === 'pending') return <p class="msg warn" role="status">Déploiement en cours… (1 à 2 minutes){link}</p>;
  if (d.state === 'success') return <p class="msg ok" role="status">En ligne ✓ : le site est à jour.{link}</p>;
  if (d.state === 'failure') {
    return <p class="msg err" role="alert">Échec du déploiement ✗ : tes modifications sont sur GitHub mais le site n'est pas mis à jour.{link}</p>;
  }
  return <p class="msg warn" role="status">État du déploiement indisponible : {d.detail}.{link}</p>;
}
