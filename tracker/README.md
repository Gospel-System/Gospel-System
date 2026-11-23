# Suivi d'usage — mise en place Cloudflare (≈ 10 min, sans ligne de commande)

Le suivi enregistre pour chaque membre : **ouvertures de l'app** (retour au premier plan après 30 min d'inactivité), **connexions** par mot de passe et **activations** (première connexion sur un appareil), avec le type d'appareil. Pas d'adresse IP, pas de localisation. Conservation 24 mois (purge automatique).

> Les libellés du tableau de bord Cloudflare évoluent : cherche les équivalents si un nom diffère.

## 1. Créer la base
1. https://dash.cloudflare.com → **Storage & databases → D1 SQL database → Create database**, nom : `gospel-usage`.
2. Ouvre la base → onglet **Console** → colle le contenu de `schema.sql` → **Execute**.

## 2. Créer le Worker
1. **Compute (Workers) → Create → Start with Hello World** (ou « Create Worker »), nom : `gospel-usage` → **Deploy**.
2. **Edit code** → remplace tout par le contenu de `worker.js` → **Deploy**.

## 3. Relier la base et régler les variables
Dans le Worker → **Settings** :
1. **Bindings → Add → D1 database** : variable `DB`, base `gospel-usage` → **Deploy**.
2. **Variables and secrets → Add** :

| Nom | Type | Valeur |
|---|---|---|
| `INGEST_KEY` | Secret | une chaîne aléatoire de 24+ caractères (gestionnaire de mots de passe). **Elle sera publique** dans le code de l'app : elle sert seulement à écarter le bruit. |
| `ADMIN_KEY` | Secret | une autre chaîne aléatoire de 24+ caractères. **Ne la donne à personne** : tu la colles uniquement dans Réglages → Utilisation, sur ton appareil. |
| `ALLOWED_ORIGIN` | Texte | `https://gospel-system.github.io` |

## 4. Vérifier
Ouvre l'adresse du Worker (`https://gospel-usage.<ton-sous-domaine>.workers.dev`) : tu dois voir « Gospel System usage tracker : OK ».

## 5. Activer dans l'app
Donne-moi **l'adresse du Worker** et **INGEST_KEY** (jamais ADMIN_KEY). Je les renseigne dans `editions/gospel/edition.json` (`tracker.url` et `tracker.key`) : le suivi démarre au déploiement suivant.

## Données et vie privée
- Les membres sont informés sur l'écran de connexion.
- Suppression d'un membre : Console D1 → `DELETE FROM events WHERE member = 'identifiant';`
- Tout effacer : `DELETE FROM events;`
