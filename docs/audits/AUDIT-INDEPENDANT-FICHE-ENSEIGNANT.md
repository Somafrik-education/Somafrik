# Audit indépendant — TEACHER-RECORD-FULL-REVIEW

| Champ | Valeur |
|-------|--------|
| **ID** | `TEACHER-RECORD-FULL-REVIEW` |
| **Nature** | Audit indépendant — caractérisation uniquement |
| **Base** | `develop` @ `9dcf4ba1200f6cea10bf17fc097c073aa201e546` |
| **Date** | 2026-07-27 |
| **Méthode** | État réel du code / contrats / schéma / tests — **pas** les comptes rendus Cursor comme preuve |
| **Correctifs** | **NON AUTORISÉS** |
| **E1** | **NO-GO** |
| **Prochain sujet V2** | **SUSPENDU** jusqu’à décision CTO sur ce rapport |
| **Preuve machine** | [`evidence/independent-teacher-record-audit-results.json`](./evidence/independent-teacher-record-audit-results.json) |

> Rapport Cursor ≠ validation CTO. Ce document est une pièce d’audit pour décision CTO.

---

## 0. Verdict

| Objet | Verdict |
|-------|---------|
| **Fiche enseignant (cycle de vie complet)** | **GO SOUS RÉSERVES** |
| **E1 Bulletins** | **NO-GO** (gouvernance + dépendances fiche non closes) |
| **Voie 2 / correctifs fiche** | **SUSPENDUS** — attendre décision CTO |

### Motif du verdict

Le parcours **Web + backend** formalise un canon pédagogique `TEACHERS-*` (résolution déterministe, ambiguïté structurée `TEACHER_CANON_AMBIGUOUS`, conservation historique `TEACHER-*` sans auto-upgrade). Les tests unitaires backend de sync identité **passent** sur `develop`.

Cependant, l’audit indépendant constate des **anomalies CRITICAL / MAJOR** qui empêchent un GO franc sur toute la chaîne de vie :

1. Attribution notes / présences non-enseignant via `ORDER BY created_at LIMIT 1`
2. Désactivation pédagogique incomplète (`Suspendu` ≠ garde affectation ; sync écrase `Inactif` ; PG matérialise quasi-toujours `active`)
3. Mobile produit encore `TEACHER-*` (hors canon)
4. Skips d’ambiguïté / multi-twins **non remontés** au client PUT
5. Écarts Web ↔ backend ↔ scripts (rôle `"teacher"`, contacts-only E2E stale, ENS divergents)

---

## 1. Méthode & limites

### 1.1 Méthode appliquée

1. Inventaire des surfaces enseignant (schema, services, Web, Mobile, scripts, tests)
2. Lecture indépendante du code sur `develop`
3. Comparaison Web / backend / PostgreSQL / Mobile
4. Exécution des tests unitaires backend ciblés (preuve machine)
5. Recherche d’angles morts et scénarios manquants
6. Classification CONFIRMÉ / INFIRMÉ / INDÉTERMINÉ / DETTE DOCUMENTAIRE / ANOMALIE REPRODUCTIBLE

### 1.2 Limites

| Limite | Impact |
|--------|--------|
| PostgreSQL local indisponible dans l’environnement d’audit (`pg_isready` absent) | Pas de rejeu HTTP/PG live ; anomalies « reproductibles » caractérisées par code + tests unitaires |
| Preuves historiques V2 / hotfix | Conservées intactes ; **non** utilisées comme preuve de l’état actuel |
| Matrice RBAC runtime (rolePermissions custom) | Defaults lus dans le code ; élargissements Superadmin **INDÉTERMINÉS** sans dump live |

---

## 2. Cartographie producteurs / consommateurs

