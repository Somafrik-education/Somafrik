# Reconstruction contrôlée — Somafrik V2

**Statut :** chantier validé par décision CTO

**Date d'ouverture :** 2026-08-10

**Base initiale :** `develop@cfb20ce`

**Lot courant :** V2.1j — adaptateur HTTP pur des décisions d’autorisation

---

## 1. Décision

Somafrik V2 est construit à côté du runtime actuel puis reçoit les capacités métier une par une. Le dépôt, l'historique Git, les règles métier validées, les tests et les correctifs fiables sont conservés comme acquis techniques. **Aucune donnée métier du runtime legacy n'est reprise dans la V2.**

La V2 démarre sur une base métier neuve selon la politique de données de la section 5. Le runtime legacy reste actif pendant la transition, puis ses données sont isolées en archive ou en lecture seule. Aucun fichier legacy n'est supprimé par défaut, mais aucun module V2 ne doit dépendre de ses données.

## 2. Pourquoi ce chantier

La base `develop` montre plusieurs générations techniques en exploitation simultanée :

| Signal | Constat de base |
|---|---|
| Applications | `BackOffice/`, `web/`, `Mobile/`, `backend/` coexistent |
| Persistance | PostgreSQL canonique pour certains domaines et snapshot `backoffice_state` pour d'autres |
| Concentration | `backend/db/postgresRepository.js` ≈ 174 Ko ; `backend/server.js` ≈ 161 Ko ; `BackOffice/app.js` ≈ 137 Ko |
| Couplage | Web et Mobile consomment encore `GET/PUT /api/backoffice/state` |
| Livraison | Plusieurs travaux peuvent toucher les mêmes monolithes et augmenter les conflits |

Ces constats justifient une nouvelle structure, sans réutilisation des données métier historiques.

## 3. Architecture cible de transition

```text
apps/
  api/        adaptateur HTTP V2
  web/        client web V2
  mobile/     client mobile V2
packages/
  domain/     invariants métier sans framework
  auth/       identité, sessions, autorisations
  database/   ports, PostgreSQL, migrations de schéma versionnées
  shared/     primitives techniques minimales
tests/
  v2/         intégration et preuves des parcours V2
```

Direction des dépendances :

```text
apps → auth / database / domain / shared
auth → domain / shared
database → domain / shared
domain → aucune infrastructure
shared → aucune règle métier
```

Les nouveaux modules V2 ne doivent importer aucun fichier de `backend/`, `web/`, `Mobile/` ou `BackOffice/`. Une compatibilité temporaire d'interface doit passer par un adaptateur explicite, réversible et couvert par un contrat ; elle ne peut ni importer, ni lire, ni réconcilier des données métier legacy dans la V2.

## 4. Invariants non négociables

1. Tenant scope explicite sur toute opération : plateforme, pays ou établissement.
2. RBAC fail-closed ; aucun droit implicite en cas de rôle ou principal inconnu.
3. PostgreSQL V2 est la seule source de vérité des données créées par les parcours V2.
4. Aucune nouvelle dépendance V2 à `/api/backoffice/state` ou `backoffice_state`.
5. Authentification par en-tête Bearer ; aucun secret ou JWT dans l'URL, le dépôt ou les réponses.
6. Synchronisation non destructive avec ACK explicite pour les parcours hors ligne.
7. Identité métier distincte de l'inscription annuelle et de l'affectation.
8. Aucune donnée legacy ne peut être importée, copiée, transformée, mappée, réconciliée, rejouée ou backfillée dans la V2.
9. Les migrations versionnées de schéma V2 sont autorisées ; les migrations de données legacy vers V2 sont interdites.
10. Les données legacy restent isolées en archive ou lecture seule jusqu'à leur retrait validé par le CTO.

Le script `npm run verify:v2-foundation` rend la frontière 4 et la présence de la structure cible vérifiables dès le premier lot.

## 5. Politique des données V2 — clean start

La base métier V2 démarre vide. L'interdiction de reprise couvre notamment :

- établissements et configurations métier ;
- utilisateurs et comptes historiques ;
- enseignants, élèves et responsables ;
- classes, inscriptions, affectations et matières ;
- années scolaires, examens, notes, bulletins et présences ;
- paiements, abonnements, annonces et notifications ;
- journaux métier et snapshots `backoffice_state`.

L'état initial autorisé contient uniquement :

