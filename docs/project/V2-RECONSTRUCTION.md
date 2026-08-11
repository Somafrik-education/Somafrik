# Reconstruction contrôlée — Somafrik V2

**Statut :** chantier validé par décision CTO

**Date d'ouverture :** 2026-08-10

**Base initiale :** `develop@cfb20ce`

**Lot courant :** V2.1aa — AuthSessionAccessToken et liaison JWT ↔ session

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
| V2.1k | Extraction stricte du credential Bearer (`apps/api`) | Tests Bearer fail-closed + CI verts |
| V2.1l | Politique JWT d’accès RS256 (documentation) | Décision CTO documentée + CI verts |
| V2.1m | Durcissement de la politique temporelle JWT d’accès | Contrat temporel déterministe + CI verts |
| V2.1n | Implémentation pure du contrôle temporel JWT (`apps/api`) | `isJwtTemporalPolicySatisfied` fail-closed + CI verts |
| V2.1o | Contrat strict de structure et de claims JWT d’accès | Décision CTO documentée + CI verts |
| V2.1p | Implémentation pure du contrôle structurel des claims JWT (`apps/api`) | `isJwtClaimsPolicySatisfied` fail-closed + CI verts |
| V2.1q | Contrat de décodage JWT compact sécurisé (documentation) | Décision CTO documentée + CI verts |
| V2.1r | Implémentation pure du décodeur JWT compact strict (`apps/api`) | `decodeJwtCompactStrict` fail-closed + CI verts |
| V2.1s | Contrat de vérification RS256 pure (documentation) | Décision CTO documentée + CI verts |
| V2.1t | Implémentation pure du vérificateur RS256 (`apps/api`) | `verifyJwtRs256Signature` fail-closed + CI verts |
| V2.1u | Contrat de résolution stricte de `kid` (documentation) | Décision CTO documentée + CI verts |
| V2.1v | Implémentation pure du résolveur strict de `kid` (`apps/api`) | `resolveJwtRs256VerificationKey` fail-closed + CI verts |
| V2.1w | Contrat du pipeline JWT d’accès pré-session (documentation) | Décision CTO documentée + CI verts |
| V2.1x | Implémentation pure du pipeline JWT d’accès pré-session (`apps/api`) | `verifyJwtAccessTokenCryptographically` fail-closed + CI verts |
| V2.1y | Contrat de liaison JWT ↔ session (documentation) | Décision CTO documentée + CI verts |
| V2.1z | Contrat du cycle de vie de `jti` et prévention du rejeu (documentation) | Décision CTO documentée + CI verts |
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

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth`, `npm run test:v2-domain` et `npm run test:v2-api` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de `packages/auth` ;
- [x] aucune modification de runtime legacy, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucun middleware/route/JWT introduit ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 30. Périmètre exact de V2.1k

Inclus :

- export `extractBearerCredential(authorizationHeader)` dans `apps/api` ;
- entrée obligatoirement `string` ;
- schéma `Bearer` insensible à la casse (HTTP) ;
- exactement un espace ASCII entre schéma et credential ;
- credential non vide, longueur ≤ 4096 ;
- caractères RFC Bearer : lettres, chiffres, `-._~+/` et `=` terminaux éventuels ;
- aucun espace, tabulation, contrôle Unicode, virgule ou en-tête multiple ;
- aucune normalisation du credential ;
- entrée invalide ou hostile → `null`, sans exception ;
- aucun secret dans les logs ou messages d’erreur.

Hors périmètre :

- validation ou décodage JWT ;
- signature, claims, expiration ou issuer ;
- middleware Express et routes ;
- token dans query string, cookie ou corps HTTP ;
- création/recherche de session ;
- login, refresh et logout ;
- runtime et données legacy.

## 31. Gate de merge V2.1k

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth`, `npm run test:v2-domain` et `npm run test:v2-api` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] aucune modification de `packages/auth` ;
- [x] aucune modification de runtime legacy, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] aucune donnée legacy lue ou migrée ;
- [x] aucun JWT decode/verify ni middleware/route introduit ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 32. Périmètre exact de V2.1l

Lot **documentation uniquement**. Aucune bibliothèque JWT, aucun code de signature/vérification, aucun middleware, aucune route et aucun changement legacy.

### Politique JWT d’accès V2

Algorithme et enveloppe :

- algorithme obligatoire : **RS256** ;
- header JWT obligatoire, exact : `alg`, `typ`, `kid` ;
- `alg` doit valoir exactement `RS256` ; toute autre valeur ou absence est refusée ;
- `typ` doit valoir exactement `"JWT"` ; toute autre valeur, alias legacy ou absence est refusée ;
- `kid` :
  - obligatoirement de type `string` et non vide ;
  - comparaison exacte avec l’identifiant d’une clé publique **active** de vérification ;
  - `kid` inconnu, retiré, ambigu, non-string, vide ou absent → refus fail-closed.

Claims obligatoires :

| Claim | Rôle |
|---|---|
| `iss` | émetteur V2 — valeur attendue fournie par configuration sécurisée ; comparaison exacte, sans normalisation ; absente, vide ou différente → refus |
| `aud` | audience cible — valeur exacte `somafrik-api-v2` |
| `sub` | identifiant d’identité utilisateur (`userId`) |
| `sid` | identifiant de session d’autorisation V2 |
| `iat` | instant d’émission |
| `nbf` | début de validité |
| `exp` | expiration |
| `jti` | identifiant unique du jeton |

Contraintes temporelles et d’audience :

- audience obligatoire : `somafrik-api-v2` (comparaison exacte, sans normalisation) ;
- durée de vie maximale : **15 minutes** (`exp - iat ≤ 900` secondes) ;
- tolérance d’horloge : **30 secondes** pour `nbf` / `exp` ;
- `nbf` ≤ instant d’évaluation (+ tolérance) ; `exp` > instant d’évaluation (− tolérance) ;
- le contrat temporel exact (`iat` / `nbf` / `exp` / `evaluationTime`, ordre, durée strictement positive et bornes) est durci sans assouplissement dans **V2.1m**.

Séparation des responsabilités :

- le JWT **ne contient aucun** rôle, tenant, permission ou droit ;
- l’autorisation est **reconstruite** depuis la session d’autorisation V2 liée par `sid` (identité active + principal validé) ;
- `sub` doit correspondre au `userId` de l’identité/session résolue ; toute discordance est refusée ;
- la révocation ou l’expiration de session invalide l’accès même si le JWT est encore dans sa fenêtre temporelle.

Gestion des clés :

- clés **privées hors dépôt** (secrets d’environnement / KMS) ;
- rotation par `kid` ; une clé active unique par `kid` ; les jetons signés avec un `kid` retiré, inconnu ou ambigu sont refusés ;
- aucune clé privée, secret ou JWT complet dans le dépôt, les logs, les URLs ou les réponses.

### Hors périmètre de V2.1l

- implémentation de signature, vérification ou décodage JWT ;
- bibliothèque JWT ;
- middleware Express et routes ;
- login, refresh, logout ;
- persistance ou recherche de session ;
- runtime et données legacy.

## 33. Gate de merge V2.1l

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu'à stabilisation du périmètre ;
- [x] `npm run verify:v2-foundation`, `npm run test:v2-auth`, `npm run test:v2-domain` et `npm run test:v2-api` verts ;
- [x] typecheck, lint, tests et sécurité existants verts ;
- [x] diff limité à la documentation de reconstruction ;
- [x] `typ === "JWT"`, `iss` exact depuis config sécurisée, et `kid` string non vide lié à une clé active sont explicitement définis ;
- [x] aucune bibliothèque, code JWT, middleware, route ou changement legacy ;
- [x] aucun secret ou clé privée introduit dans le dépôt ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 34. Périmètre exact de V2.1m

Lot **documentation uniquement**. Aucune bibliothèque JWT, aucun code de signature/vérification/décodage, aucun middleware, aucune route, aucun secret, aucune clé et aucun changement de runtime, schéma ou donnée.

Objectif : compléter la politique JWT RS256 de V2.1l avec un **contrat temporel déterministe, strict et fail-closed**. La réussite temporelle ne suffit pas à autoriser l’accès : toutes les autres règles JWT, session et autorisation restent obligatoires.

### Non-régression de la politique V2.1l

Conservées sans élargissement :

- algorithme obligatoire `RS256` ;
- header exact `alg`, `typ`, `kid` ;
- `alg === "RS256"` ;
- `typ === "JWT"` ;
- `kid` string non vide ;
- correspondance exacte de `kid` avec une unique clé publique active ;
- `iss` exact depuis la configuration sécurisée, sans normalisation ;
- `aud === "somafrik-api-v2"` ;
- claims obligatoires `iss`, `aud`, `sub`, `sid`, `iat`, `nbf`, `exp`, `jti` ;
- aucun rôle, tenant, droit ou permission dans le JWT ;
- reconstruction de l’autorisation depuis la session liée par `sid` ;
- correspondance exacte entre `sub` et le `userId` de la session résolue ;
- session révoquée, expirée ou invalide → accès refusé ;
- clés privées hors dépôt ;
- rotation des clés par `kid` ;
- aucun JWT complet dans les logs, URLs ou réponses.

### Claims temporels obligatoires

Les claims temporels obligatoires sont `iat`, `nbf` et `exp`. Chacun doit être :

- un JSON number ;
- un entier ;
- fini ;
- sûr au sens `Number.isSafeInteger` ;
- positif ou nul ;
- exprimé en secondes Unix UTC ;
- fourni explicitement ;
- jamais converti depuis une string ;
- jamais arrondi, normalisé ou remplacé par une valeur par défaut.

Doivent être refusés : strings numériques ; nombres décimaux ; `NaN` ; `Infinity` et `-Infinity` ; nombres négatifs ; valeurs hors plage des entiers sûrs ; valeurs absentes ; `null` ; booléens ; tableaux et objets.

### Instant d’évaluation — `evaluationTime`

L’instant d’évaluation doit être fourni **explicitement** au futur vérificateur sous le nom documentaire `evaluationTime` : entier Unix UTC en secondes respectant les **mêmes contraintes de type** que `iat` / `nbf` / `exp`.

La politique pure **ne dépend pas implicitement** de l’horloge système. L’adaptateur runtime futur pourra obtenir l’heure système puis l’injecter explicitement ; cet adaptateur reste hors périmètre de V2.1m.

### Ordre temporel obligatoire

La relation suivante doit être satisfaite exactement :

```text
iat <= nbf < exp
```

Conséquences :

- `nbf < iat` → refus ;
- `nbf === iat` → accepté ;
- `exp === nbf` → refus ;
- `exp <= iat` → refus ;
- tout ordre incohérent → refus fail-closed.

Durée de vie :

```text
0 < exp - iat <= 900
```

Donc `exp - iat` est strictement positif et au plus **900** secondes. Aucune tolérance d’horloge ne doit augmenter cette durée maximale déclarée.

### Contrôle de `iat`

Avec la tolérance CTO de **30** secondes :

```text
iat <= evaluationTime + 30
```

Si `iat > evaluationTime + 30`, le jeton est refusé. La tolérance ne permet aucune mutation ou normalisation du claim.

### Contrôle de `nbf`

Le jeton n’est pas encore utilisable si :

```text
nbf > evaluationTime + 30
```

Il est temporellement admissible pour cette borne si :

```text
nbf <= evaluationTime + 30
```

Ce contrôle s’ajoute à l’ordre obligatoire `iat <= nbf`.

### Contrôle de `exp`

L’expiration est une **borne exclusive**. Le jeton est expiré si :

```text
exp <= evaluationTime - 30
```

Il reste admissible pour cette borne uniquement si :

```text
exp > evaluationTime - 30
```

À égalité exacte `exp === evaluationTime - 30`, le jeton est **refusé**. La tolérance de 30 secondes ne modifie jamais `0 < exp - iat <= 900`.

### Algorithme décisionnel (futur vérificateur)

Refuser le jeton si **au moins une** condition suivante est vraie :

1. `iat`, `nbf`, `exp` ou `evaluationTime` n’est pas un entier Unix sûr, fini et positif ou nul ;
2. `iat > nbf` ;
3. `nbf >= exp` ;
4. `exp - iat <= 0` ;
5. `exp - iat > 900` ;
6. `iat > evaluationTime + 30` ;
7. `nbf > evaluationTime + 30` ;
8. `exp <= evaluationTime - 30`.

Toutes les conditions inverses doivent être satisfaites **cumulativement** pour que le contrôle temporel réussisse. La réussite temporelle ne suffit pas à autoriser l’accès.

### Exemples normatifs

Paramètres : `evaluationTime = 1_000_000` ; tolérance = **30** secondes.

