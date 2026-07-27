# Contrat d’implémentation — Lot 1 Identité Mobile

**ID lot :** `TEACHER-RECORD-LOT1-MOBILE-IDENTITY`  
**Type :** contrat documentaire — **aucun code dans cette PR**  
**Cadrage validé :** [`PLAN-CORRECTIF-MINIMAL-TEACHER-RECORD-BLOCKERS.md`](./PLAN-CORRECTIF-MINIMAL-TEACHER-RECORD-BLOCKERS.md) (PR #104 · mergée `d51b0211`)  
**Audit source :** [`AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md`](./AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md) (PR #103 · `54b40c06`) — constat **C-04 CRITICAL CONFIRMÉE**  
**Base :** `develop` @ `d51b0211`  
**Date :** 2026-07-27  

| Élément | Statut |
|---------|--------|
| Architecture plan #104 | **VALIDÉE DÉFINITIVEMENT** |
| Contrat Lot 1 (ce document) | **SOUMIS** — attendre validation CTO explicite |
| Implémentation code Lot 1 | **INTERDITE** jusqu’à validation de ce contrat |
| Contrats Lots 2 et 3 | **Interdits** avant clôture Lot 1 |
| Migration / fusion `TEACHER-*` historiques | **INTERDITES** |
| Réouverture V2.1 | **NON** |
| Voie 2 | **SUSPENDUE** |
| E1 | **NO-GO** |

> Rapport Cursor ≠ validation CTO.  
> Ce contrat fige le périmètre, les AC et la preuve runtime du **seul** Lot 1. Il n’autorise pas encore le code.

---

## 1. Objectif du lot

Après correctif Lot 1, sur **toute surface Mobile** qui crée ou synchronise une fiche enseignant :

1. **Toute nouvelle fiche** porte un id **`TEACHERS-*`** (jamais un nouveau `TEACHER-*`).
2. Si un compte est déjà lié à un canon `TEACHERS-*` (`userId` + `schoolCode`), Mobile **réutilise** ce canon — **0** nouvel id.
3. Twin historique seul `TEACHER-*` : alignement **AC-HIST-02** (V2.1) — maj conservatrice, **pas** d’auto-`TEACHERS-*`, **pas** de fusion.
4. Multi-`TEACHERS-*` liés au même compte+école : **refus structuré** `TEACHER_CANON_AMBIGUOUS` (pas de `findIndex` silencieux).
5. Les jumeaux / données historiques existants restent **intacts**.

Critères **AC-M1…AC-M5** = **un seul gate fonctionnel** du Lot 1 (non séparables).

---

## 2. Non-objectifs (hors Lot 1)

| Hors scope | Motif |
|------------|-------|
| Attribution notes / présences (`ORDER BY created_at`) | **Lot 2** |
| Matrice statuts / réactivation / affectations non actives | **Lot 3** |
| Fusion / DELETE / backfill `TEACHER-*` | Interdit gouvernance |
| Changement schéma PG / contraintes UNIQUE | Interdit |
| Réécriture Web `userTeacherSync` (déjà canon) | Hors cause racine Mobile ; non-régression seulement |
| Contrats / code Lots 2–3 | Interdits avant clôture Lot 1 |

**Note statut :** `buildTeacherRow` Mobile force aujourd’hui `Actif`/`Suspendu` (ligne status). Le Lot 1 **ne corrige pas** la matrice D2/D3/D4 ; il **ne doit pas** aggraver le réveil d’`Inactif`/`archived`. Toute touche à `status` hors copie de champs non liés à l’identité est **hors lot** (report Lot 3).

---

## 3. Cause racine et fichiers concernés

### 3.1 Obligatoires

| Fichier | Symboles / zones | Rôle |
|---------|------------------|------|
| `Mobile/src/lib/userTeacherSync.ts` | `newTeacherId`, `buildTeacherRow`, `upsertTeacherFromUser`, `teacherMatchesUser`, `isTeacherUserRole` | **Cause racine** : `TEACHER-${Date.now()}-…` ; pas de résolution canon |
| `Mobile/src/screens/AdminCrudScreen.tsx` | save users → `upsertTeacherFromUser` (~L528) ; `createInternalId` (~L2066) pour entity `teachers` | CRUD / sync déclencheurs |
| `Mobile/src/screens/TeachersScreen.tsx` | create gate / navigation | Ne pas court-circuiter le canon |

### 3.2 Alignement obligatoire (miroir V2.1)

La logique Mobile de résolution doit être un **miroir fonctionnel** de :

| Référence | Artefact |
|-----------|----------|
| Backend | `backend/services/userTeacherSyncService.js` — `resolveCanonicalTeachersRow`, `twinOnlyLinked`, AC-HIST-02, `TEACHER_CANON_AMBIGUOUS` |
| Web | `web/src/lib/userTeacherSync.ts` — même règles |

**Implémentation autorisée (après aval) :** extraire un helper partagé **ou** porter le même algorithme dans Mobile (comportement strictement équivalent). Pas de troisième sémantique.

### 3.3 Probables / à confirmer en revue de diff

| Fichier | Motif |
|---------|-------|
| `Mobile/src/lib/contactProvisioning.ts` | Gate create ; ne pas réintroduire un id legacy |
| Tests Mobile unitaires (à créer) | AC-M1, AC-M3, AC-M4, ambiguïté |
| Harness runtime (script sous `scripts/`) | Preuve PUT state avec payload issu des règles Mobile |

### 3.4 Explicitement hors touch (Lot 1)

| Zone | Motif |
|------|-------|
| `backend/db/postgresRepository.js` findTeacherForGrade / attendance | Lot 2 |
| `backend/lib/dataIntegrityRules.js` statuts affectation | Lot 3 |
| `backend/services/userTeacherSyncService.js` logique statut Actif/Suspendu | Lot 3 (sauf si strictement nécessaire pour exporter un helper **identité** sans changer le statut) |
| Migrations SQL | Interdit |
| `backofficeDedupe.js` fusion historique | Interdit |

---

## 4. Comportement avant / après

### 4.1 Sync compte → fiche (`upsertTeacherFromUser`)

| Cas | Avant (develop) | Après Lot 1 |
|-----|-----------------|-------------|
| Aucune fiche liée, rôle enseignant | Crée `TEACHER-*` | Crée **un** `TEACHERS-*` |
| Une fiche `TEACHERS-*` liée `userId`+école | `findIndex` / match soft | **Réutilise** le canon |
| Une fiche `TEACHER-*` seule liée | Maj id conservé `TEACHER-*` | **Idem** AC-HIST-02 — pas d’auto-`TEACHERS-*` |
| Plusieurs `TEACHER-*` liés | Premier match silencieux | **No-op** tracé (aligné `TEACHER_HISTORICAL_MULTI_TWIN`) — pas de choix `twins[0]` |
| Plusieurs `TEACHERS-*` liés, 0 ou ≥2 affectations actives départageantes | Premier match | **Throw** / erreur `TEACHER_CANON_AMBIGUOUS` |
| Plusieurs `TEACHERS-*`, exactement 1 avec affectation active | Non géré | Canon = fiche affectée (même règle §4.1 V2.1) |

### 4.2 CRUD fiche enseignant Mobile

| Cas | Avant | Après |
|-----|-------|-------|
| `createInternalId("teachers")` / préfixe entity | `teachers-{ts}-…` (minuscule / non canon) | Id **`TEACHERS-*`** uniquement |
| Édition fiche existante `TEACHER-*` | Conserve id | **Conserve** id (pas d’upgrade auto) |
| Édition fiche `TEACHERS-*` | Conserve id | Conserve id |

### 4.3 Génération d’id

| Interdit après Lot 1 | Autorisé |
|----------------------|----------|
| `TEACHER-{ts}-{rand}` pour **nouvelles** fiches | `TEACHERS-{uuid\|ts-rand}` |
| Choisir silencieusement parmi plusieurs canons | Erreur structurée |

---

## 5. Ambiguïté et surface d’erreur

| Code | Quand | Propagation Mobile |
|------|-------|--------------------|
| `TEACHER_CANON_AMBIGUOUS` | Multi-`TEACHERS-*` non départageables | Bloquer la sauvegarde locale / PUT ; message opérateur + code |
| `TEACHER_HISTORICAL_MULTI_TWIN` | Multi-`TEACHER-*` seuls | No-op identité ; **ne pas** inventer un canon ; tracer (voir T1 si ACK serveur) |
| `TEACHER_CANON_REQUIRED` | Nouvelle fiche sans préfixe `TEACHERS-*` | Garde défensive |

Si le PUT atteint le backend V2.1 : le serveur reste source de vérité pour le merge ; Mobile ne doit **pas** envoyer un nouvel id `TEACHER-*` qui créerait un jumeau avant même le merge.

---

## 6. Exigences transverses dans le Lot 1

### T1 (amorçage)

| Exigence | Lot 1 |
|----------|-------|
| Exposer `identitySyncAck.skips[]` sur PUT | **Recommandé** si le harness runtime Lot 1 touche `server.js` ; **sinon** report explicite au plus tard avant clôture Lot 3 |
| Mobile affiche / journalise l’erreur `TEACHER_CANON_AMBIGUOUS` | **Obligatoire** (AC-M5) |

### T2 (périmètre Mobile)

| Exigence | Lot 1 |
|----------|-------|
| T2.1 `isTeacherUserRole` | Mobile reste aligné Web (`enseignant` \| `teacher` \| `prof*`). Alignement backend exact `"teacher"` = dette T2 globale (peut être traité en amorce backend **sans** élargir au Lot 2/3) |
| T2.3 E2E contacts-only | Remplacer / neutraliser les assertions qui exigent encore contacts-only **si** touchées ; a minima **ne pas** ajouter de nouveaux E2E artificiels `TEACHER-*` |
| Journey réel Mobile | Harness runtime prouvant AC-M1…M3 (payload conforme règles Mobile → PUT) |

---

## 7. Critères d’acceptation (gate unique)

| ID | Critère | Preuve |
|----|---------|--------|
| **AC-M1** | Sync Mobile Enseignant sans fiche → id `^TEACHERS-` | Unit Mobile + **runtime** |
| **AC-M2** | Compte déjà lié à un `TEACHERS-*` → même id, 0 nouveau | Runtime |
| **AC-M3** | Aucun **nouveau** `TEACHER-*` produit par sync/CRUD Mobile | Grep + runtime négatif |
| **AC-M4** | Twin historique seul → pas d’auto-`TEACHERS-*` | Unit (= AC-HIST-02) |
| **AC-M5** | Multi-canon → erreur `TEACHER_CANON_AMBIGUOUS` visible | Runtime / unit throw |
| **AC-M6** | CRUD create fiche → `TEACHERS-*` ; edit `TEACHER-*` conserve id | Unit / revue |
| **AC-NR1** | Non-régression : backend/Web V2.1 tests sync identité toujours verts | CI |
| **AC-NR2** | Aucune migration / fusion historique dans le diff | Revue PR |

**Gate Lot 1 = PASS** ssi AC-M1…M6 + AC-NR1…NR2 + evidence runtime publiée.

---

## 8. Preuve runtime obligatoire

| Champ | Valeur |
|-------|--------|
| Artefact | `docs/audits/evidence/teacher-record-fix-lot1-mobile-runtime-results.json` |
| Environnement | Backend + PostgreSQL (DB jetable) + harness |
| Scénarios min. | AC-M1, AC-M2, AC-M3 (négatif), AC-M4, AC-M5 |
| Contenu | HTTP status, codes erreur, `teachers[].id` avant/après, absence de nouveau `TEACHER-*` |
| Règle merge | **Aucun merge** code Lot 1 sans ce fichier **PASS** |

Limite rappelée de l’audit #103 : les constats statiques restent valides ; le merge code exige la preuve runtime dédiée.

---

## 9. Plan de tests

| Couche | Contenu |
|--------|---------|
| Unit Mobile | Nouveau fichier test `userTeacherSync` : create TEACHERS, reuse canon, HIST-02, ambiguous throw |
| Unit backend existants | `userTeacherSyncService.test.js` — non-régression CI |
| Runtime | Script `scripts/verify-teacher-record-lot1-mobile-identity.js` (nom indicatif) |
| Garde | Grep CI optionnel : `Mobile/**` ne contient plus `TEACHER-\$\{` / `TEACHER-`+\`Date` pour **génération** (les fixtures historiques `TEACHER-` en lecture restent OK) |

---

## 10. Séquence PR (après validation de ce contrat)

| Étape | Nature | Condition |
|-------|--------|-----------|
| A | Validation CTO **explicite** de ce contrat | — |
| B | PR code Lot 1 (Draft puis undraft) | Aval A |
| C | Evidence runtime jointe / PR docs associée | Avant merge B |
| D | Merge Lot 1 | CI + evidence PASS + aval CTO merge |
| E | Contrat Lot 2 | **Seulement après** D |

---

## 11. Décision demandée au CTO

| Question | Attendu |
|----------|---------|
| Valider ce contrat Lot 1 (périmètre Mobile identité + AC-M*) ? | Oui / Ajuster |
| Autoriser ensuite la PR **code** Lot 1 ? | **Oui seulement après** validation contrat |
| T1 skips ACK : amorce Lot 1 ou report Lot 3 au plus tard ? | Trancher si non couvert en B |

**Implémentation code :** **INTERDITE** jusqu’à validation explicite de ce contrat.