- le schéma V2 et les métadonnées de migrations de schéma ;
- les référentiels techniques neufs indispensables ;
- les rôles et permissions canoniques V2 ;
- un super-admin de bootstrap créé à neuf.

Les seeds de démonstration et les seeds issus de données métier legacy sont interdits. Les établissements, comptes et autres données métier sont créés à neuf par les parcours V2. Le legacy peut rester consultable séparément pour les besoins opérationnels, légaux ou d'audit, sans dépendance de lecture ou d'écriture depuis la V2.

## 6. Lots de construction

| Lot | Contenu | Gate de sortie |
|---|---|---|
| V2.0 | Structure, frontières, premier invariant tenant | Guard + tests domaine + CI verts |
| V2.1a | Rôles canoniques, `AuthPrincipal`, `can()` fail-closed | Tests auth + guard frontières + CI verts |
| V2.1b | Compatibilité stricte rôle ↔ `tenantScope` | Matrice exhaustive + tests auth + CI verts |
| V2.1c | Jetons de permission canoniques `<resource>:<action>` | Tests auth syntaxe/doublons + CI verts |
| V2.1d | Catalogue fermé des permissions d’identité/administration | Tests catalogue + CI verts |
| V2.1e | Matrice fermée rôle → permissions d’identité/administration | Matrice exhaustive 48/102 + tests auth + CI verts |
| V2.1f | Contrat immuable d’identité utilisateur V2 | Tests identité + non-régression auth + CI verts |
| V2.1g | Contrat immuable de session d’autorisation V2 | Tests session + liaison identité/principal + CI verts |
| V2.1h | Contrat immuable de révocation de session V2 | Tests révocation idempotente + non-régression auth + CI verts |
| V2.1i | Contrat pur de décision d’autorisation session + permission | Tests AUTHORIZED/UNAUTHENTICATED/FORBIDDEN + CI verts |
| V2.1j | Adaptateur HTTP pur des décisions d’autorisation (`apps/api`) | Mapping 200/401/403 fail-closed + CI verts |
| V2.1 | Identités, utilisateurs, sessions, RBAC (lots suivants) | Contrats V2 + 401/403/200 + parcours de création neufs |
| V2.2 | Schéma PostgreSQL V2 et migrations de schéma versionnées | Migration de schéma idempotente + rollback + isolation tenant + zéro backfill |
| V2.3 | Élèves et inscriptions annuelles créés à neuf | CRUD/transfert/clôture V2 + intégrité des données |
| V2.4 | Enseignants et affectations créés à neuf | Canon unique + idempotence + homonymes préservés |
| V2.5 | Adaptateurs web/mobile V2 | Parcours critiques + outbox/ACK + accessibilité |
| V2.6 | Cutover contrôlé vers une V2 indépendante | Préprod neuve stable + legacy isolé + observabilité + Go CTO explicite |

Chaque lot est fractionné en petites PR à objectif unique. Aucun lot n'autorise l'import de données legacy, le backfill ou la suppression non validée du précédent.

## 7. Périmètre exact de V2.0

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

## 8. Gate de merge V2.0

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation` vert ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime ni de schéma ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 9. Périmètre exact de V2.1a

Inclus :

- package `@somafrik/auth-v2` ;
- liste immuable des dix rôles canoniques V2 ;
- contrat immuable `AuthPrincipal` (`userId`, `role`, `tenantScope`, `permissions`) ;
- évaluation fail-closed `can(principal, permission)` par correspondance exacte ;
- tests unitaires du package auth ;
- câblage `npm run test:v2-auth` dans le gate V2.

Hors périmètre :

- JWT, login, refresh, logout, sessions ;
- endpoints HTTP et codes 401/403/200 ;
- PostgreSQL, migrations, schéma ;
- alias ou normalisation des rôles legacy ;
- matrice rôle ↔ tenant ;
- clients web/mobile et runtime legacy.

## 10. Gate de merge V2.1a

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation` et `npm run test:v2-auth` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime ni de schéma ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucun alias legacy ni droit implicite introduit ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 11. Gate de gouvernance clean start

- [x] issue de décision CTO créée (#123) ;
- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] diff limité à la documentation de reconstruction ;
- [x] aucune modification de code métier, runtime, schéma ou donnée ;
- [x] aucune formulation n'autorise une reprise de données legacy ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 12. Périmètre exact de V2.1b

Inclus :

