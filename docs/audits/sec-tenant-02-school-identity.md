# SEC-TENANT-02 / F6 — Cohérence canonique des identifiants d'établissement

Base : `develop@1f1c35c5175e188aa47dcfea0143aac6db08919f` (#994, #995 et #996 intégrées).
Comptes fictifs, PostgreSQL local jetable (garde `disposableTestDatabaseGuard`), aucun jeton ni secret journalisé.

## 1. Matrice des chemins (avant correctif)

| Chemin | Source de l'établissement | Protection existante | Écart constaté |
|---|---|---|---|
| Connexion Web / Mobile (`buildPrincipal`) | `schoolCode` et `schoolId` du compte trouvé pour le code saisi (même enregistrement) | compte cherché par identifiant **et** code d'établissement | Identité cohérente. **Rôles lus tous établissements confondus** (`listActiveUserRoleKeys`) : un rôle détenu dans B entre dans le jeton émis pour A |
| Refresh (`issueRefreshedAccessToken`) | `session.school_code`, revalidé contre `users.school_id` pour un rôle scolaire (SEC-TENANT-01) ; aucun `schoolId` dans le jeton | `resolveRefreshSchoolCode` | Rôles lus tous établissements confondus |
| `requireAuth` → garde SEC-TENANT-01 (`assertAccessSessionAccount`) | jeton | établissement canonique relu dans la requête de session | **`schoolId` concordant = accepté sans comparer `schoolCode`** (et un `schoolCode` concordant couvre un `schoolId` d'un autre établissement). Comptes « sans affectation » non contrôlés. Comptes plateforme : `schoolId` non contrôlé |
| `requirePermission` → `collectPrincipalRoleKeys` | `user_roles` du compte | rôles relus à chaque requête (SEC-AUTH-05) | **Rôles de tous les établissements appliqués aux données de l'établissement courant** |
| Routes lisant `principal.schoolCode` (classes, enseignants, export, synchronisation Mobile, réglages…) | jeton | `tenantScopeService.assertSchoolAccess` (compare au même jeton) | Servent l'établissement du `schoolCode`, même s'il contredit le `schoolId` |
| Routes lisant `principal.schoolId` (activités du tableau de bord, éditeur de bulletins) | jeton | aucune autre | Servent l'établissement du `schoolId`, même s'il contredit le `schoolCode` |
| En-tête `X-Somafrik-School-Code` | client | Superadmin / Admin Pays uniquement, établissement relu en base ; un compte scolaire ne peut pas changer d'établissement | Conforme |
| Superadmin / Admin Pays | `schoolCode` « * », aucun `schoolId` | garde des données personnelles plateforme ; périmètre pays de l'Admin Pays | Conforme pour les jetons émis ; un `schoolId` porté par un jeton plateforme n'était pas refusé |
| Finance (`liveRbacPrincipalAuthority`), synchronisation Mobile, notifications | rôles lus par établissement (`listActiveUserRoleKeysForSchool`) | déjà bornés | Conformes |
| Traitements internes sans jeton (`mobileSyncScope`, rôles explicites) | rôles déjà bornés | — | Inchangés |

Origine du multirôle inter-établissements : provisionnement de contacts (`clientsService`) et liaison parentale (`parentLinking`) attribuent un rôle dans l'établissement du contact, qui peut différer de celui du compte (`users.school_id`). Synchronisation Mobile et Finance traitent déjà ce cas par établissement ; le contrôle RBAC générique non.

## 2. Reproduction (base `1f1c35c5`)

`SEC_TENANT_02_REPRO=1 node backend/lib/secTenant02SchoolIdentity.http.pg.test.js` sur la base exacte : **20 écarts**.

```
DÉFAUT TENANT2-02 schoolCode A + schoolId B : classes de A servies
DÉFAUT TENANT2-02 schoolCode A + schoolId B (classes) : attendu 401, reçu 200
DÉFAUT TENANT2-02 schoolCode B + schoolId A : activités de A servies
DÉFAUT TENANT2-02 schoolCode B + schoolId A (activités) : attendu 401, reçu 200
DÉFAUT TENANT2-03 code d'établissement inconnu : attendu 401, reçu 404
DÉFAUT TENANT2-04 ID d'établissement inconnu : attendu 401, reçu 200
DÉFAUT TENANT2-08 rôle d'administration de B dans le jeton A (["SCHOOL_ADMIN","TEACHER"])
DÉFAUT TENANT2-08 libellé de rôle du jeton A : Admin School
DÉFAUT TENANT2-08 route d'administration sur A avec le rôle de B : attendu 403, reçu 200
DÉFAUT TENANT2-08 export de A avec le rôle de B : attendu 403, reçu 200
DÉFAUT TENANT2-08 activités de A servies via le rôle de B
DÉFAUT TENANT2-08 activités de A avec le rôle de B : attendu 403, reçu 200
DÉFAUT TENANT2-08 permissions effectives : rôle de B absent dans A
DÉFAUT TENANT2-08 refresh : route d'administration sur A : attendu 403, reçu 200
DÉFAUT TENANT2-10 Superadmin portant un schoolId d'établissement : attendu 401, reçu 403
DÉFAUT TENANT2-11 Admin Pays portant un schoolId d'établissement : attendu 401, reçu 403
DÉFAUT TENANT2-12 synchronisation, schoolCode A forgé : attendu 401, reçu 200
DÉFAUT TENANT2-13 export de A avec schoolCode forgé
DÉFAUT TENANT2-13 export, schoolCode A forgé : attendu 401, reçu 200
DÉFAUT TENANT2-14 legacy, schoolCode A forgé : attendu 401, reçu 200
```

Deux familles :

| Famille | Scénarios | Exploitable sans le secret JWT |
|---|---|---|
| **Multirôle inter-établissements** : un enseignant de A détenant `SCHOOL_ADMIN` dans B obtient les droits d'administration sur **les données de A** (routes d'administration, export complet de A, activités), y compris après refresh | TENANT2-08 | **Oui** : jeton légitime, parcours de connexion normal |
| **Identité contradictoire acceptée** (`schoolCode` ≠ `schoolId`, établissement inconnu, `schoolId` sur un compte plateforme) | TENANT2-02/03/04/10/11/12/13/14 | Non : jeton signé avec le secret (forgé ou mal émis). Défense en profondeur |

Les autres scénarios étaient déjà conformes sur la base : signature invalide (05), session d'un autre établissement (06), refresh après changement d'établissement (07, SEC-TENANT-01), rôle retiré (09, SEC-AUTH-05), Superadmin et Admin Pays sans accès implicite (10/11), PostgreSQL indisponible (15), concurrence (16).

## 3. Solution retenue

1. **Garde de session** (`accessSessionAccountGuard.js`, appelée par `requireAuth` et les routes publiques attribuant une action à un jeton) :
   - chaque identifiant présent est vérifié contre l'établissement canonique (`users.school_id`) : `schoolCode` (code interne ou login_code) **et** `schoolId` ; une contradiction, un établissement inconnu ou absent → session révoquée, 401 ;
   - s'applique aussi aux comptes « sans affectation » qui portent un établissement ;
   - compte plateforme sans rattachement concret portant un `schoolId` → 401 `SESSION_SCHOOL_IDENTITY_MISMATCH` ;
   - aucune requête supplémentaire en PostgreSQL : l'établissement canonique vient déjà de la requête de session (projection `user_school_id`, `user_school_code`, `user_school_login_code`) ;
   - dépôt mémoire sans identifiant canonique : un `schoolId` n'est accepté qu'avec un `schoolCode` vérifié.
2. **`requireAuth`** conserve uniquement le `schoolId` canonique vérifié (jetons de refresh compris, qui n'en portent pas).
3. **Rôles bornés à l'établissement vérifié** : `loadLiveRoleState(repo, userId, { schoolId })` lit `listActiveUserRoleKeysForSchool` (primitive déjà utilisée par Finance, synchronisation Mobile et notifications) ; sans lecture bornée disponible → refus (fail-closed, jamais la lecture globale). Appliqué à :
   - `requirePermission`, permissions effectives et réinitialisation de mot de passe (`collectPrincipalRoleKeys`, `schoolId` du principal) ;
   - connexion (rôles du jeton, établissement de connexion) ;
   - refresh (établissement de la session).
   Comptes plateforme (aucun établissement) : lecture globale inchangée. Un compte dont les seuls rôles sont dans un autre établissement a un historique → aucun rôle ici (règle SEC-AUTH-05).
4. **Finance** : le dépôt mandataire, qui fournit déjà les rôles bornés, répond aussi à la lecture bornée → aucune lecture supplémentaire, comportement inchangé.
5. **Performance** : `listActiveUserRoleKeysForSchool` comparait `user_id::text` / `school_id::text` (parcours complet de `user_roles`) ; comparaison en UUID, index `idx_user_roles_user` (voir §7).

## 4. Solutions écartées

| Option | Raison |
|---|---|
| Validation seulement à l'émission du JWT | Les identifiants émis sont déjà cohérents ; ne couvre ni un jeton forgé, ni les rôles d'un autre établissement relus à chaque requête. |
| Revalidation seulement au refresh | Fenêtre de 15 min de l'access token ; ne couvre pas le RBAC par requête. |
| Résolution systématique du tenant depuis PostgreSQL dans chaque route | Refonte de dizaines de routes (`schoolCode` / `schoolId` lus localement) ; la garde centrale dispose déjà de l'établissement canonique sans requête supplémentaire. |
| Retirer `schoolId` (ou `schoolCode`) du jeton | Changement de contrat Web / Mobile ; les deux formes restent consommées. |
| Interdire les rôles inter-établissements | Cas métier existant (parent dans un autre établissement, synchronisation Mobile multi-établissements). |

## 5. Résultats

Comparaison complète branche / base en cours ; résultats à compléter avant ouverture de la PR Draft.

## 6. Risques résiduels et constats hors périmètre

- **Famille « identité contradictoire »** : n'était exploitable qu'avec le secret de signature ; le correctif est une défense en profondeur. La migration HS256 → RS256 (SEC-JWT-V2) reste séparée.
- **Routes sans `requirePermission`** fondées sur la revendication de rôle du jeton (ex. activités du tableau de bord : `role === "Admin School"`) : la revendication est désormais bornée à l'établissement à la connexion et au refresh, mais n'est pas relue à chaque requête (≤ 15 min après un changement de rôle), comme noté pour SEC-AUTH-05.
- **Compte plateforme portant un `schoolCode` concret et un `schoolId`** : aucune émission légitime connue ; non vérifié (une recherche d'établissement par requête serait nécessaire).
- **Dépôt mémoire** (développement) : sans identifiant canonique, seul le code d'établissement est vérifiable.
- **Saturation du pool PostgreSQL** pendant un blocage SQL (SEC-AUTH-05 §7.1) : inchangée.
- HS256/RS256, `aud`/`jti`, SEC-PDF-02, SEC-XSS-01, Carte élève, Finance, Pédagogie, Render, contrats Mobile : non modifiés.

## 7. Performance

| Lecture (50 000 lignes `user_roles`, PostgreSQL local) | Moyenne par appel | Plan |
|---|---|---|
| Rôles tous établissements (avant, chemin `requirePermission`) | 0,33 ms | Index Scan `idx_user_roles_user` |
| Rôles bornés, ancienne requête (cast texte) | 14,99 ms | Seq Scan (49 999 lignes filtrées) |
| **Rôles bornés, requête corrigée (UUID)** | **0,27 ms** | Index Scan `idx_user_roles_user` |

- Garde de session : aucune requête supplémentaire (projection de la requête de session existante).
- RBAC : une lecture de rôles par requête protégée, comme avant (remplacée, pas ajoutée).
- Connexion : une lecture bornée supplémentaire pour un compte rattaché (une fois par connexion).
- La correction de la requête bornée profite aussi aux appelants existants (Finance, synchronisation Mobile, notifications).
