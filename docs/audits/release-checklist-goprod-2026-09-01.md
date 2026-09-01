# Checklist release GO-PROD — 2026-09-01

**Aucun acte ci-dessous n’est exécuté par l’agent.** Chaque phase exige **USER GO** explicite. Candidat figé à la rédaction : `develop@5173537d29d31d16039883552f5e2cb506060581`. Si `develop` avance : STOP, rebase, revalider.

## A — Pré-merge `main` (USER GO)

- [ ] Confirmer qu’aucune PR Cursor Go Production n’est ouverte hors la PR d’audit.
- [ ] Confirmer #295/#297/#298/#312/#337/#354/#355 toujours hors `develop` / `main`.
- [ ] Rejouer `git fetch origin main develop` ; noter SHA `main` et `develop`.
- [ ] Si `main` ≠ `b5074565b08472217702d8ff848f5a398d08831c` : **STOP** — reclasser les main-only.
- [ ] `git merge-tree origin/main origin/develop` : lister CONFLICT ; stratégie **préférer develop** (main = snapshot 2026-07-27).
- [ ] Ne pas `git reset --hard` / force-push `main`.
- [ ] Ne pas cherry-pick RC3 #354/#355.
- [ ] Hosted Web toujours `ENVIRONMENT_COMMIT_UNVERIFIED` → le merge `main` **ne lève pas** ce blocker.
- [ ] Android device / APK exact-SHA / DNS `api.somafrik.app` toujours MANUAL BLOCKER.
- [ ] Privacy policy + account deletion toujours absents → **pas de Play submit**.
- [ ] Ouvrir la PR `develop → main` **seulement** après USER GO (pas dans le lot G).

## B — Merge `main` (USER GO — interdit à l’agent)

- [ ] PR Draft `develop → main`, checks `pr-gates` (écoute `main`) + revue humaine.
- [ ] Résoudre les ~29 conflits en faveur de develop, sans réintroduire l’arbre `b5074565`.
- [ ] Verrou SHA : merger uniquement le HEAD audité.
- [ ] Pas de squash qui efface la traçabilité sans décision CTO.
- [ ] Après merge : noter le SHA `main` nouveau.

## C — Déploiement préprod / prod (USER GO — interdit à l’agent)

- [ ] Deploy Web + API **préprod** du SHA `main` (ou develop équivalent) — pas l’agent.
- [ ] Vérifier SHA dans le runtime (aujourd’hui `/api/health` **n’expose pas** de git SHA).
- [ ] Compte smoke non-secret fourni.
- [ ] Relancer Web smoke **hébergé** ; lever `ENVIRONMENT_COMMIT_UNVERIFIED` seulement si le bundle = SHA.
- [ ] Deploy prod **séparé**, USER GO distinct.
- [ ] DNS `api.somafrik.app` vivant avant tout client production / EAS production.

## D — Smoke post-deploy (USER GO)

- [ ] Web : login + 12 parcours, preuve `<main>` (contrat Lot E).
- [ ] API : health PostgreSQL + login établissement.
- [ ] Android : `eas build --profile preview` (humain) puis USB/adb login/nav — **jamais PASS sans appareil**.
- [ ] Offline / kill-relaunch : RC2 seulement ; RC3 hors release.
- [ ] Aucun `eas submit` / Play Internal / Production sans privacy + account deletion.

## E — Rollback (préparé, non exécuté)

- [ ] Garder le SHA `main` précédent (`b5074565…` jusqu’au premier merge).
- [ ] Rollback hébergé = redéployer le SHA **précédent connu**, pas un reset git forcé.
- [ ] Rollback Mobile = ne pas promouvoir l’AAB ; désinstaller sideload preview.

## Interdits permanents (lot G)

- Merge `main` par l’agent
- `eas build` / `eas submit` / Play upload
- Deploy préprod/prod
- Secrets, JWT global/#404, RC3 #354/#355
- Seconde PR Go Production