- validation stricte de la compatibilité rôle canonique ↔ `tenantScope` dans `@somafrik/auth-v2` ;
- matrice CTO : `super_admin`→platform, `country_admin`→country, tous les autres rôles→school ;
- refus `AuthPrincipalValidationError` / `AUTH_PRINCIPAL_INVALID` pour toute combinaison incompatible ;
- `can()` fail-closed sur les principaux incompatibles ;
- tests unitaires de matrice exhaustive.

Hors périmètre :

- JWT, login, refresh, logout, sessions ;
- endpoints HTTP ;
- PostgreSQL, migrations, schéma, seeds ;
- permissions métier détaillées ;
- alias ou normalisation des rôles legacy ;
- lecture, copie, transformation, réconciliation ou migration de données legacy ;
- clients web/mobile et runtime legacy.

## 13. Gate de merge V2.1b

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth` et `npm run test:v2-domain` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucun alias legacy ni droit implicite introduit ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 14. Périmètre exact de V2.1c

Inclus :

- format canonique obligatoire `<resource>:<action>` pour tout jeton de permission ;
- segments en minuscules ASCII, chiffres, `_` ou `-`, démarrant par une lettre ;
- unicité stricte des permissions dans un `AuthPrincipal` ;
- refus fail-closed des wildcards, espaces, casse incorrecte et valeurs non-string ;
- `can()` refuse toute permission demandée non canonique, sans exception ;
- conservation de l'ordre fourni et copie immuable.

Hors périmètre :

- catalogue de permissions métier ;
- matrice rôle → permissions ;
- permission implicite ou dérivée du rôle ;
- wildcards ou normalisation silencieuse ;
- JWT, login, sessions, HTTP ;
- PostgreSQL, migrations, seeds, données legacy ;
- clients web/mobile et runtime legacy.

## 15. Gate de merge V2.1c

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth` et `npm run test:v2-domain` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucun catalogue métier ni matrice rôle → permissions introduits ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 16. Périmètre exact de V2.1d

Inclus :

- catalogue fermé immuable `AUTH_PERMISSION_CATALOG` (15 jetons d’identité/administration) ;
- export `isCataloguedAuthPermission(permission)` ;
- `createAuthPrincipal()` n’accepte que des jetons canoniques, catalogués et uniques ;
- `can()` fail-closed hors catalogue ;
- tests du catalogue et non-régression V2.1b/V2.1c.

Hors périmètre :

- matrice rôle → permissions ;
- catalogue des futurs domaines métier (notes, paiements, élèves, etc.) — ajoutés uniquement par leurs lots dédiés ;
- JWT, login, sessions, HTTP ;
- PostgreSQL, migrations, seeds, données legacy ;
- clients web/mobile et runtime legacy.

## 17. Gate de merge V2.1d

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth` et `npm run test:v2-domain` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucune matrice rôle → permissions introduite ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 18. Périmètre exact de V2.1e

Inclus :

- matrice fermée et immuable rôle canonique → permissions d’identité/administration autorisées ;
- `createAuthPrincipal()` n’accepte une permission que si elle est canonique, cataloguée (V2.1d), autorisée pour le rôle (V2.1e) et unique ;
- `can()` fail-closed si le principal porte une permission interdite pour son rôle ;
- pour un principal valide, `can()` n’accorde un droit que s’il est catalogué, autorisé pour le rôle **et** effectivement porté ;
- la matrice est une limite maximale : elle n’attribue jamais automatiquement une permission ;
- listes vides valides pour chacun des dix rôles ;
- rôles sans permission administrative (`accountant`, `teacher`, `parent`, `student`) : aucune permission du catalogue d’identité ; futures permissions métier réservées aux lots métier correspondants ;
- tests exhaustifs : 48 combinaisons autorisées et 102 refusées (10 rôles × 15 permissions).

Matrice exacte :

| Rôle | Permissions autorisées |
|---|---|
| `super_admin` | les 15 du catalogue |
| `country_admin` | `countries:read`, `countries:update`, `schools:create`, `schools:read`, `schools:update`, `schools:disable`, `users:create`, `users:read`, `users:update`, `users:disable`, `roles:assign`, `sessions:revoke` |
| `school_admin` | `schools:read`, `schools:update`, `users:create`, `users:read`, `users:update`, `users:disable`, `roles:assign`, `sessions:revoke` |
| `principal` | `schools:read`, `users:create`, `users:read`, `users:update`, `users:disable`, `roles:assign`, `sessions:revoke` |
| `secretary` | `schools:read`, `users:create`, `users:read`, `users:update` |
| `prefet` | `schools:read`, `users:read` |
| `accountant` | aucune |
| `teacher` | aucune |
| `parent` | aucune |
| `student` | aucune |

Hors périmètre :

- élargissement du catalogue V2.1d ;
- permissions métier (notes, paiements, élèves, etc.) ;
- héritage entre rôles, wildcards, alias legacy ou normalisation silencieuse ;
- JWT, login, sessions, HTTP ;
- PostgreSQL, migrations, seeds, données legacy ;
- clients web/mobile et runtime legacy.

## 19. Gate de merge V2.1e

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth` et `npm run test:v2-domain` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucune attribution automatique de permission depuis la matrice ;
- [x] aucun élargissement du catalogue V2.1d ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 20. Périmètre exact de V2.1f