```
┌─────────────┐   promote / sync    ┌──────────────┐
│ contacts[]  │ ─────────────────►  │  teachers[]  │  (JSON BackOffice)
└─────────────┘                     └──────┬───────┘
┌─────────────┐   UserTeacherSync          │
│  users[]    │ ───────────────────────────┤
│ (Enseignant)│   canon TEACHERS-*         │
└─────────────┘                            ▼
┌─────────────┐                     ┌──────────────┐
│assignments[]│ ◄── teacherId ─────│  EntityPage  │ Web
└──────┬──────┘                     │ TeachersList │
       │                            └──────────────┘
       ▼
PUT /api/backoffice/state
  → mergeScoped + syncTeachersFromUserAccounts
  → saveBackOfficeState
  → syncPedagogyStaffDomainFromBackOffice
       │
       ▼
┌─────────────────┐   teacher_code    ┌──────────────────────┐
│ teachers (PG)   │ ◄────────────────│ materializeTeacher   │
│ user_id nullable│                  └──────────────────────┘
└────────┬────────┘
         │
         ├─► teacher_assignments (PG)  status forcé 'active'
         ├─► evaluations.teacher_id (UUID, nullable)
         └─► grades.teacher_id (UUID, NOT NULL)
```

| Producteur | Consommateur | Identifiant échangé |
|------------|--------------|---------------------|
| Web EntityPage create | `teachers[]` JSON | `TEACHERS-{uuid\|ts}` |
| Web / backend `userTeacherSync` | `teachers[]` | `TEACHERS-*` (canon) |
| Mobile `userTeacherSync` | `teachers[]` | **`TEACHER-*`** (legacy) |
| Contact promote (Web) | fiche + user | `TEACHERS-*` + `ENS-####` |
| `contactRegistrySync` (script) | fiche | `TEACHERS-*` + ENS format **divergent** |
| Matérialisation PG | `teachers.teacher_code` | id JSON stable |
| Évaluations JSON | `evaluations.teacher_id` PG | lookup exact `teacher_code` |
| Notes POST (non-enseignant) | `grades.teacher_id` | **fallback premier teacher école** |
| Authz notes enseignant | affectations BO/PG | `TEACHERS-*` **ou** `TEACHER-*` |

---

## 3. Matrice identité / compte / fiche / affectation / évaluation

| Concept | Store | Clé | Unicité | Tenant |
|---------|-------|-----|---------|--------|
| Compte | JSON `users[]` / PG `users` | `USERS-*` / `user_code` | UNIQUE global (PG) | `school_id` / `schoolCode` |
| Login enseignant | JSON | `ENS-####` | Soft, scopé école | `schoolCode` |
| Login public | JSON | `{SCHOOL}-ENS-####` | Convention | École |
| Fiche canon | JSON / `teachers.teacher_code` | `TEACHERS-*` | UNIQUE **global** PG | `school_id` NOT NULL |
| Jumeau historique | JSON / éventuellement PG | `TEACHER-*` | Idem si matérialisé | Idem |
| Liaison compte↔fiche | JSON `teacher.userId` / PG `teachers.user_id` | UUID / id user | user_id **nullable** | — |
| Affectation BO | `assignments[]` | `teacherId` + classe + matière | Gouvernance métier | `schoolCode` |
| Affectation PG | `teacher_assignments` | UUID composite UNIQUE | Année courante | `school_id` |
| Évaluation JSON | `evaluations[]` | `teacherId` (code) | — | `schoolCode` |
| Évaluation PG | `evaluations` | `teacher_id` UUID nullable | — | `school_id` |
| Note JSON | `notes[]` | `authorId` (souvent user/SYSTEM) | — | — |
| Note PG (read) | `grades` | `authorId ← teacher_code` | `teacher_id` NOT NULL | `school_id` |

---

## 4. Questions d’audit obligatoires