| Cas | iat | nbf | exp | Résultat |
|---|---:|---:|---:|---|
| valide immédiat | 1 000 000 | 1 000 000 | 1 000 900 | accepté temporellement |
| futur dans tolérance | 1 000 030 | 1 000 030 | 1 000 900 | accepté temporellement |
| iat trop futur | 1 000 031 | 1 000 031 | 1 000 900 | refus |
| nbf trop futur | 1 000 000 | 1 000 031 | 1 000 900 | refus |
| expiré à la borne | 999 070 | 999 070 | 999 970 | refus |
| juste dans tolérance d’expiration | 999 071 | 999 071 | 999 971 | accepté temporellement |
| durée nulle | 1 000 000 | 1 000 000 | 1 000 000 | refus |
| durée supérieure à 900 | 1 000 000 | 1 000 000 | 1 000 901 | refus |
| nbf antérieur à iat | 1 000 000 | 999 999 | 1 000 900 | refus |
| exp égal à nbf | 1 000 000 | 1 000 100 | 1 000 100 | refus |

Pour toute ligne « accepté temporellement », les autres validations JWT, session et autorisation restent obligatoires.

### Hors périmètre de V2.1m

- bibliothèque JWT ; signature, vérification ou décodage JWT ;
- clé publique ou privée ; secret ;
- middleware ; endpoint HTTP ; login, refresh ou logout ;
- persistance ou résolution de session ;
- appel à `Date.now()` ; génération de `jti` ;
- modification de la matrice 48/102 ; permission supplémentaire ;
- dépendance au runtime legacy ; lecture ou migration de données legacy.

## 35. Gate de merge V2.1m

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [x] `iat`, `nbf`, `exp` et `evaluationTime` définis comme entiers Unix sûrs ;
- [x] ordre exact `iat <= nbf < exp` documenté ;
- [x] durée exacte `0 < exp - iat <= 900` documentée ;
- [x] `iat <= evaluationTime + 30` documenté ;
- [x] bornes `nbf` et `exp` documentées sans ambiguïté ;
- [x] expiration exclusive explicitement documentée ;
- [x] tableau des cas limites présent et cohérent ;
- [x] aucune bibliothèque ou implémentation JWT introduite ;
- [x] aucun secret, aucune clé et aucun JWT introduit ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 36. Périmètre exact de V2.1n

Lot d’implémentation **pure** dans `@somafrik/api-v2` du contrôle temporel documenté par V2.1m.

### Export public exact

- fichier : `apps/api/src/jwt-temporal-policy.js` ;
- export unique ajouté : `isJwtTemporalPolicySatisfied(iat, nbf, exp, evaluationTime)` ;
- réexport depuis `apps/api/src/index.js` ;
- les exports existants `authorizationDecisionToHttpStatus` et `extractBearerCredential` restent inchangés.

### Contrat d’exécution

- les quatre valeurs sont des primitives injectées **explicitement** ; aucune horloge système (`Date.now`, `Date`) ;
- validation stricte : `number` entier fini sûr (`Number.isSafeInteger`), ≥ 0 ; aucune coercition, normalisation, troncature, défaut ou arrondi ;
- retourne uniquement `true` ou `false` ; **aucun throw** vers l’appelant ;
- `true` signifie uniquement **TEMPORALLY_VALID** — jamais JWT authentique, signature valide, session valide, utilisateur authentifié, permission accordée ou accès autorisé ;
- règles cumulatives : `iat <= nbf`, `nbf < exp`, `0 < exp - iat <= 900`, bornes de tolérance 30 s ;
- expiration exclusive : `exp > evaluationTime - 30` ;
- arithmétique sans débordement silencieux près de `Number.MAX_SAFE_INTEGER` :
  - borne future : si `candidate <= evaluationTime` alors admissible ; sinon `candidate - evaluationTime <= 30` ;
  - expiration : si `evaluationTime < 30` alors toute `exp >= 0` valide pour cette borne ; sinon `exp > evaluationTime - 30`.

### Hors périmètre de V2.1n

- bibliothèque JWT ; décodage Base64URL/JSON ; signature ou vérification cryptographique ;
- clés, secrets, résolution de `kid` ; validation de `iss` / `aud` / `sub` / `sid` / `jti` ;
- middleware, routes, login/refresh/logout, persistance de session ;
- modification de la matrice 48/102 ; dépendance legacy.

## 37. Gate de merge V2.1n

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] export public limité à `isJwtTemporalPolicySatisfied` ;
- [x] validation stricte des quatre entiers Unix sûrs ;
- [x] ordre `iat <= nbf < exp` appliqué ;
- [x] durée `0 < exp - iat <= 900` appliquée ;
- [x] tolérance de 30 secondes appliquée sans débordement ;
- [x] expiration exclusive appliquée ;
- [x] aucune horloge implicite ;
- [x] aucun décodage ou contrôle cryptographique JWT ;
- [x] aucune dépendance ajoutée ;
- [x] tests normatifs et cas limites verts ;
- [x] non-régression API/auth/domaine ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 38. Périmètre exact de V2.1o

Lot **documentation uniquement**. Aucune bibliothèque JWT, aucun décodage, aucune vérification cryptographique, aucune clé, aucun secret, aucune fonction de validation, aucun middleware, aucune route et aucun changement de runtime, schéma ou donnée.

Objectif : contractualiser de façon déterministe et fail-closed la **structure exacte** du header protégé et des claims non temporels d’un JWT d’accès V2, applicable au résultat futur d’un décodage JWT vérifié.

### Non-régression

Conservées sans élargissement :

- RS256 obligatoire ;
- header exact `alg`, `typ`, `kid` ;
- audience exacte `somafrik-api-v2` ;
- politique temporelle V2.1m / V2.1n ;
- aucun rôle, tenant, droit ou permission dans le JWT ;
- reconstruction de l’autorisation depuis `sid` ;
- correspondance exacte `sub` ↔ `userId` de la session ;
- session révoquée, expirée ou invalide → refus ;
- clés privées hors dépôt ;
- rotation des clés par `kid` ;
- aucun JWT complet dans les logs, URLs ou réponses ;
- matrice 48/102 inchangée.

### Header protégé exact

Le header protégé JWT doit être un objet JSON contenant **exactement** les trois clés propres suivantes :

- `alg`
- `typ`
- `kid`

Aucune clé supplémentaire n’est autorisée.

Valeurs obligatoires :

- `alg === "RS256"`
- `typ === "JWT"`
- `kid` conforme au contrat ci-dessous

Doivent notamment être refusés :

- header absent ou `null` ;
- tableau ou primitive ;
- clé obligatoire absente ;
- clé supplémentaire ;
- `alg` différent de `RS256` ;
- `typ` différent de `JWT` ;
- `alg`, `typ` ou `kid` non-string ;
- valeurs héritées plutôt que propriétés propres ;
- duplications de clés JSON détectées par le futur parseur sécurisé ;
- objets ou valeurs hostiles.

La vérification cryptographique reste hors périmètre de V2.1o.

### Contrat exact de `kid`

`kid` doit être :

- une string JSON ;
- non vide ;
- longue de **1 à 128** caractères ASCII ;
- composée uniquement de : `A-Z` `a-z` `0-9` `.` `_` `:` `-` ;
- fournie explicitement ;
- comparée exactement, sans normalisation.

Sont interdits : espaces ; tabulations et contrôles ; Unicode hors ASCII ; slash et backslash ; chaînes numériques converties ; trim implicite ; changement de casse ; valeur vide ou supérieure à 128 caractères.

La future résolution devra trouver **exactement une** clé publique active correspondant à `kid`. Zéro correspondance ou plusieurs correspondances → refus. Aucune clé n’est introduite dans V2.1o.

### Payload exact

Le payload d’un JWT d’accès doit contenir **exactement** les huit claims suivants, comme propriétés propres :

- `iss`
- `aud`
- `sub`
- `sid`
- `iat`
- `nbf`
- `exp`
- `jti`

Aucun claim supplémentaire n’est autorisé. Cela interdit notamment dans le JWT : `role`, `roles`, `tenant`, `tenantId`, `tenantScope`, `permission`, `permissions`, `rights`, `scopes`, `authorization`, `schoolId`, `countryId`, et toute donnée métier ou d’autorisation supplémentaire.

Doivent être refusés : payload absent ou `null` ; tableau ou primitive ; claim obligatoire absent ; claim supplémentaire ; valeur héritée plutôt que propriété propre ; duplication de clé JSON détectée par le futur parseur sécurisé ; objet ou valeur hostile ; coercition ou valeur par défaut.

### Contrat exact de `iss`

`iss` doit être :

- une string JSON ;
- non vide ;
- longue de **1 à 2048** caractères ;
- sans caractère de contrôle ;
- sans espace en début ou en fin ;
- égale **exactement** à `expectedIssuer`.

`expectedIssuer` doit être fourni **explicitement** au futur vérificateur depuis une configuration sécurisée. Le contrat pur ne lit aucune variable d’environnement.

Sont interdits : normalisation d’URL ; ajout ou retrait de slash ; trim ; changement de casse ; résolution DNS ; alias legacy ; issuer implicite ou valeur par défaut.

`expectedIssuer` absent, invalide ou différent de `iss` → refus fail-closed.

### Contrat exact de `aud`

`aud` doit être une string JSON exacte :

```text
somafrik-api-v2
```

Sont refusés : tableau d’audiences ; autre string ; différence de casse ; espaces ; valeur absente ; valeur non-string ; normalisation ou alias.

### Contrat exact de `sub`, `sid` et `jti`

Chacun de `sub`, `sid` et `jti` doit être :

- une string JSON ;
- non vide ;
- longue de **1 à 128** caractères ASCII ;
- composée uniquement de : `A-Z` `a-z` `0-9` `.` `_` `:` `-` ;
- fournie explicitement ;
- conservée et comparée exactement.

Sont interdits : espaces ; caractères de contrôle ; Unicode hors ASCII ; slash et backslash ; valeur non-string ; string vide ; valeur supérieure à 128 caractères ; trim, changement de casse ou conversion.

Rôles :

- `sub` : `userId` exact de l’identité liée à la session ;
- `sid` : `sessionId` exact permettant la résolution future de la session ;
- `jti` : identifiant exact et unique du JWT.

V2.1o ne génère aucun `jti` et ne recherche aucune session.

### Claims temporels (conservation V2.1m / V2.1n)

Conservés intégralement :

- `iat`, `nbf` et `exp` sont des JSON numbers ; entiers sûrs, finis et positifs ou nuls ;
- ordre exact `iat <= nbf < exp` ;
- durée exacte `0 < exp - iat <= 900` ;
- `iat <= evaluationTime + 30` ;
- `nbf <= evaluationTime + 30` ;
- `exp > evaluationTime - 30` ;
- expiration exclusive ;
- aucune conversion, normalisation ou horloge implicite.

`evaluationTime` est injecté explicitement et **n’appartient pas** au payload JWT.

### Algorithme décisionnel structurel (futur vérificateur)

Refuser si **au moins une** condition suivante est vraie :

1. le header n’est pas un objet JSON conforme ;
2. les clés du header ne sont pas exactement `alg`, `typ` et `kid` ;
3. `alg !== "RS256"` ;
4. `typ !== "JWT"` ;
5. `kid` est invalide ;
6. le payload n’est pas un objet JSON conforme ;
7. les clés du payload ne sont pas exactement les huit claims obligatoires ;
8. `iss` est invalide ou différent de `expectedIssuer` ;
9. `aud !== "somafrik-api-v2"` ou `aud` n’est pas une string ;
10. `sub`, `sid` ou `jti` est invalide ;
11. le contrôle temporel V2.1n retourne `false` ;
12. une valeur a été convertie, normalisée ou remplacée.

Toutes les validations doivent réussir **cumulativement**. Même si elles réussissent, cela ne signifie jamais : signature cryptographique valide ; clé active vérifiée ; session valide ; identité active ; utilisateur authentifié ; permission accordée ; accès autorisé.

### Exemples normatifs

| Cas | Résultat structurel |
|---|---|
| header exact + payload exact + valeurs valides | admissible structurellement |
| header avec `alg` HS256 | refus |
| header avec `typ` jwt | refus |
| header avec clé supplémentaire | refus |
| `kid` vide | refus |
| `kid` avec espace | refus |
| payload avec les huit claims exacts | admissible structurellement |
| payload sans `sid` | refus |
| payload avec `role` supplémentaire | refus |
| `aud` sous forme de tableau | refus |
| `iss` différent de `expectedIssuer` | refus |
| `sub` vide | refus |
| `sid` non-string | refus |
| `jti` supérieur à 128 caractères | refus |
| claims temporels valides structurellement mais temporellement invalides | refus |

« Admissible structurellement » ne constitue ni une authentification ni une autorisation.

### Hors périmètre de V2.1o

- bibliothèque JWT ; décodage Base64URL ou JSON ; vérification ou signature cryptographique ;
- clé publique ou privée ; secret ; résolution réelle de `kid` ;
- fonction de validation des claims ; middleware ou route HTTP ;
- login, refresh ou logout ; repository ou persistance de session ;
- variable d’environnement ; `Date.now()` ou horloge système ;
- génération ou persistance de `jti` ; permission supplémentaire ;
- modification de la matrice 48/102 ; dépendance au runtime ou aux données legacy.