Inclus :

- contrat immuable d’identité utilisateur V2 dans `@somafrik/auth-v2` ;
- export `AUTH_IDENTITY_STATUS` (`ACTIVE` → `"active"`, `DISABLED` → `"disabled"`) ;
- `createAuthIdentity({ userId, status, createdAt, disabledAt })` fail-closed ;
- `isAuthIdentityActive(identity)` fail-closed ;
- `userId` string non vide, sans normalisation, sans espaces de bord, sans contrôles, longueur ≤ 128 ;
- horodatages ISO 8601 UTC canoniques `YYYY-MM-DDTHH:mm:ss.sssZ` ;
- identité active ⇒ `disabledAt === null` ; identité désactivée ⇒ `disabledAt` canonique ≥ `createdAt` ;
- séparation stricte : identité ≠ identifiants de connexion, secrets, sessions, JWT, rôle, tenant, principal.

Séparation des concepts V2 :

- l’identité détermine si l’utilisateur existe et est globalement actif ;
- le principal représente un contexte d’autorisation distinct ;
- une future session liera explicitement une identité active à un principal validé (hors périmètre V2.1f).

Hors périmètre :

- login, email, téléphone, mots de passe, PIN, hash ou secrets ;
- JWT, refresh, logout, sessions ;
- intégration automatique identité → `createAuthPrincipal()` ;
- déduction de rôle, tenant, permission ou principal ;
- élargissement du catalogue V2.1d ou de la matrice V2.1e ;
- PostgreSQL, migrations, seeds, données legacy ;
- clients web/mobile et runtime legacy.

## 21. Gate de merge V2.1f

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth` et `npm run test:v2-domain` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucun secret ni identifiant de connexion dans le contrat d’identité ;
- [x] aucune intégration automatique identité → principal ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 22. Périmètre exact de V2.1g

Inclus :

- contrat immuable de session d’autorisation V2 dans `@somafrik/auth-v2` ;
- exports publics `createAuthSession(input)` et `isAuthSessionActive(session, now)` ;
- session = liaison explicite d’une identité V2 **active** et d’un principal valide au même `userId` ;
- champs exacts : `sessionId`, `identity`, `principal`, `issuedAt`, `expiresAt`, `revokedAt` ;
- horodatages ISO 8601 UTC canoniques ; `expiresAt` strictement supérieur à `issuedAt` ;
- `revokedAt` = `null` ou timestamp ≥ `issuedAt` ;
- `isAuthSessionActive` exige un `now` canonique fourni (aucune horloge système) ;
- activité : non révoquée, `now >= issuedAt`, `now < expiresAt` (borne d’expiration exclusive) ;
- copie profonde immuable ; aucun objet source conservé.

Séparation des concepts V2 :

- l’identité détermine l’existence et l’état d’accès global ;
- le principal représente un contexte d’autorisation distinct ;
- la session lie explicitement une identité active à un principal validé ;
- la session n’est ni JWT, ni token, ni cookie, ni session HTTP, ni donnée persistée.

Hors périmètre :

- JWT, signature, access/refresh token, cookies, login/logout HTTP ;
- email, téléphone, mot de passe, PIN, hash ou secret ;
- stockage mémoire/PostgreSQL, repository, migration, table, seed ;
- génération automatique de `sessionId`, rotation ou renouvellement ;
- sélection automatique de rôle ou tenant ;
- élargissement du catalogue V2.1d ou de la matrice V2.1e ;
- runtime legacy et données legacy.

La permission cataloguée `sessions:revoke` reste un jeton d’autorisation : elle ne déclenche aucune révocation dans ce lot.

## 23. Gate de merge V2.1g

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth` et `npm run test:v2-domain` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucune horloge implicite ni génération de token/JWT ;
- [x] aucune persistence ni endpoint de session ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 24. Périmètre exact de V2.1h