| # | Question | Statut | Synthèse |
|---|----------|--------|----------|
| Q1 | Un seul canon `TEACHERS-*` pour chaque nouveau compte enseignant + établissement ? | **CONFIRMÉ** (chemin Web/backend sync) | `upsertTeacherFromUser` crée un `TEACHERS-*` si aucune fiche liée ; réutilise le canon unique ; multi → erreur ou skip. **Réserve Mobile** : crée `TEACHER-*`. |
| Q2 | Fiche sans compte / compte sans fiche pédagogique ? | **CONFIRMÉ** (les deux possibles) | Schema `user_id` nullable ; contact peut créer fiche sans user ; sync PUT crée fiche depuis compte Enseignant. Matérialisation PG tente `ensurePgUserForBackOfficeTeacher`. |
| Q3 | Modifications Web et backend : mêmes règles ? | **INFIRMÉ** (écarts confirmés) | Alignés : âge ≥ 18, canon TEACHERS, HIST-02. Écarts : `isTeacherUserRole("teacher")` Web oui / backend non ; suppression dépendances Web-only ; ambiguïté client toujours throw / serveur soft sur PUT étranger. |
| Q4 | Désactivation compte → capacités pédagogiques ? | **INFIRMÉ** (partiel) | Compte Suspendu bloque login. Fiche `Suspendu` **ne** bloque **pas** `validateAssignmentWrite` (seulement `inactif`/`archived`). Sync user→fiche force `Actif`/`Suspendu` et peut écraser `Inactif`. PG matérialise `active` sauf `archived`. |
| Q5 | Suppression / mutation → orphelins affectations / évaluations ? | **CONFIRMÉ** (risques) | UI bloque delete si dépendances. Script contact purge affectations orphelines, **pas** évaluations/notes. FK PG sans CASCADE. Mute `teacherId` → refs JSON mortes possibles. |
| Q6 | Changement d’établissement ? | **CONFIRMÉ** — refusé PG ; partiel JSON | `TEACHER_TENANT_CONFLICT` si même `teacher_code` autre école. Pas de transfert atomique. Super Admin peut muter `schoolCode` JSON → divergence possible. |
| Q7 | Plusieurs fiches légitimes (même école / multi-écoles) ? | **CONFIRMÉ** (possible) + **ANOMALIE** si multi `TEACHERS-*` même user+école | Multi-écoles : comptes/fiches séparés par `schoolCode`. Même école + même user + multi `TEACHERS-*` = ambiguïté structurée (ou skip). |
| Q8 | Affectations actives déterminent toujours le canon sans ambiguïté ? | **CONFIRMÉ** (règle) / **INFIRMÉ** (garantie) | Si exactement une fiche candidate a une affectation active → canon. 0 ou ≥2 → `TEACHER_CANON_AMBIGUOUS`. Donc **pas toujours**. |
| Q9 | Notes / évals nouvelles : même enseignant JSON et PG ? | **INFIRMÉ** | Évals : lookup exact code → UUID. Notes read : `authorId = teacher_code`. Notes write non-enseignant : fallback **premier teacher de l’école** (`created_at`). JSON `authorId` ≠ forcément PG `teacher_id`. |
| Q10 | Fallback historique peut encore autoriser via fiche qui ne devrait plus être active ? | **CONFIRMÉ** (risque) | Authz notes préfère fiche avec affectation parmi `TEACHERS-*` **et** `TEACHER-*`, sinon `candidates[0]` — **sans** filtre statut Actif/Suspendu/Inactif. |
| Q11 | Erreurs d’ambiguïté remontées à l’utilisateur ? | **PARTIEL / ANOMALIE** | Throw `TEACHER_CANON_AMBIGUOUS` → HTTP 409 + `code` si écriture liée. Skips (`…_SKIPPED_UNRELATED`, multi-twin, link ambiguous) **jamais** inclus dans la réponse PUT (`skips` ignorés dans `mergeScopedBackOfficeState`). |
| Q12 | Tests couvrent parcours UI réels ? | **INFIRMÉ** | Backend sync / attachment / authz notes : unitaires solides. Web : liste chrome + plans workflow ; **pas** de journey create/edit/delete. Mobile : **aucun** test. E2E 0006 / contacts-rules encore **contacts-only** alors que Web `entityCreateViaContactsOnly` → `false`. |

---

## 5. Constats détaillés (classés)

### C-01 — Canon `TEACHERS-*` sur sync Web/backend

| | |
|--|--|
| **Statut** | **CONFIRMÉ** |
| **Preuve** | `backend/services/userTeacherSyncService.js` L168–193, L340–347 ; `web/src/lib/userTeacherSync.ts` L7–12, L59+ ; tests `userTeacherSyncService.test.js` OK |
| **Sévérité** | — |

### C-02 — Conservation historique `TEACHER-*` (AC-HIST-02)

| | |
|--|--|
| **Statut** | **CONFIRMÉ** |
| **Preuve** | Twin seul → update conservatrice, pas de création `TEACHERS-*` ; multi-twins → noop `TEACHER_HISTORICAL_MULTI_TWIN` |
| **Sévérité** | — (dette historique **active** par design) |