## 39. Gate de merge V2.1o

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [x] header exact `alg`, `typ`, `kid` documenté ;
- [x] payload exact des huit claims documenté ;
- [x] formats stricts de `kid`, `sub`, `sid` et `jti` documentés ;
- [x] `iss` exact et `expectedIssuer` explicitement injecté ;
- [x] `aud` string exacte `somafrik-api-v2` ;
- [x] claims supplémentaires interdits ;
- [x] rôle, tenant et permissions explicitement interdits ;
- [x] politique temporelle V2.1m/V2.1n conservée ;
- [x] aucune bibliothèque ou implémentation JWT introduite ;
- [x] aucun secret, aucune clé et aucun JWT introduit ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 40. Périmètre exact de V2.1p

Lot d’implémentation **pure** dans `@somafrik/api-v2` du contrat structurel V2.1o.

### Export public exact

- fichier : `apps/api/src/jwt-claims-policy.js` ;
- export unique ajouté : `isJwtClaimsPolicySatisfied(protectedHeader, payload, expectedIssuer, evaluationTime)` ;
- réexport depuis `apps/api/src/index.js` ;
- les exports existants `authorizationDecisionToHttpStatus`, `extractBearerCredential` et `isJwtTemporalPolicySatisfied` restent inchangés.

### Contrat d’exécution

- `protectedHeader` et `payload` sont des objets **déjà décodés** et injectés explicitement ; aucun JWT compact, aucun décodage de segment, aucun parse de chaîne sérialisée ;
- objets ordinaires uniquement (`Object.prototype` ou prototype `null`) ; propriétés propres de données ; symboles, accesseurs, héritage utilisé, tableaux, instances et proxies hostiles → `false` ;
- header exact : `alg`, `typ`, `kid` ; `alg === "RS256"` ; `typ === "JWT"` ; `kid` ASCII 1–128 (`A-Z a-z 0-9 . _ : -`) ;
- payload exact : huit claims `iss`, `aud`, `sub`, `sid`, `iat`, `nbf`, `exp`, `jti` ; tout claim supplémentaire → `false` ;
- `iss` et `expectedIssuer` validés puis comparés par `===` ; `aud === "somafrik-api-v2"` ;
- contrôle temporel **délégué** à V2.1n via `isJwtTemporalPolicySatisfied(payload.iat, payload.nbf, payload.exp, evaluationTime)` sans duplication des règles ;
- la détection des clés JSON dupliquées appartient au **futur parseur sécurisé** (non observable après un parsing standard) ; V2.1p ne parse aucune charge sérialisée ;
- retourne uniquement `true` / `false` ; **aucun throw** ; `true` = **STRUCTURALLY_AND_TEMPORALLY_ADMISSIBLE** uniquement — jamais authentification ni autorisation.

### Hors périmètre de V2.1p

- bibliothèque JWT ; parseur ; décodage compact ; cryptographie ; clés ; secrets ; résolution réelle de `kid` ;
- middleware, routes, login/refresh/logout, session ; `Date.now()` ; variables d’environnement ;
- modification de `packages/auth` ou de la matrice 48/102 ; dépendance legacy.

## 41. Gate de merge V2.1p

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] export public limité à `isJwtClaimsPolicySatisfied` ;
- [x] header limité exactement à `alg`, `typ` et `kid` ;
- [x] payload limité exactement aux huit claims obligatoires ;
- [x] propriétés supplémentaires, héritées, symboles et accesseurs refusés ;
- [x] objets et valeurs hostiles traités fail-closed ;
- [x] formats `kid`, `sub`, `sid` et `jti` appliqués strictement ;
- [x] `iss` et `expectedIssuer` validés puis comparés exactement ;
- [x] `aud` string exacte `somafrik-api-v2` ;
- [x] contrôle temporel délégué à V2.1n sans duplication ;
- [x] aucune horloge implicite ;
- [x] aucun décodage, parsing ou contrôle cryptographique JWT ;
- [x] aucune dépendance ajoutée ;
- [x] tests normatifs et cas limites verts ;
- [x] non-régression API/auth/domaine ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 42. Périmètre exact de V2.1q

Lot **documentation uniquement**. Aucune bibliothèque JWT, aucun décodeur, aucune vérification cryptographique, aucune clé, aucun secret, aucun middleware, aucune route et aucun changement de runtime, schéma ou donnée.

Objectif : contractualiser le **décodage strict** d’un JWT compact **avant** toute vérification cryptographique. L’implémentation pure est réservée à un lot ultérieur (V2.1r).

### Export documentaire exact

Future fonction pure :

```text
decodeJwtCompactStrict(compactToken)
```

Résultat attendu en cas de succès structurel :

```text
{
  protectedHeader,
  payload,
  signingInput, // string exacte "header.payload"
  signature     // Uint8Array, byteLength >= 1
}
```

Toute anomalie → `null`. Aucune exception sortante.

### Entrée — `compactToken`

- type exact `string` ;
- non vide ;
- longueur maximale **4096** caractères ;
- fournie explicitement ;
- aucune coercition, normalisation, trim ou valeur par défaut.

Doivent notamment être refusés : `null`, `undefined`, non-string, string vide, longueur > 4096, tableaux, objets, valeurs hostiles.

### Forme compacte exacte

Le jeton compact doit contenir **exactement trois** segments **non vides**, séparés par **exactement deux** points (`.`) :

```text
<header>.<payload>.<signature>
```

Doivent être refusés :

- moins ou plus de trois segments ;
- segment vide (`..`, `.abc.`, etc.) ;
- séparateur autre que `.` ;
- points supplémentaires ;
- espaces, contrôles ou Unicode hors alphabet Base64URL dans un segment.

### Alphabet Base64URL canonique

Chaque segment doit être composé uniquement de :

```text
A-Z a-z 0-9 - _
```

Interdits dans tout segment :

- `+` et `/` (alphabet Base64 classique) ;
- `=` (padding) ;
- espaces, tabulations, contrôles ;
- tout caractère Unicode hors ASCII autorisé ;
- toute forme non canonique ou normalisée.

### Canonicalité Base64URL stricte

L’alphabet autorisé ne suffit pas. Pour **chaque** segment (`header`, `payload`, `signature`), le futur décodeur doit appliquer cumulativement :

1. `segment.length % 4 !== 1` — sinon `null` (longueur Base64URL invalide) ;
2. décodage Base64URL **strict** (échec → `null`) ;
3. réencodage Base64URL **sans padding** des octets obtenus ;
4. égalité exacte `réencodé === segment` initial.

Conséquences obligatoires :

- tout encodage avec bits résiduels non nuls qu’un décodeur permissif pourrait accepter est refusé ;
- tout padding implicite, variante d’alphabet ou forme non canonique est refusé ;
- aucun segment n’est accepté uniquement parce que le décodage a produit des octets.

### Décodage UTF-8 strict

Après décodage Base64URL **canonique** des segments header et payload :

- interprétation UTF-8 **stricte** ;
- aucun remplacement silencieux par `U+FFFD` ;
- toute séquence UTF-8 invalide → `null`.

### Parse JSON sécurisé — header et payload

Les octets décodés de header et payload doivent produire des **objets JSON ordinaires** :

- objets uniquement à la racine (pas de tableau racine, pas de primitive racine, pas de `null` racine) ;
- détection et refus des **clés JSON dupliquées** **avant** la création des objets JavaScript ;
- le refus des clés dupliquées s’applique à **tous les niveaux d’imbrication** JSON (racine et objets imbriqués), pas seulement à la racine ;
- prototypes admissibles futurs limités à `Object.prototype` ou `null` ;
- refus des prototypes spéciaux, instances de classe, tableaux, Map/Set/Date/RegExp ;
- aucune propriété héritée introduite par le parseur ;
- aucune coercition ni valeur par défaut.

#### Clés JSON dangereuses — liste exacte minimale

Doivent être refusées à **tous les niveaux d’imbrication** JSON (racine et objets imbriqués), dès qu’elles apparaissent comme noms de clés :

- `__proto__`
- `prototype`
- `constructor`

Toute autre forme hostile observable au parse reste refusée fail-closed. La détection des clés dupliquées et des clés dangereuses est une responsabilité **explicite** de ce futur décodeur (contrairement à V2.1p qui reçoit des objets déjà construits).

### `signingInput`

Conservé **byte-for-byte** sous la forme exacte :

```text
<headerSegment>.<payloadSegment>
```

Aucun réencodage, aucune normalisation, aucune reconstruction depuis les objets parsés.

### `signature`

Type JavaScript exact obligatoire :

```text
signature: Uint8Array
```

Contraintes :

- instance exacte de `Uint8Array` (pas d’alias texte, pas de `Array` de nombres, pas de `Buffer` exposé comme API publique, pas de représentation Base64URL conservée) ;
- obtenue par décodage Base64URL **canonique** du troisième segment ;
- `byteLength >= 1` (non vide) ;
- **aucune** vérification cryptographique dans V2.1q ni dans le futur décodeur V2.1r de ce contrat ;
- la signature est uniquement exposée pour un vérificateur cryptographique ultérieur hors périmètre.

### Sémantique du succès

Un résultat non-`null` signifie uniquement :

**STRUCTURALLY_DECODED**

Il ne signifie jamais :

- authentification ;
- autorisation ;
- signature RS256 valide ;
- `kid` résolu ;
- claims conformes à V2.1o/V2.1p ;
- session ou identité valides.

Le futur pipeline pourra ensuite enchaîner `isJwtClaimsPolicySatisfied` et la vérification cryptographique ; **V2.1q n’appelle aucun** de ces contrôles.

### Algorithme décisionnel documentaire

Retourner `null` si **au moins une** condition suivante est vraie :

1. `compactToken` n’est pas une string non vide de longueur ≤ 4096 ;
2. la forme n’est pas exactement trois segments non vides séparés par deux points ;
3. un segment contient un caractère hors alphabet Base64URL canonique ;
4. un segment viole `segment.length % 4 !== 1`, échoue au décodage strict, ou diffère de son réencodage Base64URL sans padding ;
5. le décodage Base64URL produit une charge vide là où des octets sont requis ;
6. le décodage UTF-8 du header ou du payload n’est pas strictement valide ;
7. le JSON du header ou du payload n’est pas un objet ordinaire à la racine ;
8. des clés JSON dupliquées sont détectées à n’importe quel niveau d’imbrication ;
9. une clé dangereuse `__proto__`, `prototype` ou `constructor` apparaît à n’importe quel niveau ;
10. le JSON racine est un tableau, une primitive, `null` ou une forme spéciale ;
11. `signingInput` ne peut pas être conservé exactement comme `segment1.segment2` ;
12. la signature n’est pas un `Uint8Array` non vide ;
13. une valeur a été convertie, normalisée, remplacée ou une exception interne n’a pas été capturée.

Sinon retourner `{ protectedHeader, payload, signingInput, signature }` avec `signature instanceof Uint8Array`.

### Exemples normatifs

| Cas | Résultat |
|---|---|
| JWT compact exact à trois segments Base64URL canoniques, objets JSON ordinaires | `{ protectedHeader, payload, signingInput, signature: Uint8Array }` |
| entrée non-string | `null` |
| string vide | `null` |
| longueur > 4096 | `null` |
| deux segments seulement | `null` |
| quatre segments | `null` |
| segment vide | `null` |
| caractère `+` ou `/` dans un segment | `null` |
| padding `=` dans un segment | `null` |
| `segment.length % 4 === 1` | `null` |
| décodage permissif possible mais réencodage ≠ segment | `null` |
| espace ou Unicode dans un segment | `null` |
| UTF-8 invalide après décodage | `null` |
| JSON racine tableau ou primitive | `null` |
| clés JSON dupliquées à la racine | `null` |
| clés JSON dupliquées dans un objet imbriqué | `null` |
| clé `__proto__`, `prototype` ou `constructor` (racine ou imbriquée) | `null` |
| signature Base64URL décodant vers zéro octet | `null` |

Tout résultat non-`null` reste uniquement structurel : ni authentification ni autorisation.

### Non-régression

Conservées sans élargissement :

- politiques JWT V2.1l à V2.1p ;
- RS256 comme algorithme d’accès obligatoire au niveau politique (non vérifié ici) ;
- aucun rôle, tenant, droit ou permission dans le JWT ;
- matrice 48/102 inchangée ;
- clés privées hors dépôt ;
- aucun JWT complet dans les logs, URLs ou réponses.

### Hors périmètre de V2.1q

- bibliothèque JWT ;
- vérification RS256 ou toute cryptographie ;
- clé publique, privée, JWKS, secret ou résolution de `kid` ;
- appel à `isJwtClaimsPolicySatisfied` ;
- middleware, route, login, refresh, session ou horloge ;
- changement du legacy, du schéma, des données ou de la matrice 48/102 ;
- implémentation runtime (réservée à V2.1r après GO CTO sur ce contrat).

