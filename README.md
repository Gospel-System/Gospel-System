# Gospel System

App de paroles et de pistes audio par pupitre pour la chorale **Gospel System** : PWA hors ligne, connexion par membre, publication depuis l'app.

Dépôt **autonome** : code + données, indépendant des autres applications.

## Structure

| Chemin | Rôle |
|---|---|
| `src/` | App (Vite + TypeScript + Preact + signals) |
| `editions/gospel/edition.json` | Nom, dépôt GitHub, adresse (`basePath`), thème doré, pupitres, fonctions actives |
| `editions/gospel/public/` | Logo, bannière de connexion, icônes |
| `data/songs/<id>.cho` | Paroles (format ChordPro de l'app) |
| `data/setlists/repertoire.json` | Répertoire (parties, ordre) |
| `data/members.json` | Membres (empreintes PBKDF2). Absent = app ouverte sans connexion |
| `data/audio/<id>/` | Pistes : `tous.mp3`, `soprano.mp3`, `alto.mp3`, `tenor.mp3`, `basse.mp3` |
| `scripts/build-data.ts` | Compile `data/` en JSON dans `editions/gospel/public/data/` |
| `tests/` | Vitest |

## Commandes

```bash
npm ci
npm test          # tests
npm run dev       # développement
npm run build     # données + app → dist/
```

## Mise en ligne

`.github/workflows/deploy.yml` : à chaque commit sur `main` (dont les publications depuis l'app) → tests, build, GitHub Pages.
Dans le dépôt : Settings → Pages → Source = **GitHub Actions**.

## Changer d'hébergement / de propriétaire

Mettre à jour `editions/gospel/edition.json` :

- `repo.owner` / `repo.repo` / `repo.branch` : dépôt où l'app publie (bouton PUBLIER)
- `basePath` : chemin du site (`/Gospel-System/` pour `https://<org>.github.io/Gospel-System/`)
- `manifestId` : identifiant d'installation ; ne pas le changer une fois l'app installée chez les membres

Jeton de publication : **un seul** jeton fin GitHub (Contents : Read and write sur ce dépôt, expiration 1 an), collé sur chaque appareil de l'éditeur.
