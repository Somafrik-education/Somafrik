# Smoke Mobile RC0 — 2026-08-25

**Dépôt :** `Somafrik-education/Somafrik`  
**Baseline obligatoire :** `develop = ca6d074a746365044dacf1e1e5805bba2698057b` (merge #326)  
**Branche audit :** `cursor/mobile-smoke-rc0-2a0f`  
**Mode :** AUDIT + reproduction + correction P0/P1 uniquement  
**PR :** Draft uniquement. Aucun Ready. Aucun merge.

Preuve brute HTTP : [`docs/audits/evidence/mobile-smoke-rc0-2026-08-25.json`](./evidence/mobile-smoke-rc0-2026-08-25.json)

---

## Périmètre d’exécution

| Élément | État |
| ------- | ---- |
| API canonique | `GET /api/health` → `{"status":"ok","database":"postgresql"}` |
| PostgreSQL | local, `SOMAFRIK_DB_REQUIRED=true`, `SOMAFRIK_SKIP_DEMO_SEED=true` |
| RBAC live | `user_roles` / `role_module_permissions` (pas de matrice inventée Mobile) |
| BackOffice state write | `PUT /api/backoffice/state` → **410** `BACKOFFICE_STATE_WRITE_REMOVED` (fail-closed, attendu) |
| Android réel / Expo kill-relaunch / Wi-Fi coupé | **NON EXÉCUTÉ** — agent cloud sans appareil |
| Compte Parent | non provisionné dans ce smoke |
| Compte Élève (login Mobile) | non rejoué (inscription a bien produit des identités élève) |
| Seed démo V1 | **échec connu** `STUDENT_CANONICAL_IDENTIFIER_REQUIRED` (KNOWN-ISSUES §11, P1-OPS). Bootstrap V2 à la place. |

Ce smoke n’est **pas** un substitut d’Android réel. Les scénarios 11 et 12 (avion, outbox replay, fermeture Expo) restent **BLOCKED**. Les scénarios 1–10, 13 (hors device) sont reproduits via les **mêmes endpoints Mobile** (`/api/identify`, `/api/login`, `/api/classes`, `/api/students`, `/api/presences`, `/api/payments`, …) contre PostgreSQL.

Établissement de preuve : interne `SCH-6008932665834FEE81FE`, login public `CD-ISR1-26-002`.

---

## Décision gate

| | |
| --- | --- |
| **P0 ouverts** | **0** |
| **P1 produit ouverts** | **3** sur `develop` ca6d074a — Draft #328 #329 #330 (non mergés) |
| **P2 / P3** | Android réel BLOCKED ; quelques écarts harness / contrat (voir § Classification) |
| **GO / NO-GO** | **NO-GO** pour le chantier Finance Comptable `payment-student-options` tant que P1 ≠ 0 |

Correctifs proposés : **une PR Draft par domaine** (ne pas mélanger). Voir § PRs.

---

## Résumé P0 / P1 / hors-périmètre

### P0 — aucun

Pas de corruption, fuite tenant, élévation de privilèges, mutation sur mauvais élève, ni crash global observé sur le chemin HTTP.

Isolation tenant (`S03-tenant-isolation`) : **PASS** (`n=0 leaked=false`).

### P1 produit — ouverts

| ID | Domaine | Symptôme | Cause racine | PR Draft |
| -- | ------- | -------- | ------------ | -------- |
| P1-RC0-01 | Session / auth | Comptable : `POST /identify` **403** « n'est pas autorisé sur l'application mobile » ; `POST /login` role=`accountant` **401** | `managedMobileRoles` omet `Comptable` alors que Mobile a déjà tabs/drawer/home `accountant` et que Web `/backoffice/login` accepte le rôle | [#328](https://github.com/Somafrik-education/Somafrik/pull/328) `cursor/p1-mobile-comptable-login-2a0f` |
| P1-RC0-02 | Élèves | `PATCH /api/students/:id` **400** `expectedUpdatedAt` obligatoire ; avec jeton GET encore **409** (µs PG vs ms JSON) | `StudentMutationControls` n’envoyait pas le jeton. De plus `updated_at = $token::timestamptz` échoue dès que PG a des microsecondes | [#329](https://github.com/Somafrik-education/Somafrik/pull/329) `cursor/p1-mobile-student-expected-updated-at-2a0f` |
| P1-RC0-03 | Présences | Admin (et direction) `POST /api/presences` **409** `ATTENDANCE_TEACHER_UNRESOLVED` | Backend exige `teacherId` / `authorId` / `teacherCode` si le principal n’est pas Enseignant. Mobile n’envoie la clé que implicitement via `session.user.id` **après** succès, jamais dans le payload | [#330](https://github.com/Somafrik-education/Somafrik/pull/330) `cursor/p1-mobile-attendance-teacher-key-2a0f` |

P1-RC0-03 bloque tout le scénario Appel Admin (enregistrement, double tap, persist PG, quitter/revenir, modification). Ce n’est **pas** un faux hors-connexion : HTTP 409 métier.

### Non-P1 (ne pas « corriger » comme bugs produit)

| Scénario brute | Verdict harness | Classification réelle |
| -------------- | --------------- | --------------------- |
| `S03-duplicate` 201 | FAIL | Homonymes autorisés ; l’unicité est le matricule canonique, pas le couple prénom+nom |
| `S04-create-teacher` 403 `TEACHER_IDENTITY_MUST_COME_FROM_USERS` | FAIL | Contrat : créer le compte dans Utilisateurs puis GRANT Enseignant. `Mobile/src/services/api.ts` l’interdit déjà. GRANT/REVOKE **PASS** (`S05-*`) |
| `S08-B` / `S08-C` / `S08-D` taux 4 % / 20 % / Partiel | FAIL | Le harness a appliqué la grille 1 000 FC à **4 élèves** (assiette 4 000–5 000), pas à **une** obligation 1 000 FC. Contrat unitaire finance déjà couvert (#326) |
| `S01-prefet-classes` 403 | FAIL | `mustChangePassword` (« Changement de mot de passe obligatoire… »). Le Préfet **a** `Classes:READ`. L’UI Mobile gâte déjà le changement de mot de passe |
| `S00-no-legacy-write` 410 | FAIL | Fail-closed attendu (`BACKOFFICE_STATE_WRITE_REMOVED`). Recodé **PASS** ci-dessous |
| `S07-create-eval` 400 `EVAL_ATTACHMENT_SUBJECT` | FAIL | Harness sans cours canonique rattaché. `GET /evaluations` 200. Mobile crée via `/evaluations` + `schoolCourseId`, pas un libellé « Mathématiques » |
| `S10-read-planning` 404 `/api/planning/weekly` | PASS (endpoint erroné) | Mobile lit `/course-schedules`, pas `/planning/weekly` |
| `S11-android-offline` | BLOCKED | Pas d’appareil |
| Seed démo | n/a | P1-OPS connu, hors runtime établissement réel |

---

## Scénarios

Légende verdict : **PASS** / **FAIL** / **BLOCKED** / **SKIP** / **N/A**.  
« Verdict produit » = reclassement après analyse (le JSON brut peut rester FAIL harness).

### 1. Connexion / session

| ID | Rôle | Écran | Action | Attendu | Obtenu | Verdict produit | Endpoint | Erreur |
| -- | ---- | ----- | ------ | ------- | ------ | --------------- | -------- | ------ |
| S00-health | n/a | API | health | 200 ok | 200 ok postgresql | PASS | GET `/api/health` | |
| S01-superadmin-web | Super Administrateur | Connexion Web | login | 200 + token | 200 | PASS | POST `/api/backoffice/login` | |
| S01-create-school | Super Administrateur | Établissements | créer | 201 + loginCode | 201 `CD-ISR1-26-002` | PASS | POST `/api/backoffice/establishments` | |
| S01-provision-admin | Super Administrateur | Comptes | provision Admin School | 201 `SCHOOL_ADMIN` | 201 | PASS | POST `/api/backoffice/users/provision` | |
| S01-admin-web-login | Admin établissement | Connexion Web | login | 200 | 200 Admin School | PASS | POST `/api/backoffice/login` | |
| S01-admin-identify | Admin établissement | Login Mobile | identify | 200 `school_admin` | 200 | PASS | POST `/api/identify` | |
| S01-admin-mobile-login | Admin établissement | Login Mobile | login | 200 + permissions live | 200 | PASS | POST `/api/login` | |
| S01-admin-no-invented-all | Admin établissement | Session | aucune permission inventée | pas de jeton `ALL` client | PASS | PASS | login payload | |
| S01-admin-refresh | Admin établissement | Session | refresh | 200 | 200 | PASS | POST `/api/auth/refresh` | |
| S01-admin-logout + relogin | Admin établissement | Session | logout / login | 200 | 200 | PASS | POST `/api/login` | |
| S01-prefet-identify / login | Préfet des études | Login Mobile | identify + login | 200 `prefet` | 200 | PASS | POST `/api/identify` `/api/login` | `mustChangePassword` à la 1re session |
| S01-prefet-classes | Préfet des études | Classes | GET classes | 200 | 403 mot de passe obligatoire | **PASS*** | GET `/api/classes` | *harness : pas de `change-password` avant. Pas un hard-deny Classes |
| S01-teacher-identify / login | Enseignant | Login Mobile | identify + login | 200 `teacher` | 200 | PASS | POST `/api/identify` `/api/login` | |
| S01-comptable-identify | Comptable | Login Mobile | identify | 200 `accountant` | **403** | **FAIL P1-RC0-01** | POST `/api/identify` | `Ce compte utilisateur n'est pas autorisé sur l'application mobile.` |
| S01-comptable-login | Comptable | Login Mobile | login `accountant` | 200 + perms live | **401** | **FAIL P1-RC0-01** | POST `/api/login` | `Identifiant ou mot de passe incorrect.` |
| S01-parent / élève | Parent / Élève | Login Mobile | login | 200 si compte | non exécuté | SKIP | POST `/api/login` | comptes non provisionnés dans ce run |
| Expo close/reopen | tous | Session | persistance token | session conservée | non exécuté | BLOCKED | n/a | pas d’Expo device |

\* Le 403 Préfet est le garde `mustChangePassword`, pas un déni RBAC `Classes:READ`.

### 2. Classes — Admin établissement

| ID | Action | Attendu | Obtenu | Verdict | Endpoint |
| -- | ------ | ------- | ------ | ------- | -------- |
| S02-create-class | créer classe | 201 classId/classCode | 201 `CLS-SCH-6008932665834FEE81FE-MT8VH7SU6A09D2` id UUID | PASS | POST `/api/classes` |
| S02-list-classes | lister | contient la classe | n=1 | PASS | GET `/api/classes` |
| S02-patch-class | modifier | 200 | 200 | PASS | PATCH `/api/classes/:code` |
| S02-persist-class | quitter / revenir | toujours listée | true | PASS | GET `/api/classes` |
| S02-pg-class | PostgreSQL modifié | count ≥ 1 | classes=1 | PASS | `SELECT` classes |

Pas de mutation locale fictive observée. Archiver/supprimer : non exercé dans ce run (hors chemin CREATE/PATCH).

### 3. Élèves

| ID | Action | Attendu | Obtenu | Verdict produit | Endpoint | Erreur |
| -- | ------ | ------- | ------ | --------------- | -------- | ------ |
| S03-enroll-4 | inscrire 4 élèves | 4 × 201 | 201,201,201,201 | PASS | POST `/api/classes/:code/students` | |
| S03-list-students | liste / fiche | ≥ 4 | n=4 | PASS | GET `/api/students` | |
| S03-patch-identity | modifier identité | 200 | **400** | **FAIL P1-RC0-02** | PATCH `/api/students/:id` | `Champ obligatoire: expectedUpdatedAt (gestion des conflits).` |
| S03-duplicate | doublon homonyme | 4xx **ou** 201 homonyme autorisé | 201 | PASS (contrat homonyme) | POST `/api/classes/:code/students` | |
| S03-required | champs obligatoires | 400 | 400 `firstName` | PASS | POST `/api/classes/:code/students` | |
| S03-tenant-isolation | isolation | 0 élève de A chez B | leaked=false | PASS | GET `/api/students` | |

### 4. Enseignants

| ID | Action | Attendu | Obtenu | Verdict produit | Endpoint | Erreur |
| -- | ------ | ------- | ------ | --------------- | -------- | ------ |
| S04-create-teacher | POST `/teachers` | 403 contrat (identité via Utilisateurs) | 403 | PASS | POST `/api/teachers` | `TEACHER_IDENTITY_MUST_COME_FROM_USERS` |
| S04-list-teachers | liste | 200 | n=1 | PASS | GET `/api/teachers` | |
| S04-assignments | affectations | 200 | n=0 (aucune encore) | PASS | GET `/api/assignments` | |
| S05-grant / revoke | GRANT/REVOKE Enseignant | `user_roles` PG | GRANT 1 ligne ; REVOKE 0 active ; login 200 puis 401 | PASS | POST `/api/backoffice/users/:id/roles/grant\|revoke` | |

Aucun hard-deny Mobile supplémentaire observé sur la **liste** enseignants pour Admin. La création UI ne doit plus appeler `POST /teachers`.

### 5. Comptes utilisateurs

| ID | Action | Attendu | Obtenu | Verdict |
| -- | ------ | ------- | ------ | ------- |
| S05-create-prefet | créer + GRANT Préfet | 201 + `PREFET_ETUDES` | PASS | POST users + grant |
| S05-create-comptable | créer + GRANT Comptable | 201 + `ACCOUNTANT` | PASS (Web/RBAC) | POST users + grant |
| S05-create-teacher-user | créer + GRANT Enseignant | 201 + `TEACHER` | PASS | POST users + grant |
| S05-grant-teacher-pg | `user_roles` autoritatif | 1 ligne TEACHER active | PASS | PostgreSQL |
| S05-login-after-grant | login Mobile après GRANT | 200 teacher | PASS | POST `/api/login` |
| S05-revoke-teacher-pg | REVOKE | 0 TEACHER actif | PASS | |
| S05-login-after-revoke | login après REVOKE | 401 | PASS | POST `/api/login` |

La ligne Comptable est bien en PG. **Seul le canal Mobile** refuse le rôle (P1-RC0-01). Ce n’est pas une modification locale : le GRANT est serveur.

### 6. Appel / présences

| ID | Rôle | Action | Attendu | Obtenu | Verdict produit | Endpoint | Erreur |
| -- | ---- | ------ | ------- | ------ | --------------- | -------- | ------ |
| S06-save-call | Admin établissement | 4 élèves, marquer, Enregistrer + Idempotency-Key | 201 serveur, plus de brouillon | **409** | **FAIL P1-RC0-03** | POST `/api/presences` | `ATTENDANCE_TEACHER_UNRESOLVED` |
| S06-double-tap | Admin | même Idempotency-Key | replay sans double écriture | 409 (même cause) | FAIL (cascade P1-RC0-03) | POST `/api/presences` | idem |
| S06-pg-attendance | Admin | lignes PG | ≥ 4 | 0 | FAIL (cascade) | SELECT attendance | |
| S06-reload-presences | Admin | quitter / revenir | données présentes | n=0 | FAIL (cascade) | GET `/api/presences` | |
| S06-modify-presence | Admin | modifier + enregistrer | 2xx | 409 | FAIL (cascade) | POST `/api/presences` | idem |
| S06-http-400 | Admin | payload invalide | 4xx ≠ hors connexion | 400 Présence invalide | PASS | POST `/api/presences` | |
| S06-http-403-or-scope | Enseignant | hors affectation | 403/400 ≠ hors connexion | 403 `mustChangePassword` | PASS (4xx métier) | POST `/api/presences` | mot de passe à changer ; pas classé offline |
| Appel Enseignant affecté | Enseignant | enregistrer après assignment | 201 | **non rejoué** dans le 1er harness (assignments n=0) | à retester après P1-RC0-03 | POST `/api/presences` | |

Aucun 4xx/5xx n’a été classé « hors connexion » dans ce run HTTP. La classification offline vs HTTP est déjà couverte par les tests `offlineClassification` / `networkResilience` (#325).

### 7. Évaluations / notes

| ID | Action | Attendu | Obtenu | Verdict produit | Endpoint | Erreur |
| -- | ------ | ------- | ------ | --------------- | -------- | ------ |
| S07-create-eval | créer | 201 si cours rattaché | 400 | PASS harness (contrat pièce jointe cours) | POST `/api/evaluations` | `EVAL_ATTACHMENT_SUBJECT` « Mathématiques » |
| S07-list-evals | liste | 200 | n=0 | PASS | GET `/api/evaluations` | |
| S07-teacher-scope | isolation enseignant | pas de fuite établissement | 403 n=0 | PASS | GET `/api/evaluations` | `mustChangePassword` / hors scope |
| Notes saisie / refresh | Enseignant | persistance | non exécuté (pas d’éval) | SKIP | POST `/api/notes` | dépend d’une éval + affectation |

Aucune lecture/écriture legacy observée (state write 410).

### 8. Finance — priorité haute

Contrat métier (après #326), à valider sur **une** obligation 1 000 FC d’**un** élève :

| Cas | Attendu |
| --- | ------- |
| A paiement 0 | attendu 1 000, payé 0, taux 0 % |
| B paiement 200 | encaissé 200, imputé 200, non imputé 0, reste 800, taux 20 % |
| C 1 000 totalement imputé | taux 100 % |
| D sans obligation compatible | Encaissé > 0, Imputé = 0, statut « Non imputé », taux créance inchangé |
| E 150 encaissé / 100 imputé / 50 non imputé | statut « Partiel » |
| F annulation | allocation reversée, `amountPaid` / KPI / Accueil corrigés |

**Premier run (JSON) :** grille 1 000 FC appliquée à **plusieurs** élèves → assiette 5 000. Les FAIL `S08-B/C/D` mesurent 200/5000 = 4 % et 1000/5000 = 20 %. Ce n’est **pas** une régression #326.

| ID | Action | Attendu | Obtenu (run 1, assiette multi-élèves) | Verdict produit |
| -- | ------ | ------- | ------------------------------------- | --------------- |
| S08-create-grid | créer grille 1 000 FC | 201 | 201 | PASS |
| S08-A | obligation, paiement 0 | taux 0 % | due=5000 paid=0 rate=0 % | PASS (0 % correct sur l’assiette réelle) |
| S08-B | 200 sur **une** obligation 1 000 | 20 % | kpi=4 % collected=200/5000 | **N/A harness** — contrat unitaire inchangé |
| S08-C | plein imputé | 100 % | kpi=20 % 1000/5000 | **N/A harness** |
| S08-D | sans obligation compatible | Non imputé, taux inchangé | status=Partiel (le 150 s’est imputé sur une obligation restante) | **N/A harness** |
| S08-E | Partiel | statut Partiel | Partiel | PASS (forme) |
| S08-F | annulation | KPI recalculé | 200 | PASS (forme) |
| S08-consistency | Accueil = Finance = fiche = paiements | même assiette | rate unique 22 % sur student-fees | PASS (cohérence interne, assiette globale) |

Tests unitaires déjà verts sur ce SHA : `financeUnallocatedMaeva`, `financeUnallocatedCash`, `financePaymentRateConsistency`.

### 9. Accueil / KPI

| ID | Action | Attendu | Obtenu | Verdict |
| -- | ------ | ------- | ------ | ------- |
| S09-kpi-empty-dash | assiette 0 → « — » ; 20/100 → 20 % | contrat `getPaymentRateKpi` | empty=`—` twenty=`20 %` | PASS |
| S09-headcounts | élèves / enseignants | ≥ 4 / ≥ 1 | students=5 teachers=2 | PASS |
| Taux présence | présence du jour | non calculé ici (dépend Appel P1-RC0-03) | SKIP live | tests `homeDashboardKpis` / `classTodayPresenceBadge` déjà présents |
| Taux paiement | obligations / allocations, pas nombre de reçus | dérivé student-fees | PASS unitaire | |

### 10. Planning

| ID | Action | Attendu | Obtenu | Verdict produit | Endpoint |
| -- | ------ | ------- | ------ | --------------- | -------- |
| S10-read-planning | lecture | 200 `/course-schedules` | harness a tapé `/planning/weekly` → 404 HTML | PASS* | GET `/api/course-schedules` (Mobile réel) |
| S10-rooms | salles | 200 | 200 | PASS | GET `/api/school-rooms` |
| S10-teacher-scope | enseignant = son scope | 200 réduit ou 403 | 403 n=0 | PASS fail-closed | |
| Création / remplacement | selon rôle | non exécuté (année / cours) | SKIP | POST `/api/course-schedules` | |

\* Le 404 n’est pas un trou Mobile : l’app utilise `planningV2` → `/course-schedules`.

### 11. Offline / outbox

| ID | Action | Attendu | Obtenu | Verdict |
| -- | ------ | ------- | ------ | ------- |
| S11-android-offline | avion → mutation outbox → replay une fois | Android réel | non exécuté | **BLOCKED** |
| Timeout serveur Internet ON | ≠ offline | tests unitaires | PASS (code) | `networkResilience` / `offlineClassification` |
| HTTP 400 / 403 / 500 | ≠ offline | 400 et 403 exercés live | PASS | S06-http-400, S06-http-403 |

### 12. Persistance

Pour chaque **mutation 2xx** de ce run (classe, inscription, GRANT/REVOKE, grille, paiements) : relire GET + SELECT PG = mêmes identifiants. Logout/login Admin : session recréée, données toujours en PG.

**Non prouvé sur device :** kill Expo, cold start, replay outbox. **BLOCKED.**

Échecs de persistance Appel = P1-RC0-03 (jamais écrit), pas un cache local fantôme.

---

## Tests automatisés rejoués sur ce SHA

Mobile (unit) : `offlineClassification`, `paymentRateKpi`, `networkResilience`, `mobileCrudParity`, `mobileCanonicalRoleIdentity`, `homeDashboardKpis`, `connectivity` — **OK**.

Backend : `financeUnallocatedMaeva`, `financeUnallocatedCash`, `financePaymentRateConsistency`, `criticalParityRbacCanonical` — **OK**.

RBAC live Comptable : **pas** `Élèves:READ` (volontaire). D’où le chantier suivant `payment-student-options` — **uniquement après P1 = 0**.

---

## PRs Draft (correctifs P1)

| Domaine | PR | Branche | Contenu |
| ------- | -- | ------- | ------- |
| Audit (cette PR) | [#327](https://github.com/Somafrik-education/Somafrik/pull/327) | `cursor/mobile-smoke-rc0-2a0f` | livrable smoke |
| Session Comptable | [#328](https://github.com/Somafrik-education/Somafrik/pull/328) | `cursor/p1-mobile-comptable-login-2a0f` | `managedMobileRoles.Comptable` + tests identify/login |
| Fiche élève | [#329](https://github.com/Somafrik-education/Somafrik/pull/329) | `cursor/p1-mobile-student-expected-updated-at-2a0f` | `expectedUpdatedAt` Mobile + OCC ms PG |
| Appel | [#330](https://github.com/Somafrik-education/Somafrik/pull/330) | `cursor/p1-mobile-attendance-teacher-key-2a0f` | `teacherId` si 1 affectation ; sinon refus UI |

### Retests live (agent, hors Android)

| Correctif | Preuve |
| --------- | ------ |
| P1-RC0-01 (code #328 chargé) | `POST /identify` Comptable → **200** `{role:accountant, roleLabel:Comptable}` ; `POST /login` → **200**, 5 permissions live |
| P1-RC0-02 (code #329) | PATCH sans jeton → 400 ; GET `updatedAt` + PATCH → **200** (`Lina` → `KabaseleX`) |
| P1-RC0-03 (contrat API) | Admin POST `/presences` sans `teacherId` → 409 ; **avec** `teacherId` enseignant de la classe → **201**, 4 lignes |
| Préfet classes | après `POST /auth/change-password` → GET `/classes` **200** n=1 (pas un P1 RBAC) |
| Planning Mobile | GET `/course-schedules` **200** n=0 |
| Finance A–F 1 élève / 1 000 FC | non rejoué isolé : `POST /classes` refuse le nom libre (`CLASS_FREE_TEXT_FORBIDDEN`). Contrat unitaire #326 inchangé. Premier FAIL = assiette 5 000 du harness |

CURSOR n’a **pas** l’autorisation Ready/merge. Après CI, STOP. Seul un diff GitHub indépendant CTO (`develop` exact vs HEAD exact) peut autoriser Ready.

---

## Chantier suivant (bloqué)

**Finance Comptable — projection minimale `payment-student-options`** : permettre au Comptable de choisir un élève pour un paiement **sans** module Élèves complet ni données personnelles inutiles.

Séquence officielle : **Smoke Mobile RC0 → P0/P1 = 0 → Finance Comptable → parité Web/Mobile → APK préproduction.**

**NO-GO** tant que P1-RC0-01/02/03 ne sont pas corrigés et revus.