## 43. Gate de merge V2.1q

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [x] export documentaire `decodeJwtCompactStrict(compactToken)` défini ;
- [x] entrée string ≤ 4096 et forme exacte à trois segments documentées ;
- [x] alphabet Base64URL canonique sans `+`, `/`, `=` documenté ;
- [x] canonicalité Base64URL (`length % 4 !== 1`, décodage strict, réencodage sans padding, égalité exacte) documentée ;
- [x] UTF-8 strict sans remplacement `U+FFFD` documenté ;
- [x] objets JSON ordinaires et refus des clés dupliquées à tous les niveaux documentés ;
- [x] clés dangereuses exactes `__proto__`, `prototype`, `constructor` documentées à tous les niveaux ;
- [x] `signingInput` byte-for-byte `segment1.segment2` documenté ;
- [x] `signature: Uint8Array` non vide sans vérification cryptographique documentée ;
- [x] résultat structurel uniquement — jamais authentification ni autorisation ;
- [x] aucune bibliothèque ou implémentation JWT introduite ;
- [x] aucun secret, aucune clé et aucun JWT introduit ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 44. Périmètre exact de V2.1r

Lot d’implémentation **pure** dans `@somafrik/api-v2` du contrat de décodage V2.1q.

### Export public exact

- fichier : `apps/api/src/jwt-compact-decoder.js` ;
- export unique ajouté : `decodeJwtCompactStrict(compactToken)` ;
- réexport depuis `apps/api/src/index.js` ;
- les exports existants restent inchangés.

### Contrat d’exécution

- entrée primitive `string`, longueur **1..4096** ;
- exactement trois segments non vides ;
- alphabet Base64URL strict sans `+`, `/` ou `=` ;
- canonicalité sur chaque segment : `length % 4 !== 1`, décodage strict, réencodage sans padding, égalité exacte ;
- UTF-8 fatal (`TextDecoder` fatal) pour header et payload — aucun remplacement `U+FFFD` ;
- parse JSON sécurisé détectant les doublons **avant** création des objets, à tous les niveaux ;
- clés `__proto__`, `prototype`, `constructor` refusées à tous les niveaux ;
- racines header/payload = objets ordinaires uniquement ;
- `signingInput` repris exactement depuis les deux segments initiaux ;
- `signature` retournée comme `Uint8Array` exacte non vide (jamais `Buffer`, texte ou tableau) ;
- résultat non-`null` = **STRUCTURALLY_DECODED** uniquement ; toute anomalie → `null` sans exception sortante ;
- aucune mutation des objets retournés après leur création ;
- **aucun** appel à `isJwtClaimsPolicySatisfied`, aucune cryptographie, aucune résolution de `kid`.

### Hors périmètre de V2.1r

- vérification ou signature RS256 ; bibliothèque JWT ;
- clé, JWKS, secret ou résolution de `kid` ;
- authentification, autorisation ou session ;
- middleware, route, login, refresh ou logout ;
- horloge, environnement, legacy, schéma ou données ;
- modification de la matrice 48/102.

## 45. Gate de merge V2.1r

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] export public limité à `decodeJwtCompactStrict` ;
- [x] entrée string 1..4096 et forme exacte à trois segments appliquées ;
- [x] canonicalité Base64URL appliquée sur chaque segment ;
- [x] UTF-8 fatal sans remplacement `U+FFFD` ;
- [x] doublons et clés dangereuses refusés à tous les niveaux ;
- [x] `signingInput` byte-for-byte et `signature: Uint8Array` non vide ;
- [x] aucun throw vers l’appelant ;
- [x] aucune vérification cryptographique ni appel à `isJwtClaimsPolicySatisfied` ;
- [x] aucune dépendance ajoutée ;
- [x] tests normatifs et cas limites verts ;
- [x] non-régression API/auth/domaine ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 46. Périmètre exact de V2.1s

Lot **documentation uniquement**. Aucune bibliothèque JWT, aucune vérification runtime, aucun import PEM/JWK/JWKS, aucune clé, aucun secret, aucun middleware, aucune route et aucun changement de runtime, schéma ou donnée.

Objectif : contractualiser la **vérification cryptographique RS256 pure** d’une signature JWT, avec clé publique **explicitement injectée**. La résolution réelle de `kid` reste séparée (lot ultérieur).

### Export documentaire exact

Future fonction pure asynchrone :

```text
verifyJwtRs256Signature(signingInput, signature, verificationKey)
```

Retour exact :

```text
Promise<boolean>
```

- `true` signifie uniquement **SIGNATURE_VALID** ;
- toute anomalie, clé incompatible ou erreur cryptographique → `false` ;
- **aucune exception sortante** vers l’appelant.

`true` ne signifie jamais : JWT authentique, claims valides, session valide, identité active, permission accordée ou accès autorisé.

### Entrée — `signingInput`

- type exact `string` ;
- non vide ;
- longueur maximale **4094** caractères ;
- exactement **deux** segments Base64URL canoniques séparés par **un** point : `segment1.segment2` ;
- fourni explicitement ;
- aucun trim, encodage, normalisation ou remplacement ;
- conversion en octets uniquement via `new TextEncoder().encode(signingInput)` pour `SubtleCrypto.verify`.

Doivent notamment être refusés : `null`, `undefined`, non-string, string vide, longueur > 4094, moins/plus de deux segments, segments vides, alphabet non Base64URL, formes non canoniques, objets hostiles.

### Entrée — `signature`

- instance exacte de `Uint8Array` ;
- non vide (`byteLength >= 1`) ;
- aucune mutation de l’entrée.

Doivent être refusés : `Buffer` (même s’il étend `Uint8Array` — l’API publique exige `Uint8Array` exacte via `constructor === Uint8Array` / non-`Buffer`), texte, Base64URL, tableau de nombres, `ArrayBuffer` nu, `DataView`, valeurs absentes ou hostiles.

### Entrée — `verificationKey`

`CryptoKey` publique **explicitement injectée**. Contraintes cumulatives :

- `type === "public"` ;
- usage `verify` obligatoire ;
- algorithme exact `RSASSA-PKCS1-v1_5` ;
- hash exact `SHA-256` ;
- exposant public exact **65537** ;
- modulus autorisé : **2048**, **3072** ou **4096** bits uniquement.

Doivent être refusés : clé privée ; HMAC ; RSA-PSS ; ECDSA ; clé ambiguë ; modulus 1024 ou autre taille ; hash ≠ SHA-256 ; usage sans `verify` ; clé absente, non-`CryptoKey` ou hostile.

Aucune clé n’est importée, résolue ou stockée dans V2.1s. Aucune résolution de `kid`.

### Vérification imposée

Le futur vérificateur doit appeler exactement :

```text
crypto.subtle.verify(
  { name: "RSASSA-PKCS1-v1_5" },
  verificationKey,
  signature,
  new TextEncoder().encode(signingInput)
)
```

Aucun algorithme ne doit être choisi depuis une entrée utilisateur, depuis le header JWT, depuis `kid` ou depuis une configuration implicite. L’algorithme est **fixé** dans le contrat.

Toute rejet, exception ou promesse rejetée de `subtle.verify` → `false` (capturée, jamais propagée).

### Algorithme décisionnel documentaire

Retourner `false` (via `Promise`) si **au moins une** condition suivante est vraie :

1. `signingInput` n’est pas une string non vide ≤ 4094 avec exactement deux segments Base64URL canoniques ;
2. `signature` n’est pas un `Uint8Array` exact non vide ;
3. `verificationKey` n’est pas une `CryptoKey` publique compatible (type, usages, RSASSA-PKCS1-v1_5, SHA-256, exposant 65537, modulus 2048/3072/4096) ;
4. `crypto.subtle.verify(...)` retourne `false` ou échoue ;
5. une entrée a été mutée, convertie, normalisée ou une exception n’a pas été capturée.

Sinon retourner `true` (**SIGNATURE_VALID** uniquement).

### Tests normatifs futurs (lot d’implémentation)

Couvrir au minimum :

- signature RS256 valide → `true` ;
- signature altérée → `false` ;
- `signingInput` altéré → `false` ;
- mauvaise clé publique → `false` ;
- clé privée ou sans usage `verify` → `false` ;
- clés RSA-PSS, ECDSA et HMAC → `false` ;
- SHA autre que SHA-256 → `false` ;
- modulus 1024 refusé → `false` ;
- signatures vides, `Buffer`, string ou tableau refusés → `false` ;
- valeurs absentes, primitives incorrectes et objets hostiles → `false` ;
- aucune exception sortante ;
- aucune mutation des entrées ;
- clés générées **uniquement pendant les tests**, jamais versionnées dans le dépôt.

### Non-régression

Conservées sans élargissement :

- politiques et implémentations JWT V2.1l à V2.1r ;
- RS256 comme algorithme d’accès obligatoire ;
- séparation décodage (V2.1q/r) / claims (V2.1o/p) / temporel (V2.1m/n) / crypto (V2.1s) / résolution `kid` (ultérieure) ;
- aucun rôle, tenant, droit ou permission dans le JWT ;
- matrice 48/102 inchangée ;
- clés privées hors dépôt ;
- aucun JWT complet dans les logs, URLs ou réponses.

### Hors périmètre de V2.1s

- import PEM / JWK / JWKS ;
- résolution, rotation ou stockage réel de `kid` ;
- clé privée, signature de jetons ou secret ;
- décodage JWT ; appel à `decodeJwtCompactStrict` ou `isJwtClaimsPolicySatisfied` ;
- pipeline complet d’authentification ;
- session, middleware, routes, login, refresh ou logout ;
- environnement, KMS, réseau, legacy, schéma ou données ;
- matrice 48/102 ;
- implémentation runtime (réservée à un lot ultérieur après GO CTO sur ce contrat).

## 47. Gate de merge V2.1s

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [x] export documentaire `verifyJwtRs256Signature(signingInput, signature, verificationKey)` défini ;
- [x] retour exact `Promise<boolean>` et sémantique `SIGNATURE_VALID` documentés ;
- [x] contraintes strictes de `signingInput`, `signature` et `verificationKey` documentées ;
- [x] appel imposé à `crypto.subtle.verify` avec `RSASSA-PKCS1-v1_5` documenté ;
- [x] modulus 2048/3072/4096, exposant 65537 et hash SHA-256 documentés ;
- [x] aucune résolution de `kid` ni import PEM/JWK/JWKS introduits ;
- [x] aucune bibliothèque ou implémentation JWT runtime introduite ;
- [x] aucun secret, aucune clé privée et aucun JWT introduit ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 48. Périmètre exact de V2.1t

Lot d’implémentation **pure** dans `@somafrik/api-v2` du contrat de vérification RS256 V2.1s.

### Export public exact

- fichier : `apps/api/src/jwt-rs256-verifier.js` ;
- export unique ajouté : `verifyJwtRs256Signature(signingInput, signature, verificationKey)` ;
- réexport depuis `apps/api/src/index.js` ;
- les exports existants restent inchangés.

### Contrat d’exécution

- retour `Promise<boolean>` ; `true` = **SIGNATURE_VALID** uniquement ; anomalies → `false` ; **aucune** exception ni promesse rejetée vers l’appelant ;
- `signingInput` : string 1..4094, exactement deux segments Base64URL canoniques (bits résiduels inclus) ;
- `signature` : `constructor === Uint8Array`, `byteLength >= 1` ; `Buffer`/texte/tableaux/`ArrayBuffer`/`DataView` refusés ; aucune mutation ;
- `verificationKey` : `CryptoKey` publique, usage `verify`, `RSASSA-PKCS1-v1_5`, hash `SHA-256`, exposant 65537, modulus 2048/3072/4096 ;
- appel unique : `await globalThis.crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, verificationKey, signature, new TextEncoder().encode(signingInput))` ;
- l’algorithme n’est jamais lu depuis le JWT ni depuis une entrée externe ;
- **aucun** import PEM/JWK/JWKS, aucune résolution de `kid`, aucun appel à `decodeJwtCompactStrict` ou `isJwtClaimsPolicySatisfied`.

### Hors périmètre de V2.1t

- import PEM, JWK ou JWKS ; résolution, rotation, stockage ou cache de `kid` ;
- clé privée ou signature de JWT ;
- pipeline complet JWT ; session, identité, middleware, routes, login, refresh ou logout ;
- réseau, KMS, environnement, legacy, schéma ou données ; matrice 48/102.

## 49. Gate de merge V2.1t

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] export public limité à `verifyJwtRs256Signature` ;
- [x] validation stricte de `signingInput`, `signature` et `verificationKey` ;
- [x] modulus 2048/3072/4096 acceptés ; 1024 et exposants ≠ 65537 refusés ;
- [x] RSA-PSS, ECDSA, HMAC, SHA ≠ SHA-256 et clés privées refusés ;
- [x] appel unique à `crypto.subtle.verify` avec algorithme fixe ;
- [x] aucune exception ni promesse rejetée vers l’appelant ;
- [x] aucune mutation des entrées ;
- [x] aucune résolution de `kid` ni import PEM/JWK/JWKS ;
- [x] aucune dépendance ajoutée ;
- [x] clés de test éphémères uniquement, jamais versionnées ;
- [x] tests normatifs et cas limites verts ;
- [x] non-régression API/auth/domaine ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 50. Périmètre exact de V2.1u

Lot **documentation uniquement**. Aucune implémentation runtime, aucun PEM/JWK/JWKS, aucun réseau, aucun cache, aucune clé réelle ou privée, aucune cryptographie, aucun middleware et aucun changement de runtime, schéma ou donnée.

Objectif : contractualiser la **résolution stricte de `kid`** vers une unique `CryptoKey` publique active compatible RS256, **après le décodage strict et avant la vérification cryptographique RS256**. C’est la dernière brique JWT explicitement différée avant l’implémentation pure **V2.1v**.

