# Contrat d’implémentation — FIX V2.1 IDENTITY (`PRE-E1-IDENTITY-LIFECYCLE`)

**Type :** contrat d’implémentation — **aucun code dans cette PR**  
**Cadrage validé :** [`PLAN-CORRECTIF-MINIMAL-PRE-E1-V2-IDENTITY-LIFECYCLE.md`](./PLAN-CORRECTIF-MINIMAL-PRE-E1-V2-IDENTITY-LIFECYCLE.md) (PR #97 · `0644442a`)  
**Option CTO :** **Hybride A+C bornée**  
**Anomalie :** MAJOR CONFIRMÉE — revalidation CTO  
**Statut :** en attente de **validation CTO explicite** avant toute PR de code  

| Élément | Statut |
|---------|--------|
| Implémentation | **INTERDITE** jusqu’à aval CTO de **ce** contrat |
| Migration / backfill / DELETE jumeaux | **INTERDITS** |
| E1 | **NO-GO** |
| HOTFIX-01/02/02B | **CLOS** |
| Preuves brutes #95/#96 | **Lecture seule** |

---

## 1. Objectif du lot minimal (un seul gate)

Après correctif, pour **toute nouvelle** création / sync nominale :

1. **Un** compte enseignant (`users` / JWT) ↔ **une** identité pédagogique canonique **`TEACHERS-*`**.  
2. Lien explicite via **`teachers.user_id`** (PG) + `userId` (JSON), scopé établissement.  
3. `assignment.teacherId` · `teacher_assignments` · `evaluation.teacherId` JSON · `evaluations.teacher_id` PG résolvent **tous** vers le même `TEACHERS-*`.  
4. **Aucun** nouveau jumeau `TEACHER-*` créé par le flux contact+user / sync.  
5. Identités **historiques** inchangées ; authz multi-fiches **conservée uniquement** pour l’historique.

Critères **AC-NEW-01…04** = **un seul gate fonctionnel** (non séparables).

---

## 2. Fichiers et fonctions précisément concernés

### 2.1 Obligatoires (lot minimal)

| Fichier | Symboles / zones | Rôle |
|---------|------------------|------|
| `backend/services/userTeacherSyncService.js` | `buildTeacherFromUser`, `upsertTeacherFromUser`, `syncTeachersFromUserAccounts`, `teacherMatchesUser` | **Cause racine backend** : aujourd’hui `id: TEACHER-${Date.now()}` |
| `backend/server.js` | Merge `PUT /api/backoffice/state` — appel `userTeacherSyncService.syncTeachersFromUserAccounts` (~L2841+) | Point d’entrée sync serveur |
| `web/src/lib/userTeacherSync.ts` | `newTeacherId`, `buildTeacherRow`, `upsertTeacherFromUser`, `syncSingleUserToTeachers` | Client : génère déjà `TEACHERS-*` — **aligner règles de réutilisation** avec le backend |
| `web/src/pages/entity-page/contactAccountWorkflow.ts` | appels `syncSingleUserToTeachers` | Parcours contact+compte |
| `backend/lib/pedagogyStaffBoPersistence.js` | `resolveStableTeacherCode` | Conserver préférence `TEACHERS-*` (02B) |
| `backend/db/postgresRepository.js` | `materializeBackOfficeTeacher`, `ensurePgUserForBackOfficeTeacher`, deps `ensureTeacher` / `findTeacherByCode` / `findTeacherByAssignment` / **`findAnyTeacher`** (évaluation) | Matérialisation PG + résolution `evaluations.teacher_id` |
| `backend/lib/evaluationAttachment.js` | `resolveEvaluationAttachments` (bloc teacher ~L100–120) | Chaîne de résolution enseignant pour eval |

### 2.2 Probables / à confirmer en revue de diff (toujours dans le lot si touchés)

| Fichier | Motif |
|---------|-------|
| `backend/lib/teacherNotesWriteAccess.js` | `resolveTeacherRecord` — préférer canon `TEACHERS-*` pour **nouvelles** sessions sans casser multi-match historique |
| `web/src/lib/pedagogySync.ts` / `EntityPage.tsx` | Création fiche pédagogique — réutiliser fiche liée `userId` |
| Tests : `backend/lib/pedagogyStaffSyncRepository.test.js`, `backofficeDedupe.teachers.test.js`, tests `userTeacherSync` | Non-régression |

### 2.3 Explicitement hors touch (premier lot)

| Zone | Motif |
|------|-------|
| Migrations SQL / `UNIQUE(school_id, user_id)` | Différé CTO |
| Nouvelle table `user_teacher_link` / champ `canonicalTeacherId` | Différé |
| Backfill `evaluations.teacher_id` / rewrite assignments | Migration interdite |
| `backend/lib/backofficeDedupe.js` logique non-fusion historique | Ne pas « fusionner » l’historique ; optionnel : ne pas créer de nouveaux jumeaux en amont |
| Suppression fallback authz BO | Hors scope |
| Mobile (sauf si écriture teachers miroir découverte) | Hors scope initial ; documenter si écart |

---

## 3. Comportement avant / après — `UserTeacherSyncService`

### 3.1 Avant (constat)

```text
upsertTeacherFromUser(user Enseignant) :
  si aucune fiche match (userId / identifier)
    → crée id = "TEACHER-" + Date.now()     // préfixe NON canonique
  sinon met à jour la fiche matchée
```

Effet observé (V2.1 ID-04A) : après PUT contact+user, présence d’un `TEACHER-*` **avant** toute fiche pédagogique `TEACHERS-*`.

Le **web** (`userTeacherSync.ts`) crée déjà `TEACHERS-*` via `newTeacherId()`.  
Le **backend** recrée / ajoute un `TEACHER-*` au merge state → **double source**.

### 3.2 Après (comportement contractuel)

Pour un user rôle enseignant, école `S`, à la sync :

| Cas | Comportement requis |
|-----|---------------------|
| Existe déjà une fiche `TEACHERS-*` liée (`userId` = user **ou** même `identifier` + même `schoolCode`) | **Réutiliser** cette fiche — **ne pas** créer de nouvelle |
| Existe seulement un jumeau historique `TEACHER-*` lié au user | **Ne pas** le supprimer ; pour **nouvelle** identité pédagogique manquante : créer **`TEACHERS-*`** et y poser `userId` ; **ne pas** créer un second `TEACHER-*` |
| Aucune fiche liée | Créer **une** fiche `id = TEACHERS-<uuid|stamp>`, `userId = user.id`, `schoolCode = S` |
| Fiche `TEACHERS-*` d’un **autre** user | Ne pas réutiliser (isolation) |

**Interdit après correctif :**

- `id` commençant par `TEACHER-` **sans** `S` (i.e. non `TEACHERS-`) pour toute **nouvelle** création issue du sync user.  
- Créer un `TEACHER-*` « parallèle » alors qu’un `TEACHERS-*` lié au compte existe.

### 3.3 Alignement web ↔ backend

| Couche | Règle |
|--------|-------|
| Web `newTeacherId()` | Conserver préfixe `TEACHERS-*` |
| Backend `buildTeacherFromUser` | **Même** convention `TEACHERS-*` + mêmes règles de match / réutilisation |
| Match | Priorité : `userId` exact → sinon `identifier` + `schoolCode` ; parmi plusieurs matchs, préférer `TEACHERS-*` |

---

## 4. Règle de réutilisation de `TEACHERS-*`

### 4.1 Définition du canon

```text
canonicalTeacherId(user, school) =
  teachers[] row where
    schoolCode = school
    AND userId = user.id
    AND id matches /^TEACHERS-/i
  (si plusieurs : la plus ancienne stable / celle référencée par une assignment active — à fixer en implémentation de façon déterministe et testée)
```

Lien PG : row `teachers` avec `teacher_code = canonicalTeacherId`, `user_id` = UUID user PG, `school_id` = établissement.

### 4.2 Création pédagogique / affectations

| Action UI / API | Règle |
|-----------------|-------|
| Créer enseignant + compte | Une seule fiche `TEACHERS-*` ; assignments pointent dessus |
| Ajouter affectation | `assignment.teacherId = canonicalTeacherId` |
| Sync PG assignments | Inchangé fonctionnellement (02B) tant que `teacherId` est `TEACHERS-*` |

### 4.3 Option C bornée (rappel)

| Autorisé | Interdit (lot 1) |
|----------|------------------|
| Renseigner / maintenir `teachers.user_id` | Nouvelle table link |
| S’appuyer sur `school_id` / `schoolCode` | `canonicalTeacherId` additionnel |
| Préférer `TEACHERS-*` à la lecture/écriture nouvelle | `UNIQUE(school_id, user_id)` SQL |

---

## 5. Résolution canonique des **nouvelles** évaluations

### 5.1 Cible

Pour toute évaluation **créée après** le correctif (parcours nominal neuf) :

| Couche | Valeur |
|--------|--------|
| JSON `evaluation.teacherId` | `TEACHERS-*` canon |
| PG `teachers.teacher_code` du `evaluations.teacher_id` | **même** `TEACHERS-*` |
| `teacher_assignments` actives | sur ce même teacher PG |

### 5.2 Chaîne de résolution (contrat)

Dans `evaluationAttachment` / deps repository, pour une **nouvelle** écriture :

1. Lire `evaluation.teacherId` (doit être `TEACHERS-*` si clients conformes).  
2. `findTeacherByCode(school, teacherId)`.  
3. Sinon `ensureTeacher` → `materializeBackOfficeTeacher` sur la fiche BO **`TEACHERS-*`** liée (pas un jumeau).  
4. Sinon `findTeacherByAssignment(..., preferredTeacherCode=TEACHERS-*)`.  
5. **`findAnyTeacher` (ORDER BY created_at)** : **interdit** comme fallback pour les **nouvelles** écritures du lot minimal (c’est un suspect fort de Q7 : premier row = souvent `TEACHER-*`). Remplacer par refus structuré **ou** résolution strictement via user_id → `TEACHERS-*`.

### 5.3 Historique

- Ne pas backfiller les evaluations existantes.  
- Authz multi-fiches : **conservée** pour lectures / accès notes des enseignants déjà jumelés.  
- Ne **pas** étendre la création de nouveaux jumeaux « pour que le multi-match fonctionne ».

---

## 6. Critères d’acceptation (gate unique)

### 6.1 Nouvelles créations — AC-NEW-* (tous obligatoires)

| Id | Critère |
|----|---------|
| **AC-NEW-01** | Flux contact+user **ne crée plus** de `TEACHER-*` parallèle ; au plus une fiche `TEACHERS-*` liée au user |
| **AC-NEW-02** | Création pédagogique / affectation réutilise le `TEACHERS-*` lié au compte (pas de second id) |
| **AC-NEW-03** | Après sync PG : pour ce user/école, le row d’affectation a `teacher_code` `TEACHERS-*` et `user_id` non null correct |
| **AC-NEW-04** | Sur parcours neuf : `evaluation.teacherId` JSON = `evaluations.teacher_id`→`teacher_code` PG = même `TEACHERS-*` ; assignments alignés |

### 6.2 Régression — AC-REG-*

| Id | Critère |
|----|---------|
| **AC-REG-01** | `npm run verify:pre-e1-hotfix-02b` vert (TENANT/ROLE/REPLAY/LINK/ACK/POST-PG) |
| **AC-REG-02** | `npm run verify:pre-e1-v1` vert (33/33) |
| **AC-REG-03** | Isolation tenant + rôle TEACHER inchangés (pas d’assouplissement) |
| **AC-REG-04** | Idempotence sync staff (pas de prolifération sur re-PUT) |

### 6.3 Historique — AC-HIST-01

| Id | Critère |
|----|---------|
| **AC-HIST-01** | Enseignant avec jumeaux **préexistants** : conserve l’accès notes (POST/PUT autorisé selon affectation) via multi-match temporaire — **aucune** fusion/DELETE |

### 6.4 Preuve machine dédiée (nouvelle)

- Script / extension : ex. `npm run verify:pre-e1-v2-identity-fix` (nom indicatif)  
- Artefact **nouveau** : `docs/audits/evidence/pre-e1-v2-identity-fix-results.json`  
- **Ne pas** modifier `pre-e1-v2-identity-lifecycle-results.json`

Caractérisation V2.1 existante : peut rester en filet ; adapter si assertions deviennent obsolètes **sans** réécrire l’historique des runs #95/#96.

---

## 7. Stratégie de rollback

| Niveau | Action |
|--------|--------|
| Feature flag (si introduit) | Désactiver le nouveau chemin sync → comportement pré-fix (accepté seulement en urgence) |
| Revert git | Revert de la **PR code unique** du lot minimal |
| Données | **Aucun** rollback data requis si le lot ne migre pas (contrat) |
| Détection | Réapparition AC-NEW-01/04 rouges ou régression 02b/v1 → stop merge / revert |

**Interdit en rollback :** scripts de « nettoyage » qui DELETE des teachers / evaluations.

---

## 8. Absence de changement pour les données historiques

Le lot **ne doit pas** :

- fusionner ou supprimer `TEACHER-*` / `TEACHERS-*` existants ;  
- backfiller `evaluations.teacher_id` ;  
- réécrire `assignments.teacherId` historiques ;  
- ajouter contrainte SQL risquant d’échouer sur jumeaux présents ;  
- retirer le multi-match authz pour les comptes déjà jumelés.

Toute consolidation ultérieure = **lot séparé** + analyse données + aval CTO migration.

---

## 9. Découpage en PR minimale

### 9.1 Une seule PR code (recommandée)

| PR | Contenu | Prérequis |
|----|---------|-----------|
| **PR-FIX-V2.1-IDENTITY** (Draft puis undraft après gates) | Backend sync `TEACHERS-*` + règles réutilisation · alignement résolution evaluations (nouveaux) · alignement web si nécessaire · tests unitaires · harness AC-NEW/REG/HIST · rapport de preuve **nouveau** | **Ce contrat validé CTO** |

### 9.2 Hors de cette PR code

| | |
|--|--|
| Docs-only de gouvernance déjà livrés | #95 #96 #97 |
| Lot consolidation UNIQUE / backfill | Futur, autre mandat |
| Prochain sujet V2 (student_code, etc.) | Différé |

### 9.3 Ordre d’implémentation interne (dans la PR code, pas des merges séparés)

1. Tests de caractérisation / red (AC-NEW) reproduisant le double id.  
2. `UserTeacherSyncService` + alignement web.  
3. Résolution evaluations (retrait `findAnyTeacher` dangereux pour nouveaux flux).  
4. Gates 02b / v1 / fix harness.  
5. Rapport preuve + checklist AC-HIST-01.

---

## 10. Invariants non négociables (rappel)

- Isolation tenant (`TEACHER_USER_TENANT_CONFLICT`)  
- Rôle TEACHER (`TEACHER_USER_ROLE_CONFLICT`)  
- Idempotence sync  
- POST notes nominal + refus hors périmètre  
- Pas d’orphelins **nouveaux**  
- Pas d’affaiblissement RBAC  

---

## 11. Critères d’acceptation du **contrat** (revue CTO)

Ce contrat est **accepté** si :

1. Option A+C bornée et périmètre (prévention + eval nouvelles) sont fidèles à l’arbitrage #97.  
2. Fichiers/fonctions listés sont suffisants et bornés.  
3. Avant/après sync + résolution eval sont testables.  
4. AC-NEW/REG/HIST et rollback sont explicites.  
5. Aucun code n’accompagne la PR du contrat.

**Après acceptation :** une **PR Draft code** distincte pourra être ouverte — **pas avant**.

---

## 12. Références

| Document | Rôle |
|----------|------|
| Plan cadrage + §0.1 arbitrage | PR #97 |
| Rapport / preuve caractérisation | PR #95/#96 |
| `CONTRAT-HOTFIX-PRE-E1-02B.md` | Canon `TEACHERS-*` sync PG / isolation |

---

**Fin du contrat FIX V2.1 — aucun code · aucune migration · en attente d’aval CTO.**
