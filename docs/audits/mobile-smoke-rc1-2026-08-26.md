# Smoke Mobile RC1 — 2026-08-26

**Dépôt :** `Somafrik-education/Somafrik`  
**Baseline obligatoire :** `develop = 8d92d6399c3eab9b3c347d0dc7fe85857e9cf391` (merge #338)  
**Branche audit :** `cursor/mobile-smoke-rc1-2026-08-26-9855`  
**Mode :** AUDIT / SMOKE uniquement. Aucune correction produit silencieuse.  
**PR :** Draft uniquement. Aucun Ready. Aucun merge.

Preuve brute HTTP : [`docs/audits/evidence/mobile-smoke-rc1-2026-08-26.json`](./evidence/mobile-smoke-rc1-2026-08-26.json)  
Harness (rejeu, pas un correctif métier) : [`docs/audits/evidence/run-mobile-smoke-rc1-2026-08-26.js`](./evidence/run-mobile-smoke-rc1-2026-08-26.js)

Référence RC0 : [`docs/audits/mobile-smoke-rc0-2026-08-25.md`](./mobile-smoke-rc0-2026-08-25.md)

---

## Décision gate

| | |
| --- | --- |
| **P0 ouverts** | **0** |
| **P1 produit HTTP** | **0** (régressions #328 / #329 / #330 rejouées **PASS**) |
| **P1 UX #338 device** | **BLOCKED** — Android réel non exécuté |
| **P2 / P3** | libellé finance A ; HTTP 404 vs 409 sur obligation incohérente ; planning lecture vide |
| **GO / NO-GO** | **RC1 NO-GO** |

Le mandat n’autorise **RC1 GO** que si P0 = 0, P1 = 0, **et** Android réel PASS (connexion #338, logins, CRUD, avion → kill Expo → relaunch → replay outbox). Cursor cloud n’a pas d’appareil. La section **ANDROID DEVICE UAT** reste **BLOCKED**.

Le chemin HTTP/PostgreSQL automatisable est **PASS** (93 PASS / 0 FAIL / 1 SKIP / 1 BLOCKED / 5 INFO). Ce n’est **pas** un GO.

`GET /api/finance/payment-student-options` **n’a pas été créé** et n’est **pas** classé P1 RC1.

---

## SHA / environnement

| Élément | Valeur |
| ------- | ------ |
| SHA `develop` testé | `8d92d6399c3eab9b3c347d0dc7fe85857e9cf391` |
| `GET /api/health` | `{"status":"ok","database":"postgresql"}` |
| PostgreSQL | local 16, `SOMAFRIK_DB_REQUIRED=true`, `SOMAFRIK_SKIP_DEMO_SEED=true` |
| Seed démo / `backoffice_state` | non utilisés ; PostgreSQL = vérité |
| API | `http://127.0.0.1:5191/api` |
| Base | `somafrik_rc1_smoke` (dédiée RC1, pas réemploi RC0 `CD-ISR1-26-002`) |
| Generated at | `2026-08-26T02:35:13.946Z` (stamp `1787711713946`) |

---

## Établissements de preuve (dédiés RC1)

| | Interne | Login public | UUID |
| --- | ------- | ------------ | ---- |
| **A** | `SCH-B5CEED092CF946E0A08A` | `CD-ISRA1-26-001` | `037858ee-8106-4bb3-9b28-a281f65e575a` |
| **B** | `SCH-8D5FA05312F642AEAE77` | `CD-ISRB1-26-002` | `ffb7dc36-92f5-4e5f-9da6-2742450e4d96` |

Provisionnés sur A : Super Administrateur, Admin établissement, Préfet des études, 2 enseignants actifs, Comptable, Parent (login 200), 3 classes dont 2 homonymes `6ème`, 4 élèves + 1 homonyme, affectations, cours Mathématiques, type d’évaluation, évaluation, note, grille / paiements.

Identifiants (emails de test, sans secret) :

- Admin A : `admin-rc1-A-1787711713946@somafrik.test`
- Préfet : `prefet-rc1-1787711713946@somafrik.test`
- Comptable : `cpt-rc1-1787711713946@somafrik.test`
- Enseignant 1 : `ens1-rc1-1787711713946@somafrik.test` (`f80e1fe6-497e-45c2-b6f5-d67fe9b2cb37`)
- Enseignant 2 : `ens2-rc1-1787711713946@somafrik.test` (`108ba4fb-01fb-47f0-a98e-c7cf68726ad2`)
- Élève 1 : `CD-ISRA1-KL-26-00001`

---

## RC0 regression → RC1 result

| RC0 regression | Correctif | RC0 | RC1 |
| -------------- | --------- | --- | --- |
| P1-RC0-01 Comptable Mobile login | #328 | FAIL identify 403 / login 401 | **PASS** identify 200 `accountant` ; login 200 ; 5 perms live ; **pas** `Élèves:READ` ; `GET /api/students` **403** |
| P1-RC0-02 PATCH élève `expectedUpdatedAt` / OCC | #329 | FAIL 400 puis 409 µs | **PASS** sans jeton 400 ; PATCH avec T 200 ; stale 409 ; concurrent 200+409 ; nouveau token strictement supérieur |
| P1-RC0-03 Appel Admin `teacherId` | #330 | FAIL 409 `ATTENDANCE_TEACHER_UNRESOLVED` sans clé | **PASS** Admin sans clé → 409 ; avec `teacherId` affecté → 201, 4 lignes PG ; Enseignant session 201 sans id forgé |
| P1-UX-#338 connexion établissement responsive | #338 | hors RC0 (mergé dans ce SHA) | **statique/unit PASS** ; **DEVICE UAT BLOCKED** |

Les FAIL RC0 n’ont pas été transformés artificiellement en PASS : ils ont été **rejoués** contre le `develop` actuel.

---

## Classification

### P0 — aucun

Pas de fuite tenant, corruption, écriture mauvais établissement/élève, bypass RBAC, legacy autoritaire, crash, lost update, ni replay dupliqué observé sur le chemin HTTP.

- Isolation tenant : **PASS** (`n=0 leaked=false` ; domaines A invisibles depuis B ; PATCH élève A depuis B → **404**)
- Legacy : `PUT /api/backoffice/state` → **410** `BACKOFFICE_STATE_WRITE_REMOVED`
- OCC : A/B/C/D **PASS**

### P1 produit HTTP — aucun ouvert

Les trois P1 RC0 sont **PASS** après rejeu. Aucun nouveau P1 HTTP n’a été ouvert. Cursor n’a **pas** corrigé de défaut produit dans cette PR.

### BLOCKED (bloque GO, pas un P1 HTTP inventé)

| ID | Sévérité gate | Motif |
| -- | ------------- | ----- |
| S17-android-device-uat | **bloque RC1 GO** | Agent cloud sans téléphone. Checklist ci-dessous. |

### P2 (non bloquant HTTP)

| ID | Observation | Classification |
| -- | ----------- | -------------- |
| S08-A | Obligation sans paiement : `amountPaid=0` / `amountDue=1000` **OK**, statut UI `En retard` (dueDate = jour du smoke) plutôt que libellé « Non imputé » | P2 libellé |
| S08-D | `obligationId` incohérent → **404** `OBLIGATION_NOT_FOUND` (attendu mandat 409). Fail-closed, zéro effet secondaire | P2 code HTTP |
| S10-read-planning | `GET /course-schedules` **200** `n=0` (aucun créneau POSTé ; cours canonique existe). Pas un FAIL legacy `/planning/weekly` | P2 couverture harness |

### SKIP / INFO

| ID | Verdict | Lecture |
| -- | ------- | ------- |
| S01-student-login | SKIP | Inscription produit un matricule ; le login élève avec mot de passe staff → 401. Compte Mobile élève non exposé par l’enroll. |
| S08-payment-student-options | INFO | Hors périmètre RC1. Non créé. Non noté P1. |
| S10-legacy-weekly | INFO | 404 — n’est **pas** le contrat Mobile. |
| S01-teacher-classes-after-password | PASS | **403** : TEACHER n’a pas `Classes:READ` live. Pas un P1. |
| S07-note-before-validate | PASS | 409 `EVALUATION_NOT_VALIDATED` attendu. |
| S07-admin-note-unresolved | PASS | 409 `GRADE_TEACHER_UNRESOLVED` — même contrat que l’appel Admin. Saisie Mobile = session Enseignant **201**. |

---

## Scénarios exécutés

Légende : **PASS** / **FAIL** / **BLOCKED** / **SKIP** / **INFO**.

### 0–2. Santé, établissement, #338 (hors device)

| ID | Attendu | Obtenu | Verdict |
| -- | ------- | ------ | ------- |
| S00-health | `ok` + `postgresql` | 200 ok postgresql | PASS |
| S01-create-school / S16-create-school-b | 2 établissements dédiés | `CD-ISRA1-26-001` / `CD-ISRB1-26-002` | PASS |
| S05-school-lookup-ok | bon code | 200 | PASS |
| S05-school-lookup-bad | mauvais code | 404 `Code etablissement invalide` | PASS |
| S05-ux-338-static | code initial vide, pas de hardcode RC0, Vérifier + Ouvrir | empty / noHardcode / verify / open = true | PASS |
| S05-ux-338-layout-unit | `roleSelectionLayout.test.ts` | OK | PASS |
| S17-android-device-uat | preuve téléphone | non exécuté | **BLOCKED** |

Aucun code d’établissement de test n’est hardcodé dans l’écran de connexion.

### 4. Auth / session — rôles

| Rôle | identify | login | perms | refresh / logout / relogin | Notes |
| ---- | -------- | ----- | ----- | -------------------------- | ----- |
| SUPERADMIN Web | — | 200 | — | — | `POST /backoffice/login` |
| ADMIN SCHOOL Web + Mobile | 200 `school_admin` | 200, 84 perms live | pas `ALL_PRIVILEGES` | 200 / 200 / 200 | Backend RBAC autoritaire |
| PREFET Mobile | 200 `prefet` | 200, 28 perms, `mustChangePassword` | — | gate 403 puis change-password 200 ; GET classes **200** | |
| TEACHER Mobile | 200 `teacher` | 200, 12 perms, `mustChangePassword` | — | GET classes **403** (`Classes:READ` absent — live) | |
| ACCOUNTANT Mobile | 200 `accountant` | **200** (P1-RC0-01) | 5 live, **sans** `Élèves:READ` | GET `/students` **403** | Ne pas ajouter Élèves:READ pour « faire passer » |
| PARENT Mobile | — | 200 `parent_student`, 4 perms | pas d’expansion | — | |
| STUDENT Mobile | — | 401 | — | SKIP | compte non provisionné par enroll |

### 5. Utilisateurs / rôles

GRANT/REVOKE Enseignant, Préfet, Comptable : **PASS**. `user_roles` PG autoritaire. Login après GRANT 200 ; après REVOKE 401. Aucune règle « Admin = tout ». `POST /teachers` direct → **403** `TEACHER_IDENTITY_MUST_COME_FROM_USERS` (contrat actuel, pas une régression).

### 6. Classes

CREATE / READ / PATCH / persist / PG count=3 : **PASS**. Deux classes homonymes `6ème`, IDs/codes distincts (`916b5c8e-…` vs `cf91de7e-…`). `classId` / `classCode` canoniques. Archive/delete non exercé (hors CREATE/PATCH actuel).

### 7. Élèves + OCC #329

4 inscriptions 201. Homonyme 201 (unicité = matricule). Champs obligatoires 400. Isolation tenant PASS.

| Cas OCC | Attendu | Obtenu | Verdict |
| ------- | ------- | ------ | ------- |
| jeton manquant | 400 | 400 `expectedUpdatedAt` | PASS |
| A PATCH avec T | 200 | 200 | PASS |
| B T stale | 409 | 409 conflit | PASS |
| C deux PATCH même T | 1×200 + 1×409 | `200,409` | PASS |
| D token JSON ms > précédent | strictement supérieur | `02:35:24.280Z` → `02:35:24.295Z` | PASS |

JSON `updatedAt` aligné sur PG timestamptz (INFO `S03-occ-tokens`).

### 8. Enseignants / affectations

Liste n=3. Affectations t1 (Math classe A) + t2 (classe homonyme) **201**. Lecture après reload **PASS**. Identité via Utilisateurs + GRANT.

RBAC observé : TEACHER sans `Classes:READ` ; PREFET `Classes:READ` après change-password. Affectations: CRUD Préfet / READ Enseignant : le smoke a exercé Admin + enregistrement Enseignant ; pas de hard-deny Mobile inventé.

### 9. Appel / présences — #330

| Cas | Attendu | Obtenu | Verdict |
| --- | ------- | ------ | ------- |
| A Enseignant connecté, classe affectée, pas d’id forgé | 201 + PG | 201 | PASS |
| Admin 0 clé / unresolved (HTTP CAS B/D) | 409 explicite | 409 `ATTENDANCE_TEACHER_UNRESOLVED` | PASS |
| Admin + `teacherId` affecté (sélection valide) | 201 | 201, PG n=4 | PASS |
| Double tap même Idempotency-Key | pas de doublon | 201/201, PG toujours 4 | PASS |
| Reload | 200 | n=4 | PASS |
| Enseignant hors classe / homonyme | refus | 403 `STUDENT_NOT_ENROLLED` | PASS |
| Classe vide (élève d’une autre classe) | blocage | 403 `STUDENT_NOT_ENROLLED` | PASS |

**CAS C HTTP isolé (1 seul enseignant actif → auto-sélection)** : non isolé dans ce run (2 enseignants actifs). Côté API, un principal Admin **exige toujours** une clé explicite (409 sinon). L’auto-sélection UI #330 est un comportement **Mobile device**, donc **DEVICE UAT**.

Enseignant autre tenant : lecture B `att=0` ; pas de mutation A depuis B.

### 10. Évaluations / notes

Cours canonique `SCH-B5CEED092CF946E0A08A-CRS-0001` (`schoolCourseId` UUID). Type `devoir_rc1` créé (catalogue vide hors seed démo). Éval **201**. Liste Admin + Enseignant **200 n=1**. Enseignant ne peut pas PATCH `Validée` (**403** `EVALUATION_VALIDATION_FORBIDDEN`). Admin valide **200**. Note Enseignant **201**, PG `grades` count=1. Pas de `/planning/weekly`.

### 11. Finance existante (pas `payment-student-options`)

| Cas | Obtenu | Verdict |
| --- | ------ | ------- |
| A aucune allocation | due=1000 paid=0 balance=1000 | PASS montants ; P2 libellé `En retard` |
| B partiel 200 | 201 `Partiel` allocated=200 remaining=800 | PASS |
| C complet | 201 | PASS |
| D obligation incohérente | **404** `OBLIGATION_NOT_FOUND` | PASS fail-closed ; P2 vs 409 |
| E annulation | 200 | PASS |
| ACCOUNTANT `/api/students` | 403 least privilege | PASS |

### 12. Planning

`GET /course-schedules` **200** (contrat Mobile). `GET /planning/weekly` 404 INFO. Aucun créneau POSTé (`n=0`). Cours + classe + enseignant existent.

### 13. Network resilience (#325)

Unit `offlineClassification` + `verify:mobile-network-resilience` **PASS**. Live 4xx (`Présence invalide` 400, `PERMISSION_DENIED` 403, OCC 409) **non** classés hors-connexion. Timeout / 5xx / backend down **device** : checklist Android.

### 14. Legacy fail-closed

`PUT /api/backoffice/state` → **410**. Aucun flux smoke ne lit/écrit `backoffice_state`.

### 15. Isolation tenant — GATE P0

A vs B : classes / students / teachers / assignments / attendance / evaluations / payments → **0 fuite**. PATCH élève A depuis B → **404**.

---

## ANDROID DEVICE UAT

**Statut : BLOCKED** — Cursor cloud n’invente pas ce résultat. Le CTO exécute sur téléphone Android réel (Expo).

### Checklist exacte

#### A. Connexion établissement #338

- [ ] Écran responsive
- [ ] Champ code visible
- [ ] **Vérifier** visible
- [ ] Après validation : établissement + code + **Ouvrir la connexion** visibles **sans scroll manuel normal**
- [ ] Code initialement vide (pas de hardcode)
- [ ] Mauvais code → erreur correcte
- [ ] Bon code → bon établissement ; mauvais tenant impossible

#### B. Login réel

- [ ] Admin
- [ ] Préfet
- [ ] Enseignant
- [ ] Comptable

#### C. CRUD / navigation

- [ ] Classe
- [ ] Élève
- [ ] Enseignant
- [ ] Appel
- [ ] Notes
- [ ] Paiements

#### D. OFFLINE CRITIQUE (obligatoire)

1. Connecté en Wi-Fi
2. Préparer une mutation compatible outbox
3. Activer le mode avion
4. Effectuer l’action
5. Confirmer le comportement offline attendu
6. Tuer complètement Expo / l’app
7. Relancer **toujours hors ligne**
8. Confirmer outbox persistante
9. Réactiver le réseau
10. Replay
11. Vérifier serveur / PostgreSQL
12. Confirmer l’absence de doublon

#### E. Erreurs réseau

- [ ] Backend indisponible — distinct du vrai offline
- [ ] Timeout — distinct du vrai offline
- [ ] HTTP 4xx — distinct du vrai offline
- [ ] HTTP 5xx — distinct du vrai offline

Tant que cette section n’est pas **PASS** par le CTO, le rapport reste **RC1 NO-GO**.

---

## Bloqueurs RC1 GO

1. **ANDROID DEVICE UAT** (A–E) non exécuté.
2. En particulier le scénario **mode avion → kill Expo → relaunch hors ligne → reconnexion → replay outbox**.

Non-bloqueurs HTTP (documentés, non corrigés ici) : P2 S08-A libellé, P2 S08-D 404 vs 409, planning `n=0`, login élève SKIP.

---

## PR Gates

PR **Draft**. Fichiers uniquement sous `docs/audits/**` (pas `scripts/`, pas `Mobile/`, pas `backend/`). Scope attendu : `code=false` → Quality / lint / typecheck / build **skippés**. Job **Secrets** (gitleaks) applicable. Aucun gate lourd ajouté au workflow pour ce smoke. Les contrôles lourds (harness RC1 contre PostgreSQL, `verify:mobile-network-resilience`) ont été exécutés **manuellement** et sont dans le JSON.

---

## Working tree / git (attendu après push)

| | |
| --- | --- |
| Base | `develop` `8d92d6399c3eab9b3c347d0dc7fe85857e9cf391` |
| Branche | `cursor/mobile-smoke-rc1-2026-08-26-9855` |
| Contenu | docs audit + harness + evidence JSON |
| Ready | **interdit** |
| Merge | **interdit** |

CURSOR n’a **pas** l’autorisation Ready/merge. Après CI, STOP. Seul un nouveau diff GitHub indépendant effectué par le CTO entre le `develop` courant exact et le `HEAD` exact peut déclencher une autorisation Ready/merge.

---

## Chantier suivant (toujours bloqué)

**Finance Comptable `payment-student-options`** : n’ouvre **pas** tant que ce gate RC1 n’est pas clôturé (Android réel + GO CTO).