### Place dans le pipeline JWT d’accès

Ordre obligatoire du futur pipeline :

```text
décodage strict
  → validation structurelle / temporelle
  → résolution de kid
  → vérification RS256
  → validation de session
  → autorisation
```

La clé issue de `resolveJwtRs256VerificationKey` est **nécessaire avant** `verifyJwtRs256Signature`. Toute formulation plaçant la résolution de `kid` après la vérification cryptographique est incorrecte.

### Export documentaire exact

Future fonction pure :

```text
resolveJwtRs256VerificationKey(kid, keyCandidates)
```

Retour exact :

```text
CryptoKey | null
```

- retour non-`null` = **KEY_RESOLVED** uniquement (clé publique active unique compatible) ;
- toute anomalie → `null` ;
- **aucune exception sortante**.

Le succès ne signifie jamais : JWT authentique, signature déjà vérifiée dans ce lot, claims valides, session valide, permission accordée ou accès autorisé.

### Forme exacte d’un candidat

Chaque élément de `keyCandidates` devra exposer **exactement** les trois propriétés propres suivantes :

```text
{
  kid,              // string — identifiant de clé
  status,           // string — état de cycle de vie
  verificationKey   // CryptoKey publique
}
```

Aucune propriété supplémentaire n’est autorisée. Toute forme absente, hostile, héritée, à accesseurs, à symboles ou non ordinaires → `null`.

### Contrat de `kid` (non-régression V2.1o)

`kid` doit respecter intégralement le contrat V2.1o :

- type exact `string` ;
- non vide ;
- longueur **1 à 128** caractères ASCII ;
- charset uniquement : `A-Z a-z 0-9 . _ : -` ;
- fourni explicitement ;
- comparaison exacte par `===` ;
- **aucune** normalisation, trim, changement de casse, coercition ou fallback.

### Entrée — `keyCandidates`

- injecté **explicitement** au futur résolveur ;
- structure déterministe (tableau ordinaire de candidats conformes) ;
- aucune lecture d’environnement, KMS, fichier, réseau ou JWKS ;
- aucune mutation des entrées.

### Règles cumulatives de résolution

Retourner la `verificationKey` uniquement si **toutes** les conditions suivantes sont satisfaites :

1. `kid` est valide au sens V2.1o ;
2. `keyCandidates` est une structure admissible injectée explicitement ;
3. **exactement un** candidat possède `candidate.kid === kid` (comparaison stricte) ;
4. ce candidat a `status === "active"` ;
5. `verificationKey` est une `CryptoKey` publique compatible RS256 / SHA-256 (mêmes contraintes de compatibilité que V2.1s/V2.1t : usage `verify`, `RSASSA-PKCS1-v1_5`, hash SHA-256, exposant 65537, modulus 2048/3072/4096) ;
6. aucune ambiguïté, duplication ou conflit de `kid` dans l’ensemble fourni.

Sinon retourner `null`.

### Rotation et unicité

- un `kid` **ne peut jamais être réutilisé** lors d’une rotation ;
- zéro correspondance → `null` ;
- plusieurs correspondances pour le même `kid` → `null` (ambiguïté fail-closed) ;
- candidat présent mais `status !== "active"` (retiré, inactif, inconnu, etc.) → `null` ;
- clé incompatible ou privée → `null`.

### Algorithme décisionnel documentaire

Retourner `null` si **au moins une** condition suivante est vraie :

1. `kid` invalide ou non-string ;
2. `keyCandidates` absent, non admissible ou hostile ;
3. aucun candidat avec `kid` exact ;
4. plus d’un candidat avec le même `kid` exact ;
5. le candidat unique n’a pas `status === "active"` ;
6. `verificationKey` absente, non-`CryptoKey`, privée ou incompatible RS256/SHA-256 ;
7. une valeur a été normalisée, coercée, mutée ou une exception n’a pas été capturée.

Sinon retourner la `CryptoKey` du candidat unique actif.

### Exemples normatifs

| Cas | Résultat |
|---|---|
| un seul candidat `kid` exact, `status === "active"`, clé RS256 compatible | `CryptoKey` |
| `kid` vide, avec espace ou hors charset V2.1o | `null` |
| aucun candidat correspondant | `null` |
| deux candidats avec le même `kid` | `null` |
| candidat correspondant mais `status !== "active"` | `null` |
| clé privée ou incompatible | `null` |
| `keyCandidates` hostile ou non injecté | `null` |

### Annonce V2.1v

Le lot **V2.1v** implémentera de façon pure `resolveJwtRs256VerificationKey` conformément à ce contrat, sans import PEM/JWK/JWKS, sans réseau et sans résolution implicite.

### Non-régression

Conservées sans élargissement :

- politiques et implémentations JWT V2.1l à V2.1t ;
- format `kid` V2.1o ;
- séparation décodage / claims / temporel / résolution `kid` / crypto ;
- pipeline d’accès : décodage → validation structurelle/temporelle → résolution de `kid` → vérification RS256 → session → autorisation ;
- aucun rôle, tenant, droit ou permission dans le JWT ;
- matrice 48/102 inchangée ;
- clés privées hors dépôt ;
- aucun JWT complet dans les logs, URLs ou réponses.

### Hors périmètre de V2.1u

- implémentation runtime (réservée à **V2.1v**) ;
- PEM, JWK ou JWKS ; appel réseau ou endpoint JWKS ;
- cache, KMS ou variable d’environnement ;
- clé réelle ou privée versionnée ;
- signature ou vérification cryptographique ;
- pipeline JWT, middleware, session ou route ;
- dépendance ajoutée ; matrice 48/102.

## 51. Gate de merge V2.1u

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [x] export documentaire `resolveJwtRs256VerificationKey(kid, keyCandidates)` défini ;
- [x] retour exact `CryptoKey | null` et sémantique `KEY_RESOLVED` documentés ;
- [x] forme exacte des candidats `{ kid, status, verificationKey }` documentée ;
- [x] contrat `kid` V2.1o et comparaison `===` sans normalisation documentés ;
- [x] unicité, `status === "active"` et non-réutilisation de `kid` documentées ;
- [x] compatibilité RS256/SHA-256 de la clé résolue documentée ;
- [x] V2.1v annoncé comme lot d’implémentation pure ;
- [x] aucune implémentation runtime, PEM/JWK/JWKS, réseau ou clé introduits ;
- [x] aucun secret et aucune dépendance ajoutés ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 52. Périmètre exact de V2.1v

Lot d’implémentation **pure** dans `@somafrik/api-v2` du contrat de résolution de `kid` V2.1u.

### Export public exact

- fichier : `apps/api/src/jwt-kid-resolver.js` ;
- export unique ajouté : `resolveJwtRs256VerificationKey(kid, keyCandidates)` ;
- réexport depuis `apps/api/src/index.js` ;
- les exports existants (`authorizationDecisionToHttpStatus`, `extractBearerCredential`, `decodeJwtCompactStrict`, `isJwtClaimsPolicySatisfied`, `isJwtTemporalPolicySatisfied`, `verifyJwtRs256Signature`) restent inchangés.

### Contrat d’exécution

- retour exact : `CryptoKey | null` ; non-`null` = **KEY_RESOLVED** uniquement — jamais signature valide, JWT authentique, claims valides, session valide, identité authentifiée, permission accordée ou accès autorisé ;
- `kid` string ASCII 1–128 (`^[A-Za-z0-9._:-]{1,128}$`) ; comparaison stricte `candidate.kid === kid` ; aucune normalisation, trim, coercition ou changement de casse ;
- `keyCandidates` : `Array` ordinaire (`Array.prototype`), sans trous, sans symboles, sans propriétés supplémentaires, sans accesseurs, sans Proxy hostile ; **taille maximale 256** ;
- chaque candidat : objet ordinaire (`Object.prototype` ou prototype `null`) avec exactement `{ kid, status, verificationKey }` en propriétés propres de données ;
- **tous** les candidats doivent être structurellement valides ; un candidat malformé (correspondant ou non) → `null` ;
- **tout Proxy** (transparent ou hostile) sur `keyCandidates`, un candidat ou `verificationKey` → `null` (détection via `types.isProxy` de `node:util`) ;
- résolution uniquement si exactement un `kid` exact, `status === "active"`, et `verificationKey` publique compatible RS256/SHA-256 (usage `verify`, `RSASSA-PKCS1-v1_5`, hash SHA-256, exposant 65537, modulus 2048/3072/4096) ;
- zéro ou plusieurs correspondances, statut inactif/inconnu, clé privée ou incompatible → `null` ;
- **aucune** cryptographie exécutée (`crypto.subtle.verify` non appelé) ; aucun import PEM/JWK/JWKS ; aucun réseau, fichier, KMS, cache, variable d’environnement ou clé versionnée ;
- **aucun throw** vers l’appelant ; aucune mutation des entrées.

### Place dans le pipeline JWT d’accès

```text
décodage strict
  → validation structurelle / temporelle
  → résolution de kid
  → vérification RS256
  → validation de session
  → autorisation
```

### Hors périmètre de V2.1v

- import PEM/JWK/JWKS ; endpoint JWKS ; cache ; KMS ; secrets ; clés réelles ou privées versionnées ;
- appel à `verifyJwtRs256Signature` ou `crypto.subtle.verify` ; décodage JWT ; middleware ; routes ; session ;
- modification de `packages/auth` ou de la matrice 48/102 ; dépendance ajoutée.

## 53. Gate de merge V2.1v

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] export public limité à `resolveJwtRs256VerificationKey` ;
- [x] retour exact `CryptoKey | null` et sémantique `KEY_RESOLVED` ;
- [x] unicité exacte de `kid` (zéro ou plusieurs correspondances → `null`) ;
- [x] refus des doublons, candidats invalides et entrées hostiles ;
- [x] limite explicite de 256 candidats ;
- [x] contraintes CryptoKey RS256/SHA-256 appliquées sans exécuter de cryptographie ;
- [x] aucun import PEM/JWK/JWKS, réseau, fichier, KMS ou cache ;
- [x] aucune horloge implicite, variable d’environnement ou journalisation ;
- [x] aucune dépendance, clé, secret ou PEM/JWK/JWKS ajoutés ;
- [x] tests normatifs et cas limites verts ;
- [x] non-régression API/auth/domaine ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 54. Périmètre exact de V2.1w

Lot **documentation uniquement**. Aucune implémentation runtime, aucun export réel, aucun test runtime, aucune dépendance, aucun middleware, aucune route, aucune session et aucun changement de runtime, schéma ou donnée.

Objectif : contractualiser l’**orchestrateur JWT d’accès pré-session** qui composera, sans réimplémentation, les quatre briques déjà livrées. L’implémentation pure est réservée au lot ultérieur **V2.1x**.

### Place dans le pipeline JWT d’accès

Ordre normatif :

```text
JWT compact
  → décodage strict
  → validation structurelle et temporelle
  → résolution de kid
  → vérification RS256
  → résultat pré-session
  → validation de session ultérieure
  → autorisation ultérieure
```

Il est **interdit** de vérifier RS256 avant la résolution de `kid`. La validation de session et l’autorisation restent **obligatoirement postérieures** et hors périmètre de V2.1w / V2.1x.

### Export documentaire exact

Future fonction pure :

```text
verifyJwtAccessTokenCryptographically(
  compactToken,
  expectedIssuer,
  evaluationTime,
  keyCandidates
)
```

Retour exact :

```text
Promise<
  | {
      sub: string,
      sid: string,
      jti: string
    }
  | null
>
```

- retour non-`null` = **TOKEN_CRYPTOGRAPHICALLY_ADMISSIBLE** uniquement ;
- toute anomalie → `null` ;
- **aucune exception** ni promesse rejetée sortante vers l’appelant.

Le succès ne signifie jamais : session existante ou active, identité active, utilisateur authentifié définitivement, permission accordée ou accès autorisé.

### Entrées explicitement injectées

Les quatre entrées sont injectées sans valeur par défaut :

- `compactToken` ;
- `expectedIssuer` ;
- `evaluationTime` ;
- `keyCandidates`.

Interdictions : lecture d’environnement, `Date.now()`, horloge implicite, chargement de clé, réseau, fichier, JWKS, KMS, cache, normalisation ou coercition. Les règles détaillées restent exclusivement celles des fonctions V2.1n, V2.1p, V2.1r, V2.1t et V2.1v.

### Ordre d’exécution obligatoire des quatre briques

Le futur orchestrateur devra respecter exactement :