Inclus :

- export public `revokeAuthSession(session, revokedAt)` ;
- validation fail-closed de la session existante via le contrat V2.1g ;
- `revokedAt` obligatoire, ISO 8601 UTC canonique, ≥ `issuedAt` ;
- conservation de la première révocation : même timestamp → idempotent ; timestamp différent → rejet ;
- retour d’une nouvelle session profondément immuable ; session source jamais modifiée ;
- `isAuthSessionActive()` retourne `false` pour toute session révoquée.

Hors périmètre :

- endpoint HTTP de logout ;
- JWT, access token ou refresh token ;
- stockage PostgreSQL ou mémoire ;
- contrôle de la permission `sessions:revoke` ;
- révocation globale de toutes les sessions ;
- runtime et données legacy.

## 25. Gate de merge V2.1h

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth` et `npm run test:v2-domain` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucune persistence ni endpoint de logout ;
- [x] aucune vérification automatique de la permission `sessions:revoke` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 26. Périmètre exact de V2.1i

Inclus :

- export `AUTHORIZATION_DECISION` (`AUTHORIZED`, `UNAUTHENTICATED`, `FORBIDDEN`) ;
- export `evaluateSessionAuthorization(session, permission, now)` ;
- session invalide, révoquée, expirée ou non encore active → `UNAUTHENTICATED` ;
- `now` absent ou non canonique → `UNAUTHENTICATED` ;
- session active mais permission invalide, hors catalogue, interdite au rôle ou non portée → `FORBIDDEN` ;
- session active et `can(principal, permission) === true` → `AUTHORIZED` ;
- aucun throw vers l’appelant ; aucun droit implicite ; décision déterministe et immuable ;
- aucune mutation de la session ou du principal.

Hors périmètre :

- codes HTTP 401/403/200 ;
- middleware Express ;
- JWT, login et logout ;
- stockage ou recherche de session ;
- création d’utilisateurs ;
- élargissement du catalogue V2.1d ou de la matrice 48/102 ;
- runtime et données legacy.

## 27. Gate de merge V2.1i

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth` et `npm run test:v2-domain` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucun mapping HTTP 401/403/200 introduit ;
- [x] aucun élargissement du catalogue ou de la matrice 48/102 ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 28. Périmètre exact de V2.1j

Inclus :

- adaptateur HTTP pur dans `apps/api` : `authorizationDecisionToHttpStatus(decision)` ;
- mapping exact : `AUTHORIZED`→200, `UNAUTHENTICATED`→401, `FORBIDDEN`→403 ;
- décision inconnue ou invalide → 401 fail-closed ;
- réutilisation de `AUTHORIZATION_DECISION` depuis `@somafrik/auth-v2` sans recopier les chaînes ;
- aucun throw vers l’appelant ; aucune mutation ; aucun statut implicite 200 ;
- `packages/auth` reste indépendant du transport HTTP.

Hors périmètre :

- middleware Express et routes ;
- corps JSON ou headers HTTP ;
- extraction `Authorization: Bearer` ;
- JWT, login, refresh et logout ;
- recherche ou persistance des sessions ;
- contrats utilisateurs ;
- runtime et données legacy.

## 29. Gate de merge V2.1j

- [ ] diff GitHub indépendant relu par le CTO ;
- [ ] PR en brouillon jusqu'à stabilisation du périmètre ;
- [ ] `npm run verify:v2-foundation`, `npm run test:v2-auth`, `npm run test:v2-domain` et `npm run test:v2-api` verts ;
- [ ] typecheck, lint, tests et sécurité existants verts ;
- [ ] aucune modification de `packages/auth` ;
- [ ] aucune modification de runtime legacy, schéma ou donnée ;
- [ ] aucun conflit non résolu avec `develop` ;
- [ ] aucune donnée legacy lue ou migrée ;
- [ ] aucun middleware/route/JWT introduit ;
- [ ] décision CTO explicite avant passage Ready puis merge.
