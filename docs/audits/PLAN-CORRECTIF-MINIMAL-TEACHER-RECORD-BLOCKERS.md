# Plan correctif minimal — bloqueurs fiche enseignant

**Type :** cadrage correctif documentaire — **aucune implémentation**  
**Autorisation CTO :** architecture **VALIDÉE SOUS CORRECTIONS** · revalidation CTO après ce commit · implémentation **INTERDITE** · contrat d’implémentation **PAS ENCORE AUTORISÉ**  
**Source :** décision CTO sur audit [`AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md`](./AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md) (PR #103 **MERGÉE**) · [`evidence/independent-teacher-record-audit-results.json`](./evidence/independent-teacher-record-audit-results.json)  
**Base de référence :** `develop` @ `54b40c06` (post-merge #103) — audit d’origine sur `9dcf4ba`  
**Date :** 2026-07-27  
**PR :** #104 (Draft)

> Rapport Cursor ≠ validation CTO.  
> Ce document **ne corrige pas** le code. Il borne les lots, les critères d’acceptation et les preuves runtime exigées avant tout merge d’implémentation.

---

## 0. Mandat et interdictions

| Élément | Statut |
|---------|--------|
| PR #103 (audit indépendant) | **MERGÉE** · validée |
| Plan #104 | **ARCHITECTURE VALIDÉE SOUS CORRECTIONS** — attendre revalidation CTO |
| Contrat d’implémentation | **PAS ENCORE AUTORISÉ** |
| Audit indépendant fiche enseignant | **Retenu** (cartographie + 5 anomalies) |
| Verdict cycle de vie complet | **NO-GO** |
| Création nominale Web/backend `TEACHERS-*` | **GO SOUS RÉSERVES** (V2.1 **validé**, **non rouvert**) |
| Voie 2 | **SUSPENDUE** |
| Réouverture V2.1 | **NON** |
| Implémentation code | **INTERDITE** |
| Migration / fusion jumeaux historiques | **INTERDITES** |
| E1 | **NO-GO** |
| Preuve runtime (PG/HTTP) | **OBLIGATOIRE** avant merge de tout lot code |

### Périmètre autorisé de ce livrable

- Séparation en **trois lots ordonnés** (bloqueurs CRITICAL) — **une PR code distincte par lot**
- Exigences **transverses** pour les deux MAJOR
- Points d’écriture, critères d’acceptation, hors-périmètre, preuves
- Décisions CTO sur matrice de statuts, réactivation et affectations (ci-dessous)

### Hors périmètre absolu

- Patch code, refactor, changement de schéma
- Fusion / DELETE / backfill des `TEACHER-*` historiques
- Réouverture du contrat FIX V2.1
- Regroupement des trois CRITICAL dans une PR code unique
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

## 0.2 Décisions CTO consignées (2026-07-27)

### D1 — Ordre des lots — **VALIDÉ**

| Ordre | Lot | Contenu |
|-------|-----|---------|
| 1 | Identité Mobile | Canon `TEACHERS-*` exclusive |
| 2 | Attribution notes / présences | Exact ou refus structuré |
| 3 | Statut pédagogique | Matrice compte ↔ fiche ↔ affectations ↔ PG |

**Règle d’exécution :** chaque lot = **une PR code distincte**, avec **son propre contrat** et **sa propre preuve runtime**.  
**Interdit :** regrouper les trois CRITICAL dans une PR unique.

### D2 — Matrice canonique des statuts — **VALIDÉE**

| Compte | Fiche pédagogique | Résultat |
|--------|-------------------|----------|
| Actif | Actif | Capacités selon RBAC et affectations |
| Actif | Inactif manuel | **Inactif conservé** ; **aucun réveil automatique** par sync |
| Suspendu ou Inactif | Quel que soit l’état actif précédent | Fiche dérivée **non active** ; **aucune** nouvelle affectation ni écriture |
| Supprimé | Toute fiche liée | **Aucune écriture** ; **pas** de suppression automatique de l’historique |
| Tout état | Archived | État **terminal** ; **jamais** réactivé par sync |

**Priorité imposée (du plus fort au plus faible) :**

1. `archived`
2. inactif pédagogique manuel
3. compte suspendu / inactif / supprimé
4. actif

**Conséquences sync / matérialisation :**

- Le sync compte → fiche **ne doit jamais** écraser silencieusement :
  - `Inactif` → `Actif`
  - `archived` → un autre état
  - une suspension par une matérialisation PG par défaut (`active`)

### D3 — Réactivation — **VALIDÉE**

Une réactivation est **autorisée uniquement** par une **action administrative explicite** sur la fiche pédagogique, avec un **compte lui-même actif**.

**Ne constitue pas** une réactivation explicite :

- un simple PUT identique
- une connexion
- un sync générique compte → fiche

### D4 — Affectations existantes — **VALIDÉE**

Lorsqu’une fiche devient suspendue, inactive ou archivée :

| Règle | Obligation |
|-------|------------|
| Nouvelles affectations | **Aucune** nouvelle affectation **active** |
| Affectations actives existantes | Passées à un état **non actif**, **non destructif**, dans le cadre de la transition (même fiche + même établissement) |
| DELETE / backfill global | **Interdits** |
| Historique | **Consultable** |

Le **contrat du lot 3** fixera le statut cible exact (ex. `inactive`) et sa **représentation identique** dans le BO et PostgreSQL.

---

## 1. Anomalies retenues (base de gouvernance)

| ID audit | Constat | Sévérité CTO | Lot |
|----------|---------|--------------|-----|
| C-04 / Q1 | Mobile produit encore `TEACHER-*` | **CRITICAL CONFIRMÉE** | **Lot 1** |
| C-05 / Q9 | Fallback `ORDER BY created_at LIMIT 1` (notes/présences) | **CRITICAL CONFIRMÉE** | **Lot 2** |
| C-06 / Q4 | Désactivation pédagogique incomplète | **CRITICAL CONFIRMÉE** | **Lot 3** |
| C-07 / Q11 | Skips / ambiguïtés non remontés au client | **MAJOR CONFIRMÉE** | **Transverse T1** |
| C-10 / C-11 / Q3 / Q12 | Divergences Web/backend/Mobile + E2E obsolètes | **MAJOR CONFIRMÉE** | **Transverse T2** |

Ordre d’exécution **VALIDÉ CTO** : **Lot 1 → Lot 2 → Lot 3**.  
Chaque lot = **PR code distincte** + **contrat dédié** + **preuve runtime dédiée** (D1).  
T1 et T2 sont **exigences transverses** : à intégrer dans les lots code (pas de lot « cosmétique » isolé qui laisse les CRITICAL ouverts).

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

### 4.3 État canonique cible — **VALIDÉ CTO** (D2 / D3 / D4)

Matrice opérationnelle (voir aussi §0.2) :

| Compte | Fiche pédagogique | Nouvelles affectations | Nouvelles écritures notes/évals | Sync compte→fiche | PG `teachers.status` |
|--------|-------------------|------------------------|----------------------------------|-------------------|----------------------|
| Actif | Actif | Selon RBAC | Selon RBAC + affectation | Maj profil autorisée | `active` |
| Actif | Inactif manuel | **Refusées** | **Refusées** | **Préserve Inactif** (pas de réveil) | `inactive` |
| Suspendu / Inactif | Dérivée non active | **Refusées** | **Refusées** | Dérive fiche non active | `suspended` / `inactive` |
| Supprimé | Liée | **Refusées** | **Refusées** | Pas de delete historique | non-actif (pas de purge) |
| * | Archived | **Refusées** | **Refusées** | **Jamais** réactivé par sync | `archived` (terminal) |

**Priorité de résolution :** `archived` → inactif manuel → compte suspendu/inactif/supprimé → actif.

**Réactivation (D3) :** uniquement action administrative **explicite** sur la fiche, compte actif. PUT identique / login / sync générique ≠ réactivation.

**Affectations existantes (D4) :** à la transition fiche → suspendue / inactive / archived :

1. bloquer toute nouvelle affectation active ;
2. passer les affectations **actives** de cette fiche **dans cet établissement** à un état non actif **non destructif** ;
3. aucun DELETE, aucun backfill global ;
4. historique consultable.

Le contrat lot 3 fixera le libellé exact du statut cible (ex. `inactive`) **identique** BO ↔ PostgreSQL.

Règles non négociables :

1. Vocabulaire normalisé compte ↔ fiche ↔ PG (mapping explicite dans le contrat lot 3).
2. Sync ne réactive jamais silencieusement (`Inactif`→`Actif`, `archived`→autre, suspension écrasée par PG `active`).
3. `Suspendu` **et** `Inactif` **et** `archived` bloquent nouvelles affectations et nouvelles écritures.
4. Transition d’affectations actives → non actives **non destructive** (D4).
5. Pas de migration / fusion historique des jumeaux `TEACHER-*`.

### 4.4 Critères d’acceptation (Lot 3)

| ID | Critère | Preuve exigée |
|----|---------|---------------|
| AC-S1 | Fiche `Suspendu` → nouvelle affectation refusée (Web + PUT) | Runtime |
| AC-S2 | Fiche `Inactif` manuel + compte Actif → Inactif **conservé** après sync ; pas de réveil | Runtime + unit |
| AC-S3 | Compte Suspendu/Inactif/Supprimé → aucune nouvelle écriture pédagogique | Runtime |
| AC-S4 | Fiche `archived` → jamais réactivée par sync / matérialisation | Runtime PG |
| AC-S5 | Matérialisation PG d’une fiche non active ≠ `active` par défaut | Runtime PG |
| AC-S6 | Transition fiche non active → affectations actives du même établissement passées non actives (non destructif) | Runtime BO + PG |
| AC-S7 | Réactivation seulement via action admin explicite + compte actif ; PUT/sync/login seuls ne réactivent pas | Runtime négatif |
| AC-S8 | Authz notes refuse écriture si fiche/compte non actifs (matrice D2) | Runtime |

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
| 0 | Ce plan (Draft docs #104) | Architecture validée sous corrections — **revalidation CTO** |
| 1a | Contrat docs **Lot 1** seul | Aval CTO sur #104 + autorisation contrat |
| 1b | PR code Lot 1 + preuve runtime Lot 1 | Aval contrat Lot 1 |
| 2a | Contrat docs **Lot 2** seul | Lot 1 mergé |
| 2b | PR code Lot 2 + preuve runtime Lot 2 | Aval contrat Lot 2 |
| 3a | Contrat docs **Lot 3** seul (statut cible affectations BO↔PG) | Lot 2 mergé |
| 3b | PR code Lot 3 + preuve runtime Lot 3 | Aval contrat Lot 3 |
| 4 | Requalification CTO cycle de vie fiche | Preuves lots 1–3 + T1/T2 |

**Interdit :** une seule PR code regroupant lots 1+2+3.  
**Voie 2** reste **suspendue** jusqu’à décision CTO distincte après requalification.

---

## 8. Risques et dépendances

| Risque | Mitigation cadrage |
|--------|-------------------|
| Mobile et Web divergent encore après lot 1 partiel | AC-M* + T2.1 obligatoires dans la même vague Mobile |
| Refus notes admin casse workflows légitimes | Contrat lot 2 doit préciser comment l’opérateur **fournit** l’enseignant (champ obligatoire / sélection) |
| Sync statut casse fiches démo | Matrice D2 figée ; pas de backfill destructif ; D4 non destructif |
| Réactivation accidentelle via PUT/sync | D3 — garde explicite + tests négatifs AC-S7 |
| Élargissement furtif à V2.1 / jumeaux | Interdiction explicite ; revue PR = docs d’abord |

---

## 9. Décisions CTO — enregistrées

| Point ouvert | Décision |
|--------------|----------|
| Ordre Lot 1 → 2 → 3 + PR distinctes | **VALIDÉ** (D1) |
| Matrice statuts + priorité archived→…→actif | **VALIDÉE** (D2) |
| Préservation Inactif manuel / archived | **VALIDÉE** (D2) |
| Réactivation explicite admin seulement | **VALIDÉE** (D3) |
| Transition affectations actives → non actives non destructive | **VALIDÉE** (D4) ; libellé exact dans contrat lot 3 |
| Contrat d’implémentation | **PAS ENCORE AUTORISÉ** |
| Implémentation code | **INTERDITE** |

**Prochaine étape gouvernance :** revalidation CTO de #104 (après CI verts) → puis seulement autorisation éventuelle des contrats par lot.

**Implémentation :** toujours **INTERDITE** tant que contrat du lot + aval + preuve runtime ne sont pas acquis.