1. appeler `decodeJwtCompactStrict(compactToken)` ;
2. continuer **uniquement** si le résultat est un objet conforme au contrat de sortie exact du décodeur (propriétés exactes `protectedHeader`, `payload`, `signingInput`, `signature`) ; tout autre résultat — y compris `null`, une valeur inattendue, un objet incomplet/hostile ou un throw capturé — → retourner `null` ;
3. appeler `isJwtClaimsPolicySatisfied(protectedHeader, payload, expectedIssuer, evaluationTime)` ;
4. continuer **uniquement** si `result === true` ; tout autre résultat — y compris `false`, une valeur inattendue/hostile (`"true"`, `1`, objet, etc.) ou un throw capturé — → retourner `null` ;
5. appeler `resolveJwtRs256VerificationKey(protectedHeader.kid, keyCandidates)` ;
6. continuer **uniquement** si le résultat est une `CryptoKey` conforme au contrat de sortie exact du résolveur ; tout autre résultat — y compris `null`, une valeur inattendue/hostile ou un throw capturé — → retourner `null` ;
7. appeler `verifyJwtRs256Signature(signingInput, signature, verificationKey)` ;
8. réussir **uniquement** si `result === true` ; tout autre résultat — y compris `false`, une valeur inattendue/hostile, un rejet de promesse capturé ou un throw capturé — → retourner `null` ;
9. retourner un **nouvel** objet contenant uniquement `{ sub, sid, jti }`.

#### Prédicats de succès exacts (obligatoires)

| Brique | Continuer / réussir uniquement si |
|---|---|
| `decodeJwtCompactStrict` | objet de sortie exact du contrat V2.1r (pas seulement « non-`null` ») |
| `isJwtClaimsPolicySatisfied` | `result === true` |
| `resolveJwtRs256VerificationKey` | `CryptoKey` exacte du contrat V2.1v (pas seulement « non-`null` ») |
| `verifyJwtRs256Signature` | `result === true` |

Toute valeur différente de ces prédicats constitue un **résultat inattendu d’une brique** et retourne `null` (aligné sur les tests normatifs V2.1x).

### Réutilisation obligatoire

Le futur orchestrateur devra appeler les exports existants. Interdictions : recopier Base64URL, reparcourir/parser le JSON, recopier les politiques claims/temporelles, revalider manuellement `CryptoKey`, refaire la résolution de `kid`, appeler directement `crypto.subtle.verify`, ou ajouter une deuxième implémentation d’une règle existante. Aucune modification des API ou comportements existants.

### Résultat de succès

Objet ordinaire **nouveau** contenant exactement :

- `sub`
- `sid`
- `jti`

Valeurs reprises **sans transformation** depuis le payload validé. Aucune propriété supplémentaire ; aucun header, signature, `signingInput`, `kid`, clé ou JWT retourné ; aucune référence directe au payload d’entrée ; aucun rôle, tenant, droit ou permission ; aucune mutation des objets décodés.

### Fail-closed et protection globale

Toute anomalie retourne `null` : JWT compact invalide, décodage refusé, header/claims/temps invalides, `kid` absent/ambigu/inactif/hostile, clé absente ou incompatible, signature invalide, brique qui lève ou rejette, entrée hostile, **résultat inattendu d’une brique** (toute valeur ne satisfaisant pas le prédicat de succès exact ci-dessus).

Le contrat impose un **bloc de protection global** autour de l’orchestration, tout en conservant les retours fail-closed propres aux briques existantes.

### Propriétés de sécurité

- aucun JWT complet dans les logs, erreurs, métriques, URLs ou réponses ;
- aucun `signingInput` ni signature journalisé ;
- aucune `CryptoKey` retournée ou journalisée ;
- aucune clé privée ; aucune comparaison de secret ;
- aucune mutation des entrées ; aucun fallback legacy ;
- aucune sélection d’algorithme dynamique ; RS256 reste imposé par les contrats existants ;
- complexité bornée par les limites déjà définies ;
- matrice 48/102 inchangée.

### Tests normatifs futurs (V2.1x)

#### Succès

- JWT RS256 valide, claims valides, `kid` unique actif → objet exact `{ sub, sid, jti }` ;
- preuve de l’ordre exact des quatre appels ;
- valeurs `sub`/`sid`/`jti` restituées sans normalisation ;
- preuve que les étapes 2, 4, 6 et 8 appliquent les prédicats exacts (`=== true` pour claims et RS256 ; contrat de sortie exact pour décodage et résolution).

#### Échec par étape

- `decodeJwtCompactStrict` retourne `null` ou tout résultat ne respectant pas son contrat de sortie exact ;
- `isJwtClaimsPolicySatisfied` retourne une valeur différente de `true` (y compris `false`, `"true"`, `1`) ;
- `resolveJwtRs256VerificationKey` retourne `null` ou tout résultat qui n’est pas une `CryptoKey` conforme ;
- `verifyJwtRs256Signature` retourne une valeur différente de `true` (y compris `false`, `"true"`, `1`) ;
- chacune des quatre briques lève ou rejette ;
- résultat inattendu ou hostile d’une brique (aligné sur les étapes 2, 4, 6 et 8).

#### Arrêt du pipeline

Prouver que :

- après échec du décodage, aucune autre brique n’est appelée ;
- après échec des claims, aucune résolution ni crypto n’est appelée ;
- après échec de `kid`, aucune crypto n’est appelée ;
- la vérification RS256 est toujours la dernière étape pré-session ;
- un résultat inattendu à une étape arrête immédiatement le pipeline.

#### Confidentialité

- le résultat ne contient que `sub`, `sid` et `jti` ;
- aucun token, header, payload complet, `kid`, signature, `signingInput` ou clé ;
- aucune journalisation ; aucune mutation.

#### Non-régression

- exports existants inchangés ;
- API/auth/domaine verts ;
- matrice 48/102 inchangée ;
- aucune dépendance ajoutée.

### Annonce V2.1x

Le lot **V2.1x** implémentera de façon pure `verifyJwtAccessTokenCryptographically` conformément à ce contrat, sans duplication des briques existantes, sans session et sans autorisation.

### Hors périmètre de V2.1w

- implémentation runtime (réservée à **V2.1x**) ;
- session repository ; vérification d’identité ; RBAC ou permission ;
- middleware, routes, logging ;
- PEM/JWK/JWKS, réseau, KMS, cache, secrets, clés ;
- dépendance ajoutée ; `Date.now()` ; variable d’environnement ;
- modification de runtime, schéma, donnée ou matrice 48/102.

## 55. Gate de merge V2.1w

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [x] future API et retour exacts documentés ;
- [x] sémantique `TOKEN_CRYPTOGRAPHICALLY_ADMISSIBLE` documentée ;
- [x] ordre décodage → claims/temps → kid → RS256 imposé ;
- [x] quatre exports existants réutilisés sans duplication ;
- [x] arrêt immédiat du pipeline après chaque échec ;
- [x] aucune exception ni promesse rejetée sortante ;
- [x] résultat limité exactement à `sub`, `sid` et `jti` ;
- [x] aucune session ou autorisation incluse ;
- [x] aucun token, signature, `signingInput` ou `CryptoKey` exposé ;
- [x] aucune horloge implicite ou configuration implicite ;
- [x] aucun PEM/JWK/JWKS, réseau, KMS, cache ou clé ajouté ;
- [x] aucune dépendance ajoutée ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de runtime, schéma ou donnée ;
- [x] V2.1x annoncé comme lot d’implémentation pure ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

## 56. Périmètre exact de V2.1x

Lot d’implémentation **pure** dans `@somafrik/api-v2` du contrat d’orchestration V2.1w.

### Export public exact

- fichier : `apps/api/src/jwt-access-pipeline.js` ;
- export unique ajouté : `verifyJwtAccessTokenCryptographically(compactToken, expectedIssuer, evaluationTime, keyCandidates)` ;
- réexport depuis `apps/api/src/index.js` ;
- les exports existants restent inchangés.

### Contrat d’exécution

- retour exact : `Promise<{ sub, sid, jti } | null>` ; non-`null` = **TOKEN_CRYPTOGRAPHICALLY_ADMISSIBLE** uniquement — jamais session, identité, permission ou accès ;
- ordre obligatoire : `decodeJwtCompactStrict` → `isJwtClaimsPolicySatisfied` → `resolveJwtRs256VerificationKey` → `verifyJwtRs256Signature` ;
- prédicats exacts : décodage = objet de sortie exact V2.1r ; claims = `=== true` ; kid = `CryptoKey` exacte V2.1v ; RS256 = `=== true` ;
- arrêt immédiat après chaque échec ; protection fail-closed globale ; aucune exception ni promesse rejetée sortante ;
- résultat = nouvel objet ordinaire limité à `sub`, `sid`, `jti` sans transformation ; aucun token, header, payload complet, `kid`, signature, `signingInput` ou `CryptoKey` exposé ;
- imports **statiques directs** depuis les quatre modules sources ; **aucun** seam/export de test ; **aucun** état global mutable de briques ;
- aucune duplication des briques ; aucune horloge/configuration implicite ; aucune cryptographie directe (`subtle.verify` hors brique V2.1t) ;
- aucune session, autorisation, PEM/JWK/JWKS, réseau, KMS, cache, secret ou dépendance ajoutée.

### Hors périmètre de V2.1x

- validation de session ; identité ; RBAC ; middleware ; routes ;
- duplication des briques existantes ; modification de leurs API ;
- seam ou export de test ; injection/remplacement des briques ;
- modification de `packages/auth` ou de la matrice 48/102.

## 57. Gate de merge V2.1x

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR en brouillon jusqu’à stabilisation du périmètre ;
- [x] diff limité aux quatre fichiers autorisés ;
- [x] export public limité à `verifyJwtAccessTokenCryptographically` ;
- [x] aucun export/seam de test et aucun état global mutable de briques ;
- [x] retour exact `Promise<{ sub, sid, jti } | null>` ;
- [x] sémantique `TOKEN_CRYPTOGRAPHICALLY_ADMISSIBLE` ;
- [x] ordre décodage → claims/temps → kid → RS256 respecté ;
- [x] quatre briques existantes réutilisées sans duplication ;
- [x] prédicats de succès exacts appliqués ;
- [x] arrêt immédiat après chaque échec ;
- [x] aucune exception ni promesse rejetée sortante ;
- [x] résultat limité exactement à `sub`, `sid` et `jti` ;
- [x] aucune session ou autorisation incluse ;
- [x] aucun token, signature, `signingInput`, `kid` ou `CryptoKey` exposé ;
- [x] aucune horloge ou configuration implicite ;
- [x] aucun PEM/JWK/JWKS, réseau, KMS, cache ou clé ajouté ;
- [x] aucune dépendance ajoutée ;
- [x] tests API/auth/domaine verts ;
- [x] matrice 48/102 inchangée ;
- [x] aucune modification de schéma, migration ou donnée ;
- [x] aucun conflit non résolu avec `develop` ;
- [x] décision CTO explicite avant passage Ready puis merge.

### Clôture documentaire V2.1x

- PR fusionnée : **#147** ;
- head validé : `d84ad4209e30cab189db3cde79c990dde7c07662` ;
- merge commit : `3bdb5c306a22b912c4f264e2e97d7e52301d4f5e`.

## 58. Périmètre exact de V2.1y

Lot **documentation uniquement**. Aucune implémentation runtime, aucun export public, aucun test runtime, aucun repository, aucune migration, aucun schéma et aucun changement de donnée.

Objectif : contractualiser la validation **post-cryptographique** qui lie le résultat `TOKEN_CRYPTOGRAPHICALLY_ADMISSIBLE` produit par V2.1x à une session d’authentification V2 exacte.

### Export documentaire exact

Future fonction pure :

```text
validateJwtBoundAuthSession(
  cryptographicallyAdmissibleToken,
  authSession,
  sessionEvaluationTime
)
```

Retour futur exact :

```text
Promise<{
  sub,
  sid,
  jti,
  principal
} | null>
```

Signature normative unique : **`Promise<… | null>`**, cohérente avec `verifyJwtAccessTokenCryptographically`. Les briques session actuelles (`createAuthSession`, `isAuthSessionActive`) sont **synchrones** ; une future implémentation pourra donc résoudre immédiatement sans I/O tant qu’aucun repository n’est injecté, tout en conservant cette signature asynchrone normative. **Aucun export** n’est ajouté par V2.1y.

- retour non-`null` = **JWT_BOUND_ACTIVE_SESSION** uniquement ;
- toute anomalie → `null` (ou décision `UNAUTHENTICATED` d’un orchestrateur supérieur ultérieur) ;
- **aucune exception** ni promesse rejetée sortante.

Le succès ne signifie jamais : permission accordée, accès autorisé, réponse HTTP 200, identité obtenue par recherche implicite, session créée/prolongée/renouvelée, refresh token accepté, ni absence globale de rejeu au-delà du contrat documenté. L’**autorisation** reste une étape **ultérieure**.

### Entrée — `cryptographicallyAdmissibleToken`

Doit correspondre exactement à la sortie de `verifyJwtAccessTokenCryptographically` :

```text
{
  sub: string,
  sid: string,
  jti: string
}
```

Exiger : objet ordinaire admissible ; exactement trois propriétés propres de données ; aucun symbole, accesseur, champ supplémentaire, coercition, normalisation ou mutation. **Ne pas** redécoder le JWT ; **ne pas** répéter les politiques claims/temps/`kid`/RS256.

### Entrée — `authSession`

Doit être conforme au modèle canonique produit par `createAuthSession`. L’état actif s’évalue exclusivement via :

```text
isAuthSessionActive(authSession, sessionEvaluationTime) === true
```