### C-03 — Fiche sans compte et compte sans fiche

| | |
|--|--|
| **Statut** | **CONFIRMÉ** |
| **Preuve** | `schema.sql` L144 `user_id` nullable ; contact / EntityPage create ; sync crée fiche depuis user |
| **Sévérité** | INFORMATION (modèle dual volontaire) |

### C-04 — Mobile crée encore `TEACHER-*`

| | |
|--|--|
| **Statut** | **ANOMALIE REPRODUCTIBLE** |
| **Preuve** | `Mobile/src/lib/userTeacherSync.ts` L13–15 `newTeacherId → TEACHER-…` ; pas de résolution canon / ambiguïté |
| **Sévérité** | **CRITICAL** |
| **Impact** | Divergence multi-surface ; nouveaux jumeaux hors canon ; authz notes peut rattacher via twin |

### C-05 — `findTeacherForGrade` / attendance fallback `ORDER BY created_at`

| | |
|--|--|
| **Statut** | **ANOMALIE REPRODUCTIBLE** |
| **Preuve** | `postgresRepository.js` L4363–4366, L4394 ; même pattern seed notes |
| **Sévérité** | **CRITICAL** |
| **Impact** | Admin/direction peut attribuer notes/présences au **mauvais** enseignant de l’école |

### C-06 — Désactivation pédagogique incomplète

| | |
|--|--|
| **Statut** | **ANOMALIE REPRODUCTIBLE** |
| **Preuve** | `dataIntegrityRules.js` L418–420 (`inactif`/`archived` seulement) ; `buildTeacherFromUser` L256 force Actif/Suspendu ; matérialisation L2240 `archived ? archived : active` |
| **Sévérité** | **CRITICAL** |
| **Impact** | Compte ou fiche « suspendu » ≠ coupure des capacités d’affectation / matérialisation active PG |

### C-07 — Skips sync non exposés au client

| | |
|--|--|
| **Statut** | **ANOMALIE REPRODUCTIBLE** |
| **Preuve** | `server.js` L2868–2869 consomme `teachers`/`contacts` uniquement ; `skips` non propagés ; réponse PUT expose `syncAck` PG mais pas skips identité |
| **Sévérité** | **MAJOR** |
| **Impact** | Ambiguïté « PUT étranger » et multi-twins silencieux côté UI |

### C-08 — Affectations PG toujours `active`

| | |
|--|--|
| **Statut** | **ANOMALIE REPRODUCTIBLE** |
| **Preuve** | `postgresRepository.js` L2336–2341 INSERT/UPDATE `status = 'active'` |
| **Sévérité** | **MAJOR** |
| **Impact** | Pas de miroir inactif BO → PG ; authz PG basée sur `ta.status = 'active'` peut rester ouverte |

### C-09 — Isolation tenant défendue, frein UNIQUE global

| | |
|--|--|
| **Statut** | **CONFIRMÉ** (défenses) + **DETTE DOCUMENTAIRE** (UNIQUE global) |
| **Preuve** | `TEACHER_TENANT_CONFLICT` L2248–2253 ; scope schoolCode ; `teacher_code UNIQUE` global schema L145 |
| **Sévérité** | MAJOR (dette modèle) |

### C-10 — Écart `isTeacherUserRole`

| | |
|--|--|
| **Statut** | **ANOMALIE REPRODUCTIBLE** |
| **Preuve** | Web/Mobile acceptent `"teacher"` ; backend L32–34 : `enseignant` \|\| includes `prof` seulement |
| **Sévérité** | **MAJOR** |
| **Impact** | Compte rôle exact `teacher` : fiche syncée côté client, **ignorée** au merge serveur |

### C-11 — Création directe Web ouverte ; E2E contacts-only stale

| | |
|--|--|
| **Statut** | **CONFIRMÉ** (Web) / **DETTE DOCUMENTAIRE** (tests E2E) |
| **Preuve** | `entityModules.ts` L45–51 `entityCreateViaContactsOnly → false` ; `scripts/e2e-contacts-rules.js` L7–12 encore contacts-only |
| **Sévérité** | **MAJOR** (confiance tests) |

### C-12 — Suppression : garde UI sans équivalent intégrité backend

