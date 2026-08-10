# Reconstruction contrôlée — Somafrik V2

**Statut :** chantier validé par décision CTO

**Date d'ouverture :** 2026-08-10

**Base initiale :** `develop@cfb20ce`

**Lot courant :** V2.0 — fondation et frontières

---

## 1. Décision

Somafrik V2 est construit à côté du runtime actuel puis reçoit les capacités métier une par une. Le dépôt, l'historique Git, les règles métier, les données, les tests et les correctifs fiables sont conservés.

Le runtime legacy reste actif jusqu'à ce qu'une capacité V2 atteigne la parité et franchisse son gate de préproduction. Aucun fichier legacy n'est supprimé par défaut.

## 2. Pourquoi ce chantier

La base `develop` montre plusieurs générations techniques en exploitation simultanée :

| Signal | Constat de base |
|---|---|
| Applications | `BackOffice/`, `web/`, `Mobile/`, `backend/` coexistent |
| Persistance | PostgreSQL canonique pour certains domaines et snapshot `backoffice_state` pour d'autres |
| Concentration | `backend/db/postgresRepository.js` ≈ 174 Ko ; `backend/server.js` ≈ 161 Ko ; `BackOffice/app.js` ≈ 137 Ko |
| Couplage | Web et Mobile consomment encore `GET/PUT /api/backoffice/state` |
| Livraison | Plusieurs travaux peuvent toucher les mêmes monolithes et augmenter les conflits |

Ces constats justifient une nouvelle structure, pas une perte des acquis fonctionnels.

## 3. Architecture cible de transition

```text
apps/
  api/        adaptateur HTTP V2
  web/        client web V2
  mobile/     client mobile V2
packages/
  domain/     invariants métier sans framework
  auth/       identité, sessions, autorisations
  database/   ports, PostgreSQL, migrations versionnées
  shared/     primitives techniques minimales
tests/
  v2/         intégration et preuves de parité
```

Direction des dépendances :

```text
apps → auth / database / domain / shared
auth → domain / shared
database → domain / shared
domain → aucune infrastructure
shared → aucune règle métier
```

Les nouveaux modules V2 ne doivent importer aucun fichier de `backend/`, `web/`, `Mobile/` ou `BackOffice/`. Une compatibilité temporaire devra passer par un adaptateur explicite, réversible et couvert par un contrat.

## 4. Invariants non négociables

1. Tenant scope explicite sur toute opération : plateforme, pays ou établissement.
2. RBAC fail-closed ; aucun droit implicite en cas de rôle ou principal inconnu.
3. PostgreSQL devient la seule source de vérité de chaque domaine migré.
4. Aucune nouvelle dépendance V2 à `/api/backoffice/state` ou `backoffice_state`.
5. Authentification par en-tête Bearer ; aucun secret ou JWT dans l'URL, le dépôt ou les réponses.
6. Synchronisation non destructive avec ACK explicite pour les parcours hors ligne.
7. Identité métier distincte de l'inscription annuelle et de l'affectation.
8. Suppression legacy uniquement après parité, migration, rollback documenté et validation CTO.

Le script `npm run verify:v2-foundation` rend la frontière 4 et la présence de la structure cible vérifiables dès le premier lot.

## 5. Lots de migration

| Lot | Contenu | Gate de sortie |
|---|---|---|
| V2.0 | Structure, frontières, premier invariant tenant | Guard + tests domaine + CI verts |
| V2.1 | Identités, utilisateurs, sessions, RBAC | Contrats historiques + 401/403/200 + compatibilité login |
| V2.2 | Accès PostgreSQL et migrations versionnées | Migration idempotente + rollback + isolation tenant |
| V2.3 | Élèves et inscriptions annuelles | Parité CRUD/transfert/clôture + intégrité des données |
| V2.4 | Enseignants et affectations | Canon unique + idempotence + homonymes préservés |
| V2.5 | Adaptateurs web/mobile | Parcours critiques + outbox/ACK + accessibilité |
| V2.6 | Cutover contrôlé | Préprod stable + observabilité + Go CTO explicite |

Chaque lot est fractionné en petites PR à objectif unique. Aucun lot ne donne l'autorisation de supprimer le précédent.

## 6. Périmètre exact de V2.0

Inclus :

- structure cible versionnée ;
- package `@somafrik/domain-v2` sans dépendance ;
- objet tenant scope immuable et validé ;
- tests unitaires fail-closed ;
- garde-fou automatique contre les imports legacy et le snapshot global ;
- mise à jour de la gouvernance.

Hors périmètre :

- endpoint API ou écran utilisateur ;
- changement de login, RBAC existant ou données ;
- nouvelle table ou migration PostgreSQL ;
- déploiement V2 ;
- suppression, déplacement ou renommage d'un fichier legacy.

## 7. Gate de merge V2.0

- [ ] diff GitHub indépendant relu par le CTO ;
- [ ] PR en brouillon jusqu'à stabilisation du périmètre ;
- [ ] `npm run verify:v2-foundation` vert ;
- [ ] typecheck, lint, tests et sécurité existants verts ;
- [ ] aucune modification de runtime ni de schéma ;
- [ ] aucun conflit non résolu avec `develop` ;
- [ ] décision CTO explicite avant passage Ready puis merge.