Toute autre valeur que `true` → échec fail-closed. **Ne pas** recopier : validation d’identité, de principal, dates de session, révocation, matrice rôle/tenant ou permissions.

### Temps explicite — `sessionEvaluationTime`

Fourni explicitement au format ISO UTC canonique déjà exigé par `isAuthSessionActive`.

Interdictions : `Date.now()`, horloge implicite, valeur par défaut, variable d’environnement, normalisation silencieuse.

Distinction documentaire obligatoire :

- V2.1x évalue les claims JWT avec un **NumericDate** ;
- les sessions utilisent un **timestamp ISO UTC canonique** ;
- dans un futur orchestrateur supérieur, les deux représentations doivent désigner le **même instant** d’évaluation ;
- aucune utilisation silencieuse de deux instants indépendants ;
- toute conversion future doit être explicite, déterministe, testée et sans arrondi ambigu.

V2.1y n’ajoute **aucune** conversion runtime.

### Liaisons obligatoires

Le succès futur exige exactement :

1. `cryptographicallyAdmissibleToken` conforme ;
2. `authSession` conforme à `createAuthSession` ;
3. `isAuthSessionActive(authSession, sessionEvaluationTime) === true` ;
4. `cryptographicallyAdmissibleToken.sid === authSession.sessionId` ;
5. `cryptographicallyAdmissibleToken.sub === authSession.identity.userId` ;
6. `authSession.principal.userId === authSession.identity.userId` ;
7. liaison explicite et fail-closed de `jti` selon la décision CTO ci-dessous.

Interdictions : coercition, normalisation, comparaison insensible à la casse, fallback legacy, identité construite depuis les claims JWT, autorisation exécutée dans cette fonction.

### Décision CTO concernant `jti`

**Constat :** le modèle `AuthSession` actuel ne contient **aucune** représentation canonique de `jti`.

Interdit : ignorer silencieusement `jti` ; prétendre qu’il est déjà lié à la session ; utiliser `sid` comme substitut ; ajouter `jti` au modèle runtime dans ce lot ; inventer une persistance/cache/mécanisme de rejeu ; autoriser le succès tant que la liaison canonique n’est pas définie.

**Décision normative :** `jti` est l’identifiant unique du JWT d’accès. Une future implémentation ne pourra retourner `JWT_BOUND_ACTIVE_SESSION` que si le `jti` présenté est lié explicitement :

- soit à l’état canonique de la session ;
- soit à un enregistrement canonique de jeton rattaché à la session,

selon un contrat ultérieur approuvé par le CTO.

Tant que cette représentation canonique et son cycle de vie ne sont pas contractualisés, l’implémentation complète JWT ↔ session reste **bloquée fail-closed**.

### Annonce V2.1z

Prochain lot minimal : **V2.1z — contrat du cycle de vie de `jti` et prévention du rejeu**. V2.1y ne doit ni implémenter ni détailler prématurément son stockage.

### Principal retourné

Le `principal` retourné doit être **exclusivement** celui de la session validée.

Interdit : construire le principal depuis `sub` ou d’autres claims JWT ; fusionner le payload JWT avec le principal ; ajouter rôle/tenant/permissions depuis le JWT ; retourner la session complète.

Résultat de succès exact :

```text
{
  sub,
  sid,
  jti,
  principal
}
```

`sub` / `sid` / `jti` repris sans transformation depuis le résultat V2.1x validé ; `principal` repris depuis la session validée, sans enrichissement implicite.

### Ordre normatif complet

```text
Bearer credential
  → décodage JWT strict
  → validation des claims et du temps JWT
  → résolution kid
  → vérification RS256
  → TOKEN_CRYPTOGRAPHICALLY_ADMISSIBLE
  → résolution explicite de session par sid
  → validation exacte et temporelle de la session
  → liaison sid / sub / jti
  → JWT_BOUND_ACTIVE_SESSION
  → décision d’autorisation par permission
  → mapping HTTP 200 / 401 / 403
```

Confirmations :

- aucune session consultée avant l’admissibilité cryptographique ;
- aucune autorisation avant la liaison complète de session ;
- session absente, hostile, expirée ou révoquée = échec d’authentification ;
- divergence `sid`, `sub` ou `jti` = échec d’authentification ;
- aucune information sensible exposée à l’appelant.

### Frontière du futur repository

V2.1y ne crée **aucun** repository. Le futur accès à la session devra être : injecté explicitement ; borné par `sid` ; postérieur à RS256 ; sans environnement implicite ; sans accès legacy ; fail-closed sur zéro/plusieurs résultats, résultat hostile, throw ou promesse rejetée. La forme exacte du port de résolution sera contractualisée avant son implémentation. Aucun réseau, cache, KMS ou accès base n’est ajouté par V2.1y.

### Fail-closed et confidentialité

Toute anomalie → `null` (ou `UNAUTHENTICATED` d’un orchestrateur supérieur). Aucune exception ni promesse rejetée sortante.

Ne jamais exposer : JWT compact, header/payload complets, signature, `signingInput`, `kid`, `CryptoKey`, clé/secret, session complète, résultat brut du repository, détails internes de révocation.

Résultat validé limité à : `sub`, `sid`, `jti`, `principal`.

### Hors périmètre de V2.1y

- JavaScript runtime ; nouvel export ; test runtime ; repository de sessions ;
- PostgreSQL ; migration ; schéma ; donnée ; ajout de `jti` au modèle de session ;
- route/middleware ; login/refresh/logout ; création ou renouvellement de session ;
- implémentation de révocation ; nouvelle permission/RBAC ; nouveau mapping HTTP ;
- clé, secret, PEM/JWK/JWKS ; réseau, KMS, cache ; dépendance ; variable d’environnement ; `Date.now()` ;
- modification legacy ; modification de la matrice 48/102.

## 59. Gate de merge V2.1y

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR conservée Draft jusqu’à stabilisation ;
- [x] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [x] V2.1x correctement clôturé ;
- [x] future API `validateJwtBoundAuthSession` contractualisée ;
- [x] aucun export runtime ajouté ;
- [x] sémantique `JWT_BOUND_ACTIVE_SESSION` documentée ;
- [x] liaison exacte `sid` ↔ `sessionId` documentée ;
- [x] liaison exacte `sub` ↔ `identity.userId` documentée ;
- [x] cohérence `principal.userId` ↔ `identity.userId` documentée ;
- [x] principal exclusivement issu de la session validée ;
- [x] absence actuelle de représentation canonique de `jti` reconnue ;
- [x] implémentation bloquée fail-closed tant que `jti` n’est pas contractualisé ;
- [x] temps JWT et session explicitement distingués ;
- [x] même instant exigé dans le futur orchestrateur supérieur ;
- [x] résolution de session strictement postérieure à RS256 ;
- [x] autorisation strictement postérieure à la liaison de session ;
- [x] aucun runtime, test, repository, schéma ou donnée ajouté ;
- [x] aucune dépendance, clé ou secret ajouté ;
- [x] matrice 48/102 inchangée ;
- [x] V2.1 global conservé non terminé ;
- [x] aucun conflit avec `develop` ;
- [x] décision CTO explicite avant Ready puis merge.

### Clôture documentaire V2.1y

- PR fusionnée : **#148** ;
- head validé : `9536cde99d524a99ac00d4db593b7fd297169410` ;
- merge commit : `d4dac09795f4c14a3f09b76fbf60e53ba2e50e46`.

V2.1y avait explicitement **bloqué** la signature complète de `validateJwtBoundAuthSession` jusqu’au contrat canonique de `jti`. V2.1z lève ce blocage documentaire sans réécrire le reste du contrat V2.1y.

## 60. Périmètre exact de V2.1z

Lot **documentation uniquement**. Aucune implémentation runtime, aucun export, aucun test runtime, aucun repository, aucun schéma et aucun accès aux données.

Objectif : définir la représentation canonique et le cycle de vie du `jti` nécessaires pour lever le blocage fail-closed consigné par V2.1y.

### Décision d’architecture — `AuthSessionAccessToken`

Enregistrement canonique **distinct** de `AuthSession` :

```text
AuthSessionAccessToken
{
  sessionId: string,
  jti: string,
  status: "active" | "revoked",
  issuedAt: string,
  expiresAt: string,
  revokedAt: string | null
}
```

Décisions obligatoires :

- `jti` identifie un JWT d’accès unique ;
- `AuthSession` reste le modèle canonique de session ;
- `AuthSessionAccessToken` représente l’état serveur du JWT lié à la session ;
- `sid` ne remplace jamais `jti` ;
- le payload JWT n’est jamais la source de vérité de l’état serveur ;
- le principal reste exclusivement issu de la session ;
- le modèle ne contient jamais le JWT compact, sa signature ou son payload ;
- aucune donnée legacy n’est utilisée.

**Aucun** runtime de ce modèle dans V2.1z.

### Invariants stricts

#### `sessionId`

- string non vide conforme à l’identifiant canonique de session ;
- comparaison exacte avec `AuthSession.sessionId` ;
- aucune coercition ou normalisation.

#### `jti`

Alignement strict sur le contrat V2.1o et sur `isJwtClaimsPolicySatisfied` :

- type exact `string` primitif ;
- valeur non vide ;
- longueur comprise entre **1 et 128** caractères inclus ;
- uniquement les caractères ASCII suivants : `A-Z` `a-z` `0-9` `.` `_` `:` `-` ;
- expression normative : `^[A-Za-z0-9._:-]{1,128}$` ;
- aucune valeur Unicode ; aucun espace ASCII ou Unicode ; aucun slash ; aucun antislash ; aucun caractère de contrôle ;
- aucune coercition ; aucune normalisation ; aucune transformation de casse ;
- comparaison exacte et sensible à la casse ;
- **la même règle** s’applique au claim JWT `jti` et à `AuthSessionAccessToken.jti` ;
- un producteur futur doit générer un `jti` appartenant à ce domaine ;
- une valeur hors format doit échouer en fail-closed **avant** toute liaison JWT ↔ session ;
- unicité globale dans le futur stockage canonique V2 ;
- aucune génération déterministe depuis `userId`, `sid`, temps ou secret ;
- génération cryptographiquement aléatoire par un composant futur ;
- aucun `jti` fourni par le client hors JWT signé.

#### `status`

Valeurs exactes : `active` | `revoked`. Aucune autre valeur, casse, alias ou fallback.

#### Temps

`issuedAt`, `expiresAt` et `revokedAt` utilisent le format ISO UTC canonique déjà retenu pour les sessions.

Exiger :

- `issuedAt < expiresAt` ;
- token actif ⇒ `revokedAt === null` ;
- token révoqué ⇒ `revokedAt` canonique et `revokedAt >= issuedAt` ;
- temporellement admissible seulement si `issuedAt <= evaluationTime < expiresAt` ;
- aucune horloge implicite ; aucun `Date.now()` ; aucune valeur par défaut ; aucun arrondi silencieux.

### Politique de multiplicité

**Décision CTO :** une session ne peut avoir qu’**un seul** JWT d’accès actif à un instant donné.

Lors de l’émission ou rotation future d’un nouveau JWT pour la même session :

1. le précédent enregistrement actif doit être révoqué ;
2. un nouveau `jti` unique doit être généré ;
3. le nouvel enregistrement devient actif ;
4. l’opération doit être **atomique** ;
5. l’ancien JWT doit échouer dès que son `jti` n’est plus actif.

Interdire : plusieurs `jti` actifs simultanément pour une même session ; réactivation d’un `jti` révoqué ; réutilisation d’un ancien `jti` ; remplacement silencieux sans révocation ; succès en cas de plusieurs résultats actifs.

**Limite reconnue :** cette politique invalide les anciens tokens après rotation, mais un bearer token actif volé peut toujours être rejoué jusqu’à révocation ou expiration. Aucune prétention de protection absolue contre le vol du token.

### Révocation

Déclencheurs futurs : logout ; révocation de session ; désactivation de l’identité ; rotation du JWT d’accès ; incident de sécurité ou révocation administrative ; expiration (rend le token inactif même sans mutation implicite).

Règles : révocation idempotente ; aucune réactivation ; révocation de session ⇒ aucun token associé ne peut être accepté ; token révoqué ⇒ session non authentifiée pour ce JWT ; expiration ne doit jamais prolonger ou renouveler la session ; aucune mutation implicite pendant une simple validation.

### Port futur de résolution

```text
resolveAuthSessionAccessTokenByJti(jti) → Promise<AuthSessionAccessToken | null>
```

Le port devra être : injecté explicitement ; borné par `jti` exact ; consulté uniquement **après** validation cryptographique RS256 ; sans environnement implicite ; sans accès legacy ; fail-closed sur absence, doublon, valeur hostile, throw ou rejet ; sans exposer le résultat brut à l’appelant HTTP.

**Aucun** repository créé par V2.1z.

### Évolution de `validateJwtBoundAuthSession`

V2.1y avait bloqué la signature complète jusqu’au contrat `jti`. La signature normative future est :

```text
validateJwtBoundAuthSession(
  cryptographicallyAdmissibleToken,
  authSession,
  authSessionAccessToken,
  sessionEvaluationTime
) → Promise<{ sub, sid, jti, principal } | null>
```

