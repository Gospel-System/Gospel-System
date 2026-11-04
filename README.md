# Gospel System

Paroles et pistes audio de la chorale **Gospel System** : https://gospelsystem.github.io/Gospel-System/

Ce dépôt ne contient que les **données**. Le code de l'app est commun avec Zovy Tononkira
([Zovy-Tononkira](https://github.com/Hasina-Zazahkel/Zovy-Tononkira), édition `gospel`).

## Contenu

| Dossier | Rôle |
|---|---|
| `data/songs/<id>.cho` | Paroles (format ChordPro de l'app) |
| `data/setlists/repertoire.json` | Répertoire (ordre des morceaux) |
| `data/members.json` | Membres et mots de passe (empreintes). Absent = app ouverte sans connexion |
| `data/audio/<id>/` | Pistes : `tous.mp3`, `soprano.mp3`, `alto.mp3`, `tenor.mp3`, `basse.mp3` |

Tout se gère depuis l'app (mode éditeur, bouton **PUBLIER**) : pas besoin de modifier ces fichiers à la main.

## Mise en ligne

Chaque publication depuis l'app (commit sur `main`) relance `.github/workflows/deploy.yml` :
le code commun est récupéré, les données de ce dépôt sont compilées, le site est publié sur GitHub Pages
(2 à 3 minutes). Une reconstruction automatique a lieu chaque nuit pour intégrer les évolutions du code.

Audio : MP3 mono 64–96 kbit/s conseillé (2 à 3 Mo pour 4 minutes). Fichiers libres de droit uniquement (dépôt public).
