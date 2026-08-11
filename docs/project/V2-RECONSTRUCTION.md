# Reconstruction contrôlée — Somafrik V2

**Statut :** chantier validé par décision CTO

**Date d'ouverture :** 2026-08-10

**Base initiale :** `develop@cfb20ce`

**Lot courant :** V2.1s — contrat de vérification RS256 pure

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

- [ ] diff GitHub indépendant relu par le CTO ;
- [ ] PR en brouillon jusqu’à stabilisation du périmètre ;
- [ ] diff limité à `docs/project/V2-RECONSTRUCTION.md` ;
- [ ] export documentaire `verifyJwtRs256Signature(signingInput, signature, verificationKey)` défini ;
- [ ] retour exact `Promise<boolean>` et sémantique `SIGNATURE_VALID` documentés ;
- [ ] contraintes strictes de `signingInput`, `signature` et `verificationKey` documentées ;
- [ ] appel imposé à `crypto.subtle.verify` avec `RSASSA-PKCS1-v1_5` documenté ;
- [ ] modulus 2048/3072/4096, exposant 65537 et hash SHA-256 documentés ;
- [ ] aucune résolution de `kid` ni import PEM/JWK/JWKS introduits ;
- [ ] aucune bibliothèque ou implémentation JWT runtime introduite ;
- [ ] aucun secret, aucune clé privée et aucun JWT introduit ;
- [ ] matrice 48/102 inchangée ;
- [ ] aucune modification de runtime, schéma ou donnée ;
- [ ] aucun conflit non résolu avec `develop` ;
- [ ] décision CTO explicite avant passage Ready puis merge.