Le succès `JWT_BOUND_ACTIVE_SESSION` exige exactement :

1. résultat cryptographique V2.1x conforme ;
2. `AuthSession` conforme ;
3. session active au temps explicite ;
4. `AuthSessionAccessToken` conforme ;
5. token serveur `status === "active"` ;
6. token serveur temporellement actif ;
7. claim `sid === AuthSession.sessionId` ;
8. claim `sub === AuthSession.identity.userId` ;
9. `AuthSession.principal.userId === AuthSession.identity.userId` ;
10. claim `jti === AuthSessionAccessToken.jti` ;
11. `AuthSessionAccessToken.sessionId === AuthSession.sessionId`.

Toute divergence → `null`, sans exception sortante. **Aucun export runtime** dans V2.1z.

### Ordre normatif

```text
Bearer credential
  → décodage JWT strict
  → claims et temps JWT
  → résolution kid
  → vérification RS256
  → TOKEN_CRYPTOGRAPHICALLY_ADMISSIBLE
  → résolution du token serveur par jti
  → résolution de la session par sid
  → validation du token serveur
  → validation de la session
  → liaison exacte jti / sid / sub
  → JWT_BOUND_ACTIVE_SESSION
  → autorisation par permission
  → mapping HTTP 200 / 401 / 403
```

Aucune consultation de session ou d’état `jti` avant RS256. Aucune autorisation avant liaison complète. Tout échec `jti`/session est une erreur d’**authentification**, pas d’autorisation.

### Confidentialité

Ne jamais exposer : JWT compact ; signature ou `signingInput` ; header ou payload complet ; `kid` ou `CryptoKey` ; valeur brute du repository ; session complète ; historique interne des `jti` ; raison détaillée de révocation ; clé ou secret.

Résultat réussi limité exactement à `{ sub, sid, jti, principal }`.

### Annonce V2.1aa

Prochain lot imposé : **V2.1aa — implémentation du modèle et du validateur JWT ↔ session**.

Ce lot devra implémenter et tester : `AuthSessionAccessToken` ; validation stricte et immutabilité ; statut actif/révoqué ; validation temporelle explicite ; liaison `jti`/`sid`/`sub`/session ; `validateJwtBoundAuthSession` ; cas nominaux et hostiles.

Le repository persistant, l’émission/rotation et l’intégration HTTP restent dans des lots suivants clairement bornés.

V2.1aa devra utiliser une **validation unique et cohérente** du format `jti` (`^[A-Za-z0-9._:-]{1,128}$`) pour le claim JWT et pour `AuthSessionAccessToken.jti`. Aucune génération de `jti` n’est implémentée dans le présent correctif documentaire.

**Règle anti-enlisement :** après V2.1z (et son correctif d’alignement de format `jti`), aucun nouveau contrat documentaire intermédiaire ne doit être créé avant l’implémentation V2.1aa, sauf nouveau défaut bloquant découvert par le diff CTO indépendant.

### Hors périmètre de V2.1z

- JavaScript runtime ; nouvel export ; test runtime ; repository ;
- PostgreSQL, migration, schéma ou donnée ; génération réelle de `jti` ;
- émission ou signature JWT ; rotation ou refresh runtime ; route ou middleware ; login ou logout runtime ;
- cache, réseau ou KMS ; dépendance ou variable d’environnement ; `Date.now()` ;
- clé, secret, PEM, JWK ou JWKS ; modification legacy ; modification de la matrice 48/102.

## 61. Gate de merge V2.1z

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR conservée Draft jusqu’à stabilisation ;
- [x] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [x] V2.1y correctement clôturé ;
- [x] `AuthSessionAccessToken` contractualisé ;
- [x] `jti` unique et lié explicitement à `sessionId` ;
- [x] un seul `jti` actif par session contractualisé ;
- [x] rotation atomique et révocation de l’ancien `jti` documentées ;
- [x] réactivation et réutilisation d’un `jti` interdites ;
- [x] cycle `active`/`revoked` documenté ;
- [x] politique temporelle explicite documentée ;
- [x] port `resolveAuthSessionAccessTokenByJti` contractualisé ;
- [x] signature future `validateJwtBoundAuthSession` complétée ;
- [x] liaison exacte `jti`/`sid`/`sub`/session documentée ;
- [x] principal exclusivement issu de la session ;
- [x] ordre RS256 → état `jti` → session → autorisation respecté ;
- [x] limites réelles de la prévention du rejeu reconnues ;
- [x] aucun runtime, export, test, repository, schéma ou donnée ajouté ;
- [x] aucune dépendance, clé ou secret ajouté ;
- [x] matrice 48/102 inchangée ;
- [x] V2.1 global conservé non terminé ;
- [x] V2.1aa imposé comme prochain lot d’implémentation ;
- [x] aucun conflit avec `develop` ;
- [x] décision CTO explicite avant Ready puis merge.

### Clôture documentaire V2.1z

- PR fusionnée : **#149** ;
- head validé : `72c9f19bc8eed2f5feecd23f38cf68eb3952fef7` ;
- merge commit : `8880e9d4ada338466dabe1978787b2d293af2d1b`.

## 62. Correctif V2.1z — alignement du format `jti`

Correctif **documentation uniquement**, autorisé par la règle anti-enlisement après découverte d’un défaut bloquant post-fusion.

### Traçabilité

- PR d’origine : **#149** ;
- head fusionné : `72c9f19bc8eed2f5feecd23f38cf68eb3952fef7` ;
- merge commit : `8880e9d4ada338466dabe1978787b2d293af2d1b` ;
- défaut : divergence entre le format `jti` de V2.1z et V2.1o / runtime (`isJwtClaimsPolicySatisfied`) ;
- commentaire P2 traité : le format trop permissif aurait permis un `AuthSessionAccessToken` serveur accepté alors que le JWT correspondant serait toujours refusé par le validateur de claims ;
- décision : alignement strict sur `^[A-Za-z0-9._:-]{1,128}$` ;
- **V2.1aa bloqué** jusqu’à fusion du présent correctif.

### Effet

- lève exclusivement l’incompatibilité de format ;
- V2.1z reste le contrat architectural de référence ;
- V2.1aa reste le prochain lot d’implémentation ;
- aucun runtime, aucune génération de `jti`, aucun nouveau lot documentaire intercalé sans nouveau défaut bloquant CTO.

### Gate du correctif

- [x] diff GitHub indépendant relu par le CTO ;
- [x] PR conservée Draft jusqu’à stabilisation ;
- [x] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [x] commentaire P2 de la PR #149 traité ;
- [x] format `jti` aligné sur V2.1o ;
- [x] regex `^[A-Za-z0-9._:-]{1,128}$` documentée ;
- [x] claim JWT `jti` et `AuthSessionAccessToken.jti` alignés ;
- [x] Unicode, espaces, slash et antislash interdits ;
- [x] aucune coercition ou normalisation ;
- [x] comparaison exacte et sensible à la casse ;
- [x] invariants d’unicité, rotation et révocation inchangés ;
- [x] aucun runtime, export ou test ajouté ;
- [x] aucun repository, schéma ou donnée ajouté ;
- [x] aucune dépendance, clé ou secret ajouté ;
- [x] matrice 48/102 inchangée ;
- [x] V2.1 global conservé non terminé ;
- [x] V2.1aa maintenu comme prochain lot ;
- [x] aucun conflit avec `develop` ;
- [x] décision CTO explicite avant Ready puis merge.

### Clôture documentaire du correctif V2.1z (format `jti`)

- PR fusionnée : **#150** ;
- head validé : `9a8c24fbc8052f6e4b9cd7f32bc408bca8d2d68b` ;
- merge commit : `60b67415a343a34a879c7b8b63a19d82063ceea2` ;
- déblocage : **V2.1aa** peut démarrer.

## 63. Périmètre exact de V2.1aa

Lot d’implémentation **pure** dans `@somafrik/auth-v2` des contrats V2.1y / V2.1z : modèle `AuthSessionAccessToken` et validateur `validateJwtBoundAuthSession`.

### Exports publics exacts

- fichier modèle : `packages/auth/src/session-access-token.js` ;
  - `AUTH_SESSION_ACCESS_TOKEN_STATUS` ;
  - `createAuthSessionAccessToken` ;
  - `isAuthSessionAccessTokenActive` ;
- fichier liaison : `packages/auth/src/jwt-session-binding.js` ;
  - `validateJwtBoundAuthSession` ;
- réexports depuis `packages/auth/src/index.js` ;
- les exports existants restent inchangés ;
- **aucune** fonction de révocation d’`AuthSessionAccessToken` dans ce lot.

### Contrat d’exécution — `AuthSessionAccessToken`

Forme exacte :

```text
{
  sessionId: string,
  jti: string,
  status: "active" | "revoked",
  issuedAt: string,
  expiresAt: string,
  revokedAt: string | null
}
```

Règles runtime :

- `jti` : `^[A-Za-z0-9._:-]{1,128}$` (même alphabet que le claim JWT V2.1o) ;
- `sessionId` : mêmes règles canoniques que `AuthSession.sessionId` ;
- timestamps ISO UTC canoniques (millisecondes `.xxxZ`) ;
- actif ⇒ `revokedAt === null` ; révoqué ⇒ `revokedAt >= issuedAt` ;
- temporellement actif seulement si `issuedAt <= evaluationTime < expiresAt` ;
- objets gelés ; aucune horloge implicite ; aucun `Date.now()` ;
- aucune génération de `jti` ; aucun repository ; aucune I/O.

### Contrat d’exécution — `validateJwtBoundAuthSession`

```text
validateJwtBoundAuthSession(
  cryptographicallyAdmissibleToken,
  authSession,
  authSessionAccessToken,
  sessionEvaluationTime
) → Promise<{ sub, sid, jti, principal } | null>
```

- non-`null` = **JWT_BOUND_ACTIVE_SESSION** uniquement ;
- les **11** contrôles V2.1z sont exigés exactement ;
- `cryptographicallyAdmissibleToken.sub` / `.sid` / `.jti` doivent chacun satisfaire `^[A-Za-z0-9._:-]{1,128}$` (fail-closed) ;
- `isAuthSessionActive(...) === true` et `isAuthSessionAccessTokenActive(...) === true` ;
- principal **exclusivement** issu de la session validée ;
- aucune exception ni promesse rejetée sortante ;
- aucune répétition des politiques claims / temps JWT / kid / RS256 ;
- aucun repository, HTTP, PEM, crypto, réseau, cache ou dépendance ajoutée.

### Fichiers du lot

1. `packages/auth/src/session-access-token.js`
2. `packages/auth/src/jwt-session-binding.js`
3. `packages/auth/src/index.js`
4. `packages/auth/test/session-access-token.test.js`
5. `packages/auth/test/jwt-session-binding.test.js`
6. `docs/project/V2-RECONSTRUCTION.md`

### Hors périmètre de V2.1aa

- `revokeAuthSessionAccessToken` et toute API de révocation du token d’accès ;
- `resolveAuthSessionAccessTokenByJti` (repository) ;
- émission / signature / rotation JWT ; login / logout / refresh HTTP ;
- middleware, routes, mapping HTTP ;
- PostgreSQL, migration, schéma, donnée ;
- PEM/JWK/JWKS, réseau, KMS, cache, secrets ;
- dépendance ajoutée ; `Date.now()` ; variable d’environnement ;
- modification de la matrice 48/102.

### Annonce du lot suivant

Prochain lot imposé : **V2.1ab — orchestration post-RS256 et ports de résolution injectés**.

## 64. Gate de merge V2.1aa

- [ ] diff GitHub indépendant relu par le CTO ;
- [ ] PR conservée Draft jusqu’à stabilisation ;
- [ ] diff limité aux six fichiers du lot ;
- [ ] correctif #150 / format `jti` correctement clôturé ;
- [ ] `AuthSessionAccessToken` implémenté (create / active ; **sans** revoke) ;
- [ ] format `jti` runtime aligné sur `^[A-Za-z0-9._:-]{1,128}$` ;
- [ ] `sub` / `sid` / `jti` du résultat cryptographique validés sur le même alphabet ;
- [ ] `validateJwtBoundAuthSession` implémenté (signature Promise) ;
- [ ] succès = `JWT_BOUND_ACTIVE_SESSION` uniquement ;
- [ ] les 11 liaisons V2.1z couvertes par tests nominaux et hostiles ;
- [ ] principal exclusivement issu de la session ;
- [ ] aucune exception ni promesse rejetée sortante ;
- [ ] aucune API de révocation d’`AuthSessionAccessToken` ;
- [ ] fichiers nommés `session-access-token.js` / `session-access-token.test.js` ;
- [ ] prochain lot annoncé exactement : V2.1ab — orchestration post-RS256 et ports de résolution injectés ;
- [ ] aucun repository, schéma, donnée, HTTP ou crypto ajouté ;
- [ ] aucune dépendance, clé ou secret ajouté ;
- [ ] matrice 48/102 inchangée ;
- [ ] V2.1 global conservé non terminé ;
- [ ] aucun conflit avec `develop` ;
- [ ] décision CTO explicite avant Ready puis merge.
