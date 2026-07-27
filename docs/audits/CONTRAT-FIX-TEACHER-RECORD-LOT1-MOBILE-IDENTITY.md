# Contrat d’implémentation — Lot 1 Identité Mobile

**ID lot :** `TEACHER-RECORD-LOT1-MOBILE-IDENTITY`  
**Type :** contrat documentaire — **aucun code dans cette PR**  
**Cadrage validé :** [`PLAN-CORRECTIF-MINIMAL-TEACHER-RECORD-BLOCKERS.md`](./PLAN-CORRECTIF-MINIMAL-TEACHER-RECORD-BLOCKERS.md) (PR #104 · mergée `d51b0211`)  
**Audit source :** [`AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md`](./AUDIT-INDEPENDANT-FICHE-ENSEIGNANT.md) (PR #103 · `54b40c06`) — constat **C-04 CRITICAL CONFIRMÉE**  
**Base :** `develop` @ `d51b0211`  
**Date :** 2026-07-27  
**PR contrat :** #105 (Draft) · head à mettre à jour  

| Élément | Statut |
|---------|--------|
| Architecture Lot 1 | **VALIDÉE** (CTO) |
| Contrat (forme) | **AJUSTEMENTS INTÉGRÉS** — revalidation CTO documentaire |
| Implémentation code Lot 1 | **INTERDITE** jusqu’à validation explicite de ce contrat |
| Undraft / merge #105 | **Non autorisés** tant que revalidation CTO non prononcée |
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

Critères **AC-M1…AC-M6** + gates ci-dessous = **un seul gate fonctionnel** du Lot 1 (non séparables).

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
| `Mobile/src/lib/userTeacherSync.ts` | `newTeacherId`, `buildTeacherRow`, `upsertTeacherFromUser`, résolution canon, ambiguïté | **Cause racine** : `TEACHER-${Date.now()}-…` ; pas de résolution canon |
| `Mobile/src/screens/AdminCrudScreen.tsx` | save users → `upsertTeacherFromUser` ; `createInternalId` pour entity `teachers` | CRUD / sync déclencheurs |
| `Mobile/src/screens/TeachersScreen.tsx` | create gate / navigation | Ne pas court-circuiter le canon |
| `Mobile/src/lib/contactProvisioning.ts` | Gate create | Ne pas réintroduire un id / préfixe legacy |

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
| Tests Mobile unitaires (à créer) | AC-M1…M6, HIST-02, ambiguïté locale |
| Harness runtime (script sous `scripts/`) | **Doit importer / exécuter le vrai code Mobile** puis PUT (§8) |
| `backend/server.js` | Uniquement si la PR code Lot 1 modifie le contrat de réponse PUT (T1 serveur) |

### 3.4 Explicitement hors touch (Lot 1)

| Zone | Motif |
|------|-------|
| `backend/db/postgresRepository.js` findTeacherForGrade / attendance | Lot 2 |
| `backend/lib/dataIntegrityRules.js` statuts affectation | Lot 3 |
| `backend/services/userTeacherSyncService.js` logique statut Actif/Suspendu | Lot 3 (sauf export helper **identité** sans changer le statut) |
| Migrations SQL | Interdit |
| `backofficeDedupe.js` fusion historique | Interdit |

---

## 4. Comportement avant / après

### 4.1 Sync compte → fiche (`upsertTeacherFromUser` — **vrai helper Mobile**)

| Cas | Avant (develop) | Après Lot 1 |
|-----|-----------------|-------------|
| Aucune fiche liée, rôle enseignant | Crée `TEACHER-*` | Crée **un** `TEACHERS-*` |
| Une fiche `TEACHERS-*` liée `userId`+école | `findIndex` / match soft | **Réutilise** le canon |
| Une fiche `TEACHER-*` seule liée | Maj id conservé `TEACHER-*` | **Idem** AC-HIST-02 — pas d’auto-`TEACHERS-*` |
| Plusieurs `TEACHER-*` liés | Premier match silencieux | **No-op** + trace / journal opérateur (`TEACHER_HISTORICAL_MULTI_TWIN`) — **jamais** `twins[0]`, **jamais** création `TEACHERS-*` |
| Plusieurs `TEACHERS-*` liés, 0 ou ≥2 affectations actives départageantes | Premier match | **Blocage** `TEACHER_CANON_AMBIGUOUS` |
| Plusieurs `TEACHERS-*`, exactement 1 avec affectation active | Non géré | Canon = fiche affectée (même règle §4.1 V2.1) |

### 4.2 CRUD fiche enseignant Mobile (**vrai générateur**)

| Cas | Avant | Après |
|-----|-------|-------|
| Générateur create (`createInternalId` / équivalent teachers) | `teachers-{ts}-…` (non canon) | Id **`TEACHERS-*`** uniquement |
| Édition fiche existante `TEACHER-*` | Conserve id | **Conserve** id (pas d’upgrade auto) |
| Édition fiche `TEACHERS-*` | Conserve id | Conserve id |

### 4.3 Génération d’id

| Interdit après Lot 1 | Autorisé |
|----------------------|----------|
| `TEACHER-*` pour **nouvelles** fiches | `TEACHERS-{uuid\|ts-rand}` |
| `teachers-*` / tout préfixe non canonique pour **nouvelle** fiche | — |
| Choix silencieux parmi plusieurs canons | Erreur structurée |

---

## 5. Ambiguïté, multi-twins et surface d’erreur

### 5.1 `TEACHER_CANON_AMBIGUOUS` — **OBLIGATOIRE Lot 1** (deux niveaux)

| Niveau | Comportement attendu | Preuve |
|--------|----------------------|--------|
| **A — Mobile avant envoi** | Le vrai code Mobile détecte l’ambiguïté → **sauvegarde bloquée**, code `TEACHER_CANON_AMBIGUOUS` **visible** à l’opérateur | Unit + harness appelant le helper / parcours CRUD |
| **B — Payload ambigu atteint le serveur** | HTTP **409**, **même code** structuré, **aucune mutation** des fiches de cet enseignant | Runtime HTTP/PG |

AC-M5 exige **A et B** (indissociables).

### 5.2 `TEACHER_HISTORICAL_MULTI_TWIN` — **OBLIGATOIRE Lot 1**

| Comportement | Obligation |
|--------------|------------|
| Résultat | **No-op** identité |
| Interdit | Choix arbitraire (`twins[0]`) ; création automatique `TEACHERS-*` |
| Visibilité | Trace / journal opérateur **visible** côté Mobile |

### 5.3 Autres codes

| Code | Quand | Propagation |
|------|-------|-------------|
| `TEACHER_CANON_REQUIRED` | Nouvelle fiche sans préfixe `TEACHERS-*` | Garde défensive |

Mobile ne doit **pas** envoyer un nouvel id `TEACHER-*` qui créerait un jumeau avant le merge serveur.

---

## 6. Exigences transverses (T1 / T2) — décisions CTO figées

### 6.1 T1 — **tranché**

| Exigence | Décision Lot 1 |
|----------|----------------|
| `TEACHER_CANON_AMBIGUOUS` local Mobile → blocage sauvegarde + code visible opérateur | **OBLIGATOIRE Lot 1** |
| `TEACHER_HISTORICAL_MULTI_TWIN` local Mobile → no-op + trace/journal opérateur | **OBLIGATOIRE Lot 1** |
| `identitySyncAck.skips[]` côté serveur (réponse PUT) | **OBLIGATOIRE dans Lot 1 uniquement si** la PR code Lot 1 modifie `server.js` **ou** le contrat de réponse PUT ; **sinon** → **report explicite et enregistré au Lot 2** (pas au Lot 3 par défaut) |

Justification du report Lot 2 (si applicable) : les lots 1 puis 2 consomment déjà les écritures Mobile et notes/présences ; reporter T1 serveur au Lot 3 serait trop tardif.

Si report Lot 2 : la PR code Lot 1 **et** l’evidence runtime doivent porter une mention explicite  
`T1_SERVER_SKIPS_ACK=DEFERRED_TO_LOT2`.

### 6.2 T2 — périmètre Mobile Lot 1

| Exigence | Lot 1 |
|----------|-------|
| T2.1 `isTeacherUserRole` | Mobile reste aligné Web (`enseignant` \| `teacher` \| `prof*`). Alignement backend exact `"teacher"` = dette T2 (amorce backend autorisée **sans** ouvrir Lots 2/3) |
| T2.3 E2E contacts-only | Ne pas ajouter d’E2E artificiels `TEACHER-*` ; neutraliser assertions contacts-only **si** touchées |
| Journey | **Vrai code Mobile** → état → PUT → JSON+PG (§8) — **obligatoire** |

---

## 7. Critères d’acceptation

| ID | Critère | Preuve |
|----|---------|--------|
| **AC-M1** | Le **vrai** `upsertTeacherFromUser` Mobile, sans fiche → id `^TEACHERS-` | Unit Mobile **exécutant le module** + runtime §8 |
| **AC-M2** | Compte déjà lié à un `TEACHERS-*` → même id, 0 nouveau (vrai helper) | Runtime §8 |
| **AC-M3** | Aucun **nouveau** `TEACHER-*` après sync/CRUD Mobile + persistance | Garde §9 + runtime négatif JSON+PG |
| **AC-M4** | Twin historique seul → pas d’auto-`TEACHERS-*` (vrai helper) | Unit (= AC-HIST-02) |
| **AC-M5a** | Ambiguïté détectée **Mobile avant envoi** → sauvegarde bloquée, code visible | Unit / harness Mobile |
| **AC-M5b** | Payload ambigu au serveur → HTTP 409, même code, **aucune mutation** | Runtime HTTP/PG |
| **AC-M6** | **Vrai** générateur CRUD create → `TEACHERS-*` ; edit `TEACHER-*` conserve id | Unit / harness CRUD Mobile |
| **AC-M7** | Multi-`TEACHER-*` → no-op + journal/trace opérateur (pas de choix arbitraire) | Unit Mobile |
| **AC-G1** | Garde de génération **obligatoire** PASS (§9) | CI gate |
| **AC-NR1** | Non-régression Web/backend V2.1 sync identité | CI |
| **AC-NR2** | Aucune migration / fusion historique dans le diff | Revue PR |

---

## 8. Preuve runtime — **deux étapes indissociables**

Un payload fabriqué directement par le script **ne constitue pas** une preuve Lot 1.  
Le **runtime HTTP seul ne remplace pas** le test du code Mobile.

### 8.1 Chaîne obligatoire

```
1) Appel du VRAI helper Mobile / parcours CRUD Mobile
      → upsertTeacherFromUser (module Mobile réel)
      et/ou générateur CRUD enseignant réel (AdminCrud / équivalent)
2) État teachers[] (et users liés) PRODUIT par Mobile
3) Envoi de CET état au backend (PUT /api/backoffice/state)
4) Vérification JSON BackOffice + PostgreSQL
```

### 8.2 Le gate doit prouver

| # | Preuve |
|---|--------|
| 1 | Le véritable `upsertTeacherFromUser` Mobile **produit ou réutilise** le bon identifiant |
| 2 | Le véritable générateur CRUD enseignant Mobile produit `TEACHERS-*` |
| 3 | Le backend **accepte** cet état **sans créer** de nouvelle identité divergente |
| 4 | **Aucun** `TEACHER-*` **nouveau** n’apparaît après persistance (JSON + PG `teacher_code`) |

### 8.3 Artefact

| Champ | Valeur |
|-------|--------|
| Artefact | `docs/audits/evidence/teacher-record-fix-lot1-mobile-runtime-results.json` |
| Environnement | Backend + PostgreSQL (DB jetable) + harness important le **vrai** code Mobile |
| Scénarios min. | AC-M1, AC-M2, AC-M3, AC-M4, AC-M5a, AC-M5b, AC-M6 |
| Contenu | Étape Mobile (ids produits), HTTP status, codes erreur, `teachers[].id` avant/après, rows PG, flag `mobileCodeExecuted: true` |
| Interdit | `mobileCodeExecuted: false` ou payload handcrafté sans appel helper/CRUD Mobile |
| Règle merge | **Aucun merge** code Lot 1 sans ce fichier **PASS** |

---

## 9. Garde de génération — **gate obligatoire**

### 9.1 Formulation

> Toute expression de **génération** Mobile produisant `TEACHER-*`, `teachers-*` ou un préfixe **non canonique** pour une **nouvelle** fiche fait **échouer** le gate Lot 1.

### 9.2 Couverture minimale (fichiers)

- `Mobile/src/lib/userTeacherSync.ts`
- `Mobile/src/screens/AdminCrudScreen.tsx`
- `Mobile/src/screens/TeachersScreen.tsx`
- `Mobile/src/lib/contactProvisioning.ts`

### 9.3 Autorisé (ne fait pas échouer la garde)

| Usage | Exemple |
|-------|---------|
| Lecture / match d’ids historiques | Comparaison `/^TEACHER-/i` pour AC-HIST-02 |
| Édition conservatrice | Conserver un id `TEACHER-*` existant |
| Fixtures / tests AC-HIST-02 | Données de test en lecture |

### 9.4 Exécution

| Champ | Valeur |
|-------|--------|
| Nature | Script CI **obligatoire** (grep / AST / allowlist) dans la PR code Lot 1 |
| Résultat | FAIL CI si génération non canonique détectée hors allowlist lecture/fixture |
| Statut contrat | **Plus optionnel** |

---

## 10. Plan de tests

| Couche | Contenu |
|--------|---------|
| Unit Mobile | Tests **important** `Mobile/src/lib/userTeacherSync.ts` (+ générateur CRUD) : TEACHERS create, reuse, HIST-02, multi-twin no-op+trace, ambiguous block |
| Unit backend | `userTeacherSyncService.test.js` — non-régression V2.1 |
| Runtime | Harness §8 (Mobile réel → PUT → JSON+PG) |
| Garde | Gate CI §9 **obligatoire** |
| Ambiguïté serveur | AC-M5b : PUT ambigu → 409 sans mutation |

---

## 11. Gate final Lot 1 = PASS

```
AC-M1 … AC-M6
+ AC-M5a et AC-M5b (ambiguïté locale ET serveur)
+ AC-M7 (multi-TEACHER-* no-op + journal)
+ AC-G1 (garde de génération obligatoire)
+ AC-NR1 (non-régression Web/backend V2.1)
+ AC-NR2 (aucune migration/fusion historique)
+ tests exécutant le VRAI code Mobile
+ runtime HTTP/PG depuis l’état PRODUIT par Mobile
= PASS Lot 1
```

---

## 12. Séquence PR (après validation de ce contrat)

| Étape | Nature | Condition |
|-------|--------|-----------|
| A | Validation CTO **explicite** de ce contrat (revalidation documentaire) | Ajustements intégrés |
| B | PR code Lot 1 (Draft puis undraft) | Aval A — **pas avant** |
| C | Evidence runtime §8 + garde §9 PASS | Avant merge B |
| D | Merge Lot 1 | CI + evidence PASS + aval CTO merge |
| E | Contrat Lot 2 | **Seulement après** D |
| F | Si `T1_SERVER_SKIPS_ACK=DEFERRED_TO_LOT2` | Obligation reprise dans le contrat Lot 2 |

---

## 13. Décisions CTO déjà tranchées (rappel)

| Point | Décision |
|-------|----------|
| Architecture Lot 1 | **VALIDÉE** |
| Runtime via vrai code Mobile (2 étapes) | **Obligatoire** (correction 1) |
| Garde génération CI | **Obligatoire** (correction 2) |
| T1 local Mobile (ambiguous + multi-twin) | **Obligatoire Lot 1** (correction 3) |
| T1 `identitySyncAck.skips[]` serveur | Conditionnel Lot 1 / sinon **report Lot 2** enregistré |
| PR code Lot 1 | **NON ENCORE AUTORISÉE** |
| Undraft / merge #105 | Après revalidation CTO documentaire seulement |

**Implémentation code :** **INTERDITE** jusqu’à validation explicite de ce contrat ajusté.
