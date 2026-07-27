# Plan correctif minimal — bloqueurs fiche enseignant

**Type :** cadrage correctif documentaire — **aucune implémentation**  
**Autorisation CTO :** cadrage Draft **AUTORISÉ** · implémentation **INTERDITE** · migration / fusion historique **INTERDITES**  
**Source :** décision CTO sur audit [`AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md`](./AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md) (PR #103) · [`evidence/independent-teacher-record-audit-results.json`](./evidence/independent-teacher-record-audit-results.json)  
**Base de référence :** `develop` @ `9dcf4ba` (état audité)  
**Date :** 2026-07-27  

> Rapport Cursor ≠ validation CTO.  
> Ce document **ne corrige pas** le code. Il borne les lots, les critères d’acceptation et les preuves runtime exigées avant tout merge d’implémentation.

---

## 0. Mandat et interdictions

| Élément | Statut |
|---------|--------|
| Audit indépendant fiche enseignant | **Retenu** (cartographie + 5 anomalies) |
| Verdict cycle de vie complet | **NO-GO** |
| Création nominale Web/backend `TEACHERS-*` | **GO SOUS RÉSERVES** (V2.1 **validé**, **non rouvert**) |
| Voie 2 | **SUSPENDUE** |
| Réouverture V2.1 | **NON** |
| Implémentation | **INTERDITE** jusqu’à aval CTO post-contrat |
| Migration / fusion jumeaux historiques | **INTERDITES** |
| E1 | **NO-GO** |
| Preuve runtime (PG/HTTP) | **OBLIGATOIRE** avant merge de tout lot code |

### Périmètre autorisé de ce livrable

- Séparation en **trois lots ordonnés** (bloqueurs CRITICAL)
- Exigences **transverses** pour les deux MAJOR
- Points d’écriture, critères d’acceptation, hors-périmètre, preuves

### Hors périmètre absolu

- Patch code, refactor, changement de schéma
- Fusion / DELETE / backfill des `TEACHER-*` historiques
- Réouverture du contrat FIX V2.1
- Tout sujet voie 2 non listé ci-dessous
- Bulletins / E1

---

## 0.1 Verdict CTO rappel (cible du correctif)

| Composant | Verdict actuel | Cible après lots (si preuves OK) |
|-----------|----------------|----------------------------------|
| Création nominale Web/backend | GO sous réserves | Conserver / durcir |
| Cycle de vie complet fiche | **NO-GO** | Requalification CTO seulement après lots 1–3 + transverses |
| Mobile enseignant | **NO-GO** | GO sous réserves si lot 1 clos |
| Notes / présences fallback | **NO-GO** | GO si lot 2 clos |
| Désactivation pédagogique | **NO-GO** | GO si lot 3 clos |
| E1 | **NO-GO** | Inchangé par ce plan |

---

## 1. Anomalies retenues (base de gouvernance)

| ID audit | Constat | Sévérité CTO | Lot |
|----------|---------|--------------|-----|
| C-04 / Q1 | Mobile produit encore `TEACHER-*` | **CRITICAL CONFIRMÉE** | **Lot 1** |
| C-05 / Q9 | Fallback `ORDER BY created_at LIMIT 1` (notes/présences) | **CRITICAL CONFIRMÉE** | **Lot 2** |
| C-06 / Q4 | Désactivation pédagogique incomplète | **CRITICAL CONFIRMÉE** | **Lot 3** |
| C-07 / Q11 | Skips / ambiguïtés non remontés au client | **MAJOR CONFIRMÉE** | **Transverse T1** |
| C-10 / C-11 / Q3 / Q12 | Divergences Web/backend/Mobile + E2E obsolètes | **MAJOR CONFIRMÉE** | **Transverse T2** |

Ordre d’exécution imposé : **Lot 1 → Lot 2 → Lot 3**.  
T1 et T2 sont **exigences transverses** : à intégrer dans chaque lot code (pas de lot « cosmétique » isolé qui laisse les CRITICAL ouverts).

---

## 2. Lot 1 — Identité Mobile

### 2.1 Objectif

Alignement strict de Mobile sur le canon pédagogique `TEACHERS-*` déjà validé Web/backend (V2.1), **sans** migration des jumeaux historiques.

### 2.2 Problème borné

| Fait | Artefact |
|------|----------|
| `newTeacherId()` émet `TEACHER-{ts}-{rand}` | `Mobile/src/lib/userTeacherSync.ts` |
| Pas de `resolveCanonicalTeachersRow` / ambiguïté | même fichier |
| `isTeacherUserRole` Mobile accepte `"teacher"` | Mobile vs backend divergent (→ T2) |
| Create gate Mobile encore contacts-only | divergence parcours (→ T2) |

### 2.3 Règles cibles (cadrage)

1. **Toute nouvelle fiche** créée depuis Mobile (sync compte → enseignant **ou** CRUD fiche) doit porter un id `TEACHERS-*`.
2. Si un compte est déjà lié à un canon `TEACHERS-*` (même `userId` + `schoolCode`), Mobile **réutilise** ce canon — **interdiction** de créer un nouveau `TEACHER-*` **ou** un second `TEACHERS-*`.
3. Si seul un twin historique `TEACHER-*` est lié : **comportement aligné backend** AC-HIST-02 — mise à jour conservatrice, **pas** d’auto-création `TEACHERS-*`, **pas** de fusion.
4. Ambiguïté multi-`TEACHERS-*` : **refus structuré** (même code `TEACHER_CANON_AMBIGUOUS`) — pas de `findIndex` silencieux.

### 2.4 Points d’écriture à traiter (futur)

| Surface | Fichier (indicatif) | Action cadrée |
|---------|---------------------|---------------|
| Sync user→teacher | `Mobile/src/lib/userTeacherSync.ts` | Remplacer génération `TEACHER-*` ; porter la logique canon (miroir Web/backend) |
| CRUD Admin | `Mobile/src/screens/AdminCrudScreen.tsx` (`createInternalId`) | Préfixe `TEACHERS` pour entity teachers |
| Écran liste | `Mobile/src/screens/TeachersScreen.tsx` | Vérifier que create/edit ne court-circuitent pas le canon |

### 2.5 Critères d’acceptation (Lot 1)

| ID | Critère | Preuve exigée |
|----|---------|---------------|
| AC-M1 | Nouveau sync Mobile Enseignant sans fiche → id `TEACHERS-*` | Unit Mobile + **runtime** PUT state |
| AC-M2 | Compte déjà lié à `TEACHERS-*` → réutilisation, 0 nouveau id | Runtime |
| AC-M3 | Aucun nouveau `TEACHER-*` produit par Mobile sur parcours sync/CRUD | Grep + runtime négatif |
| AC-M4 | Twin historique seul : pas d’auto-`TEACHERS-*` | Unit aligné AC-HIST-02 |
| AC-M5 | Multi-canon → erreur structurée visible | Runtime HTTP 409 + code |

### 2.6 Hors lot 1

- Fusion / suppression des `TEACHER-*` existants
- Changement de schéma PG
- Attribution notes (lot 2) et statut (lot 3)

---

## 3. Lot 2 — Attribution notes et présences

### 3.1 Objectif

Supprimer tout auteur pédagogique **inventé**. Résolution **exacte** ou **refus structuré**.

### 3.2 Problème borné

| Fait | Artefact |
|------|----------|
| `findTeacherForGrade` : si principal ≠ Enseignant et pas de match affectation → `ORDER BY created_at LIMIT 1` | `backend/db/postgresRepository.js` ~4363–4366 |
| `findTeacherForAttendance` : même fallback | ~4394 |
| Seed / chemins annexes similaires | même repository (à inventorier en implémentation) |
| Évals : résolution exacte déjà en place (`EVAL_TEACHER_UNRESOLVED`) | `evaluationAttachment.js` — **à préserver**, pas à affaiblir |

### 3.3 Règles cibles (cadrage)

1. **Interdiction** de tout `findAnyTeacher` / `ORDER BY created_at LIMIT 1` (ou équivalent « premier de l’école ») pour rattacher un enseignant à une note ou une présence.
2. Résolution autorisée uniquement par :
   - clé stable explicite (`teacher_code` / `TEACHERS-*` / `TEACHER-*` historique fourni) **dans le scope école**, et/ou
   - affectation active exacte (classe + matière + enseignant) lorsque le contrat métier l’exige.
3. Si aucune résolution déterministe : **refus structuré** (`4xx` + `code` stable, ex. `GRADE_TEACHER_UNRESOLVED` / `ATTENDANCE_TEACHER_UNRESOLVED`) — **jamais** d’auteur inventé.
4. Lecture JSON `authorId` / mapping PG : ne doit pas masquer un teacher_id opportuniste créé à l’écriture.

### 3.4 Critères d’acceptation (Lot 2)

| ID | Critère | Preuve exigée |
|----|---------|---------------|
| AC-N1 | Admin/direction sans teacher résolu → HTTP erreur structurée, **pas** 201 avec mauvais teacher | **Runtime PG/HTTP** |
| AC-N2 | Enseignant avec affectation exacte → 201, `grades.teacher_id` = canon attendu | Runtime |
| AC-N3 | Présence : même règle (exact ou refus) | Runtime |
| AC-N4 | Grep CI / test : aucun `ORDER BY created_at LIMIT 1` restant sur chemins grade/attendance teacher resolve | Test garde + revue |
| AC-N5 | Éval attachment exacte inchangée (non-régression HOTFIX-SYNC-02) | Unit + runtime |

### 3.5 Hors lot 2

- Réécriture historique des `grades.teacher_id` existants (migration **interdite** ici)
- Refonte complète authz notes BO fallback (hors bloqueur C-05 ; ne pas élargir sans aval)
- Mobile UI notes (sauf si partage du même helper serveur — le gate est backend)

---

## 4. Lot 3 — Statut pédagogique

### 4.1 Objectif

Définir et appliquer un **état canonique** entre compte, fiche, affectations et PostgreSQL, tel qu’un enseignant **suspendu** ou **inactif** ne conserve **pas** de nouvelles capacités d’écriture ou d’affectation par effet de sync.

### 4.2 Problème borné

| Fait | Artefact |
|------|----------|
| `validateAssignmentWrite` bloque seulement `inactif` / `archived` — pas `Suspendu` | `dataIntegrityRules.js` |
| Sync user→fiche force `Actif` ou `Suspendu` selon user — écrase `Inactif` pédagogique | `userTeacherSyncService.js` `buildTeacherFromUser` |
| Matérialisation PG : `archived ? archived : active` | `postgresRepository.js` |
| Affectations PG upsert toujours `status = 'active'` | `materializeBackOfficeAssignment` |
| Authz notes : pas de filtre statut fiche | `teacherNotesWriteAccess.js` |

### 4.3 État canonique cible (cadrage — à figer en contrat avant code)

Proposition de matrice (à valider CTO dans le contrat d’implémentation) :

| État compte (`users.status`) | État fiche (`teachers[].status`) | Nouvelles affectations | Nouvelles notes/évals (écriture) | PG `teachers.status` | PG `teacher_assignments.status` |
|------------------------------|----------------------------------|------------------------|----------------------------------|----------------------|----------------------------------|
| Actif | Actif | Autorisées | Selon RBAC + affectation | `active` | suit BO (active/inactive) |
| Suspendu / Inactif / Supprimé | Suspendu ou Inactif (dérivé) | **Refusées** | **Refusées** (hors lecture) | `suspended` / `inactive` | **pas** de nouvel upsert `active` ; désactivation des actives du scope si défini au contrat |
| Actif | Inactif pédagogique manuel | **Refusées** | **Refusées** | `inactive` | idem |
| — | archived | **Refusées** | **Refusées** | `archived` | idem |

Règles non négociables du cadrage :

1. **Un seul vocabulaire** normalisé compte ↔ fiche ↔ PG (table de mapping explicite dans le futur contrat).
2. Sync user→fiche **ne doit plus** réactiver silencieusement une fiche volontairement inactive lorsque le métier l’interdit (préciser dans le contrat : override admin vs préservation).
3. `Suspendu` **et** `Inactif` bloquent **nouvelles** affectations et **nouvelles** écritures pédagogiques.
4. Matérialisation PG ne doit pas écraser un statut non-actif en `active` par défaut.
5. Pas de migration de masse des historiques — seulement le comportement des **nouvelles** opérations + éventuelle désactivation **non destructive** des affectations actives du même enseignant (si le contrat le prescrit ; sinon report explicite).

### 4.4 Critères d’acceptation (Lot 3)

| ID | Critère | Preuve exigée |
|----|---------|---------------|
| AC-S1 | Fiche `Suspendu` → nouvelle affectation refusée (Web + PUT) | Runtime |
| AC-S2 | Fiche `Inactif` → nouvelle affectation refusée ; sync user Actif **ne** force **pas** Actif si règle de préservation retenue | Runtime + unit |
| AC-S3 | Compte Suspendu → pas de session / pas d’écriture notes | Runtime (déjà partiel) + garde pédagogique |
| AC-S4 | Matérialisation PG d’une fiche Suspendu/Inactif ≠ `active` | Runtime PG |
| AC-S5 | Upsert affectation BO inactive ne force plus PG `active` (ou refuse) | Runtime PG |
| AC-S6 | Authz notes refuse écriture si fiche/compte non actifs (selon matrice) | Runtime |

### 4.5 Hors lot 3

- Purge orphelins évaluations (dette séparée)
- Transfert inter-établissements
- UNIQUE `(school_id, teacher_code)` / migration schéma large

---

## 5. Exigences transverses (MAJOR)

### T1 — Remontée structurée des skips et ambiguïtés

| Exigence | Détail |
|----------|--------|
| **T1.1** | Tout `TEACHER_CANON_AMBIGUOUS` sur écriture liée → déjà 409 ; **conserver** |
| **T1.2** | Les skips aujourd’hui silencieux (`TEACHER_CANON_AMBIGUOUS_SKIPPED_UNRELATED`, `TEACHER_HISTORICAL_MULTI_TWIN`, `TEACHER_LINK_AMBIGUOUS`) doivent être **exposés** au client PUT (ex. `identitySyncAck.skips[]` avec `code`, `userId`, `schoolCode`, `action`) |
| **T1.3** | Web (et Mobile après lot 1) : surface utilisateur ou journal opérateur pour skips non fatals ; **pas** d’échec silencieux total du PUT si no-op tracé |
| **T1.4** | Test HTTP : assert présence skips dans la réponse lorsque le scénario X2 se produit |

À intégrer dès le **premier lot code** touchant `server.js` / sync ; a minima **avant** clôture du Lot 3.

### T2 — Convergence Web / backend / Mobile + journeys réels

| Exigence | Détail |
|----------|--------|
| **T2.1** | Une seule définition `isTeacherUserRole` (y compris rôle exact `"teacher"`) partagée ou strictement miroir Web ↔ backend ↔ Mobile |
| **T2.2** | Alignement règles âge entrée / delete blockers : soit backend applique les mêmes gardes que Web, soit documenter le canal unique autorisé — **pas** de faille API |
| **T2.3** | Retirer / remplacer les E2E contacts-only obsolètes (`scripts/e2e-contacts-rules.js`, assertions `verify-e2e-0002` / `0006`) par des **journeys réels** : create Web `TEACHERS-*`, sync compte, ambiguïté 409, Mobile `TEACHERS-*` (post lot 1) |
| **T2.4** | Commentaires / docs UI contredisant `entityCreateViaContactsOnly === false` : aligner documentation |
| **T2.5** | Preuve : au moins un journey automatisé par surface critique (Web create, PUT ambiguïté, note refusée sans teacher, Suspendu→affectation refusée) |

---

## 6. Preuves runtime (gate CTO avant merge code)

La limite de l’audit #103 (pas de rejeu PG/HTTP) **n’invalide pas** les constats. Elle impose :

| Gate | Contenu minimal |
|------|-----------------|
| Environnement | Backend + PostgreSQL + harness dédié (DB jetable) |
| Artefact | `docs/audits/evidence/teacher-record-fix-<lot>-runtime-results.json` |
| Contenu | scénarios AC-* du lot, HTTP status, codes erreur, rows PG `teacher_code` / `teacher_id` / `status` |
| Règle | **Aucun merge** d’implémentation sans evidence runtime du lot + non-régression des lots précédents |

---

## 7. Ordre d’ouverture des PR futures (hors ce cadrage)

| Étape | Nature | Condition |
|-------|--------|-----------|
| 0 | Ce plan (Draft docs) | **En cours** |
| 1 | Contrat d’implémentation (docs) par lot ou contrat unique borné | Aval CTO sur ce plan |
| 2 | PR code Lot 1 (+ amorces T1/T2) | Aval contrat + preuve runtime |
| 3 | PR code Lot 2 (+ T1 si incomplet) | Lot 1 mergé / non-régression |
| 4 | PR code Lot 3 (+ T1/T2 complets) | Lots 1–2 mergés |
| 5 | Requalification CTO cycle de vie fiche | Preuves lots 1–3 + transverses |

**Voie 2** reste **suspendue** jusqu’à décision CTO distincte après requalification.

---

## 8. Risques et dépendances

| Risque | Mitigation cadrage |
|--------|-------------------|
| Mobile et Web divergent encore après lot 1 partiel | AC-M* + T2.1 obligatoires dans la même vague Mobile |
| Refus notes admin casse workflows légitimes | Contrat lot 2 doit préciser comment l’opérateur **fournit** l’enseignant (champ obligatoire / sélection) |
| Sync statut casse fiches démo | Matrice §4.3 figée avant code ; pas de backfill destructif |
| Élargissement furtif à V2.1 / jumeaux | Interdiction explicite ; revue PR = docs d’abord |

---

## 9. Décision demandée au CTO (sur ce cadrage)

| Question | Options |
|----------|---------|
| Valider l’ordre Lot 1 → 2 → 3 + transverses T1/T2 ? | Oui / Ajuster |
| Matrice statut §4.3 (préservation `Inactif` vs override sync) ? | Trancher avant contrat code |
| Autoriser ensuite la rédaction du **contrat d’implémentation** (docs only) ? | Oui / Non |

**Implémentation :** toujours **INTERDITE** tant que contrat + aval + preuve runtime ne sont pas acquis.
