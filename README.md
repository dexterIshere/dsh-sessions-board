# dsh-sessions-board

Panneau **Sessions** dans l'interface Web de DSH : pour chaque espace de travail
connu de ce DSH, il montre le fichier d'état des sessions (`docs/SESSIONS.md`) —
qui travaille sur quoi, les périmètres d'écriture, la dernière activité.

Il fonctionne pour **n'importe quel workspace**, sans configuration : les espaces
sont découverts dans le magasin de sessions (`~/.dsh/sessions/*/`), dont l'en-tête
de chaque session porte le `cwd`. Un workspace sans fichier d'état apparaît quand
même, avec la liste des chemins essayés.

## Ce que ça donne

- Une entrée **Sessions** dans la barre latérale, et une page qui liste les
  espaces de travail : nom, chemin, nombre de sessions, date de dernière écriture.
- Sous chaque espace, le contenu de son fichier d'état rendu lisiblement
  (titres, paragraphes, tableaux), pas du Markdown brut.
- Lecture toutes les 30 secondes, plus un bouton **Actualiser**.

## Fichiers d'état acceptés

Par ordre de priorité, à la racine du workspace :

1. `docs/SESSIONS.md`
2. `SESSIONS.md`
3. `docs/sessions.md`
4. `.dsh/SESSIONS.md`

Un modèle prêt à copier : [`SESSIONS.template.md`](./SESSIONS.template.md).

## Installation

```bash
git clone https://github.com/dexterIshere/dsh-sessions-board.git
dsh plugin --profile web add "$PWD/dsh-sessions-board"
```

Un **redémarrage de DSH** est nécessaire : c'est une modification de profil, pas
une page à rafraîchir.

Pour retirer le panneau : supprimer `dsh-sessions-board` des `dependencies` et des
`bundles` de `~/.dsh/profiles/<profil>/package.json`, puis relancer.

## Licence

MIT — voir [LICENSE](./LICENSE).

## Ce qu'il ne fait pas

- Il **n'écrit rien** : le fichier d'état reste tenu par les sessions elles-mêmes
  (voir `CLAUDE.md` du dépôt concerné).
- Il ne lit que le fichier d'état : ni base de données, ni secrets, ni contenu de
  conversation. La route `GET /sessions-board` renvoie exactement ce que le
  fichier contient.
- Il ne relie pas DSH aux sessions Claude cloud : celles-ci n'existent pour lui
  que si quelqu'un décrit leur état dans le fichier.

## Détails techniques

| Élément | Valeur |
| --- | --- |
| Route HTTP | `GET /sessions-board` (JSON, `no-store`) |
| Moitié serveur | `lib/index.js` — enregistre la route sur `ctx.webServer` |
| Logique pure | `lib/board.js` — découverte, lecture, parsing Markdown |
| Moitié navigateur | `client/client.js` — bundle `ModuleLoader`, slots `main` et `sidebar.panellist` |
| Limites | 80 dossiers de workspace, 2 Mo par fichier, en-tête de session ≤ 64 Ko |