| | |
|--|--|
| **Statut** | **CONFIRMÉ** |
| **Preuve** | `teacherRules.validateTeacherDeletion` Web ; pas d’équivalent dans `validateTeacherWrite` / dataIntegrity |
| **Sévérité** | **MAJOR** |
| **Impact** | Client non-Web / PUT brut peut supprimer malgré dépendances |

### C-13 — `contactRegistrySync` hors chemin PUT + ENS divergent

| | |
|--|--|
| **Statut** | **DETTE DOCUMENTAIRE** / **INDÉTERMINÉ** (usage prod) |
| **Preuve** | `contactRegistrySync.js` L32–48 `ENS-{school}-{year}-###` + `teacher###` ; script dédié, absent du PUT state |
| **Sévérité** | MAJOR si script encore opéré ; INFORMATION sinon |

### C-14 — Authz notes : jumeau / fiche inactive

| | |
|--|--|
| **Statut** | **ANOMALIE REPRODUCTIBLE** (statique) |
| **Preuve** | `teacherNotesWriteAccess.js` L46–67 : candidats sans filtre statut ; préfère affectation puis `[0]` |
| **Sévérité** | **MAJOR** |
| **Impact** | Q10 — fallback historique peut autoriser via fiche non souhaitée |

### C-15 — Doublons fiche enseignant (identité civile)

| | |
|--|--|
| **Statut** | **CONFIRMÉ** (absence de garde) |
| **Preuve** | Pas de validate duplicate name+prenom+naissance sur module teachers Web/backend |
| **Sévérité** | **MINOR** |

### C-16 — RBAC defaults Admin / Direction / Enseignant

| | |
|--|--|
| **Statut** | **CONFIRMÉ** (defaults code) |
| **Preuve** | Admin School : CRUD enseignants sans DELETE par défaut + enforce serveur ; Direction lecture ; Enseignant pas de CRUD fiche ; Mobile school_admin UPDATE teachers **bloqué** |
| **Sévérité** | INFORMATION (écart Mobile volontairement plus strict) |

---

## 6. Scénarios nominaux et négatifs

### Nominaux (comportement attendu observé dans le code)

| ID | Scénario | Résultat attendu (code) |
|----|----------|-------------------------|
| N1 | Créer enseignant Web (Ajouter) | `TEACHERS-*` + ENS ; âge ≥ 18 si entryDate |
| N2 | Créer compte rôle Enseignant + PUT | Sync crée/maj fiche `TEACHERS-*` |
| N3 | Twin historique seul `TEACHER-*` | Update conservatrice, pas d’auto-`TEACHERS-*` |
| N4 | Une affectation active départage 2 `TEACHERS-*` | Canon = fiche affectée |
| N5 | Éval avec `teacherId` exact connu | `evaluations.teacher_id` résolu ; sinon `EVAL_TEACHER_UNRESOLVED` |
| N6 | Admin School delete enseignant sans grant | Refus UI + `enforceSchoolAdminTeachers` |
| N7 | Affectation autre école | Refus intégrité |

### Négatifs / angles morts

| ID | Scénario | Comportement réel | Classe |
|----|----------|-------------------|--------|
| X1 | Multi `TEACHERS-*` sans affectation unique + PUT users/teachers | 409 `TEACHER_CANON_AMBIGUOUS` | CONFIRMÉ |
| X2 | Même ambiguïté + PUT non lié | Skip silencieux | ANOMALIE |
| X3 | Fiche status `Suspendu` + nouvelle affectation | **Acceptée** (garde = inactif seulement) | ANOMALIE |
| X4 | User Actif après fiche `Inactif` manuelle | Sync remet `Actif` | ANOMALIE |
| X5 | Note admin sans teacherCode match | Premier teacher `created_at` | ANOMALIE |
| X6 | Mobile sync user enseignant | Crée/maj `TEACHER-*` | ANOMALIE |
| X7 | Rôle user exact `teacher` | Client sync / serveur ignore | ANOMALIE |
| X8 | DELETE teacher via API sans passer UI | Pas de validateTeacherDeletion | ANOMALIE |
| X9 | Transfert école même teacher_code | 409 PG ; JSON peut diverger | CONFIRMÉ |
| X10 | Purge contact registry | Affectations nettoyées ; évals/notes orphelines possibles | CONFIRMÉ |

---

## 7. Écarts contrat ↔ implémentation

| Attendu (contrat / intention FIX V2.1 / commentaires) | Implémentation réelle | Écart |
|-------------------------------------------------------|----------------------|-------|
| Canon unique `TEACHERS-*` multi-surface | Mobile encore `TEACHER-*` | **Oui** |
| Ambiguïté structurée visible | Throw OK ; skips invisibles | **Partiel** |
| Pas de choix silencieux `created_at` (identité) | Respecté en sync identité ; **violé** en notes/présences admin | **Oui** |
| Contacts-only création (E2E / commentaires EntityPage) | Web : création directe ouverte | **Oui** (contrat tests obsolète) |
| Désactivation → plus d’affectation | Seulement `inactif`/`archived` | **Oui** |
| JSON ↔ PG convergence statut affectation | PG forcé `active` | **Oui** |

---

## 8. Dettes historiques encore actives

| Dette | État sur develop |
|-------|------------------|
| Jumeaux `TEACHER-*` | Conservés ; pas d’auto-fusion ; dédup refuse merge via ENS |
| Multi-match temporaire via affectation | Actif (§4.1) |
| Dual-store JSON + PG | Actif ; SoT opérationnelle encore largement JSON BO pour authz notes |
| `contactRegistrySync` script | Présent ; hors PUT |
| UNIQUE `teacher_code` global | Actif — freine multi-tenant / transfert |
| Fallback BO authz notes (historique hotfix) | Hors périmètre re-preuve ici ; surface toujours dans `teacherNotesWriteAccess` |

---

## 9. Risques pour E1

| Risque E1 | Lien fiche enseignant | Sévérité |
|-----------|----------------------|----------|
| Auteur / enseignant de note incorrect | Fallback `created_at` + dual authorId | **BLOCKER** pour fiabilité bulletins |
| Canon ambigu non vu par l’opérateur | Skips silencieux | **CRITICAL** |
| Jumeaux Mobile / historique dans agrégats | `TEACHER-*` encore productible | **CRITICAL** |
| Affectation « active » PG fantôme | Status forcé active | **MAJOR** |
| Isolation / transfert école | Conflit code global | **MAJOR** |
| Couverture tests ≠ parcours UI | Fausse confiance avant E1 | **MAJOR** |

**Conclusion E1 :** **NO-GO** — la fiche enseignant n’est pas un socle suffisamment déterministe pour des bulletins fiables.

---

## 10. Preuves tests exécutées (environnement audit)

```
node --test \
  backend/services/userTeacherSyncService.test.js \
  backend/lib/backofficeDedupe.teachers.test.js \
  backend/lib/evaluationAttachment.test.js \
  backend/lib/teacherNotesWriteAccess.test.js \
  backend/lib/pedagogyStaffBoPersistence.test.js
→ 5/5 pass (2026-07-27, develop @ 9dcf4ba)
```

Ces tests **confirment** le comportement unitaire sync/attachment ; ils **ne couvrent pas** les anomalies C-05, C-06, C-07, C-08, C-04 (Mobile), ni les journeys UI.

---

## 11. Gouvernance (rappel, non modifié par cet audit)

| Élément | Statut |
|---------|--------|
| Prochain sujet V2 | **SUSPENDU** |
| Correctif fiche enseignant | **NON AUTORISÉ** (sans aval CTO post-rapport) |
| Refactor / migration jumeaux | **NON AUTORISÉ** |
| Modification preuves historiques | **INTERDITE** |
| E1 | **NO-GO** |

---

## 12. Décision attendue du CTO

Options suggérées (hors exécution) :

1. **Accepter GO SOUS RÉSERVES** + prioriser un plan correctif minimal borné (C-05, C-06, C-04, C-07) avant toute reprise voie 2  
2. **Requalifier NO-GO fiche** si Mobile ou attribution notes sont considérés bloquants absolus  
3. **Demander caractérisation live PG** (environnement avec base) pour C-05 / C-08 avant arbitrage sévérité finale  

Aucun correctif n’est proposé en patch dans ce lot — conformément à la gouvernance d’audit.
