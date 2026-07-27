# Contrat d’implémentation — FIX V2.1 IDENTITY (`PRE-E1-IDENTITY-LIFECYCLE`)

**Type :** contrat d’implémentation — **aucun code dans cette PR**  
**Cadrage validé :** [`PLAN-CORRECTIF-MINIMAL-PRE-E1-V2-IDENTITY-LIFECYCLE.md`](./PLAN-CORRECTIF-MINIMAL-PRE-E1-V2-IDENTITY-LIFECYCLE.md) (PR #97 · `0644442a`)  
**Option CTO :** **Hybride A+C bornée**  
**Anomalie :** MAJOR CONFIRMÉE — revalidation CTO  
**Statut :** trois règles CTO intégrées (déterminisme · historique TEACHER-only · fallback eval) — **en attente de revalidation CTO** avant undraft/merge  

| Élément | Statut |
|---------|--------|
| Architecture A+C bornée | **VALIDÉE** |
| Périmètre fonctionnel | **VALIDÉ** |
| Déterminisme du canon | **Corrigé** (§4.1 — règle CTO) |
| Historique TEACHER-only | **Corrigé** (§3.2 / AC-HIST-02) |
| Fallback évaluation | **Tranché** (§5.2 — refus structuré, pas de user_id seul) |
| Implémentation | **INTERDITE** jusqu’à revalidation + merge de ce contrat |
| Migration / backfill / DELETE jumeaux | **INTERDITS** |
| E1 | **NO-GO** |
| HOTFIX-01/02/02B | **CLOS** |
| Preuves brutes #95/#96 | **Lecture seule** |
| PR code | **Interdite** avant revalidation CTO de ce contrat |

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
| `backend/db/postgresRepository.js` | `materializeBackOfficeTeacher`, `ensurePgUserForBackOfficeTeacher`, `findTeacherByCode`, `ensureTeacher` ; **retirer** l’usage de `findAnyTeacher` pour les **nouvelles** evaluations | Matérialisation PG + résolution exacte |
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

Le sync générique distingue **comptes nouveaux** (après activation du correctif) et **comptes historiques**.

#### A. Compte **nouveau** (création / sync post-correctif)

| Cas | Comportement requis |
|-----|---------------------|
| Exactement une fiche `TEACHERS-*` liée (`userId` exact + même établissement) | **Réutiliser** — ne pas en créer une autre |
| Plusieurs fiches `TEACHERS-*` liées | Appliquer §4.1 (déterminisme) — **jamais** un choix silencieux |
| Aucune fiche `TEACHERS-*` liée | Créer **une** fiche `id = TEACHERS-<uuid>`, `userId = user.id`, `schoolCode = S` |
| Fiche `TEACHERS-*` d’un **autre** user | Ne pas réutiliser (isolation) |

**Interdit** pour un compte nouveau : créer un id `TEACHER-*` (non `TEACHERS-`).

#### B. Compte **historique** ne possédant que `TEACHER-*` (pas de `TEACHERS-*`)

| Action | Statut |
|--------|--------|
| Création automatique d’un `TEACHERS-*` par le sync générique | **INTERDITE** |
| Fusion / suppression du `TEACHER-*` | **INTERDITE** |
| Comportement historique (multi-match authz, accès notes) | **CONSERVÉ** |
| Traitement / convergence vers `TEACHERS-*` | **Lot de consolidation ultérieur** (hors ce correctif) |

> Le sync générique **ne doit pas** créer de nouveau jumeau sur une donnée historique TEACHER-only.  
> Cela corrige la contradiction « historique inchangé » vs « créer un TEACHERS-* si seul TEACHER-* ».

#### C. Compte historique déjà jumelé (`TEACHER-*` + `TEACHERS-*`)

- Aucune fusion / DELETE.  
- Sync : **ne pas** créer d’identité supplémentaire.  
- Réutilisation du canon pour **nouvelles** écritures pédagogiques / evaluations : selon §4.1 si un `TEACHERS-*` unique (ou unique via assignment active) est déterminable ; sinon erreur structurée sur les **nouvelles** écritures ambiguës — sans toucher aux rows historiques.

### 3.3 Alignement web ↔ backend

| Couche | Règle |
|--------|-------|
| Web `newTeacherId()` | Conserver préfixe `TEACHERS-*` |
| Backend `buildTeacherFromUser` | **Même** convention `TEACHERS-*` **uniquement** pour comptes nouveaux (§3.2.A) |
| Match / sélection | **Uniquement** l’algorithme déterministe §4.1 — pas de « préférer TEACHERS-* » informel |

---

## 4. Règle de réutilisation de `TEACHERS-*` (déterminisme CTO)

### 4.1 Algorithme imposé — sélection du canon

Cette décision est **fixée dans le contrat** — **pas** laissée à l’implémentation.

```text
Entrée : user, établissement S, collection teachers[] (même schoolCode)

1. Filtrer les fiches où :
     userId exact = user.id
     AND même établissement S
     AND id matches /^TEACHERS-/i

2. Si exactement 1 fiche → la réutiliser (canon)

3. Si plusieurs fiches :
     a. Parmi elles, retenir celles référencées par au moins une
        affectation active (assignments / teacher_assignments status=active)
        pour cet établissement
     b. Si exactement 1 candidate → la réutiliser
     c. Si 0 ou >1 candidates → ERREUR STRUCTURÉE
        (ex. TEACHER_CANON_AMBIGUOUS) — ne pas continuer silencieusement

4. INTERDIT :
     - choisir sur created_at
     - « première ligne » / ordre de tableau
     - ORDER BY implicite
     - tout tie-break arbitraire qui masque l’ambiguïté
```

Le correctif **ne doit pas** masquer une ambiguïté en choisissant arbitrairement une identité.

Lien PG attendu lorsque le canon est déterminé :  
`teachers.teacher_code = canon`, `user_id` = user PG, `school_id` = établissement.  
`user_id` **vérifie** le lien ; il **ne sert pas** à départager plusieurs rows `TEACHERS-*`.

### 4.2 Création pédagogique / affectations

| Action UI / API | Règle |
|-----------------|-------|
| Créer enseignant + compte **nouveau** | Une seule fiche `TEACHERS-*` via §4.1 / §3.2.A |
| Ajouter affectation (parcours neuf) | `assignment.teacherId = canon` déterminé par §4.1 ; si erreur structurée → refuser l’écriture |
| Sync PG assignments | Inchangé fonctionnellement (02B) tant que `teacherId` est le canon `TEACHERS-*` |
| Compte historique TEACHER-only | Pas de création auto `TEACHERS-*` (§3.2.B) |

### 4.3 Option C bornée (rappel)

| Autorisé | Interdit (lot 1) |
|----------|------------------|
| Renseigner / maintenir `teachers.user_id` | Nouvelle table link |
| S’appuyer sur `school_id` / `schoolCode` | `canonicalTeacherId` additionnel |
| Canon `TEACHERS-*` via §4.1 | `UNIQUE(school_id, user_id)` SQL |

---

## 5. Résolution canonique des **nouvelles** évaluations

### 5.1 Cible

Pour toute évaluation **créée après** le correctif (parcours nominal neuf) :

| Couche | Valeur |
|--------|--------|
| JSON `evaluation.teacherId` | `TEACHERS-*` canon |
| PG `teachers.teacher_code` du `evaluations.teacher_id` | **même** `TEACHERS-*` |
| `teacher_assignments` actives | sur ce même teacher PG |

### 5.2 Chaîne de résolution — **règle CTO tranchée** (lot minimal)

Pour une **nouvelle** écriture d’évaluation :

```text
evaluation.teacherId  (attendu : TEACHERS-*)
    │
    ├─1─ Recherche exacte teachers PG :
    │      teacher_code = evaluation.teacherId
    │      AND school_id = établissement
    │
    ├─2─ Si absent : matérialisation exacte de CETTE même fiche BO
    │      (même id TEACHERS-*) via ensureTeacher / materializeBackOfficeTeacher
    │      — pas une autre fiche, pas un jumeau
    │
    └─3─ Sinon : REFUS STRUCTURÉ
           (ex. EVAL_TEACHER_UNRESOLVED / EVAL_TEACHER_REQUIRED)
```

| Autorisé | **Interdit** |
|----------|--------------|
| Lookup exact `teacher_code` + établissement | `findAnyTeacher` |
| Matérialisation de la **même** fiche `TEACHERS-*` | `ORDER BY created_at` / première ligne |
| Refus structuré si non résolu | Sélection implicite par `user_id` seul |
| Vérifier a posteriori que `user_id` du row matérialisé correspond au compte (contrôle de lien) | Utiliser `user_id` pour **choisir** entre plusieurs rows |

`user_id` sert à **vérifier** le lien canonique, **pas** à arbitrer entre plusieurs identités.

`findTeacherByAssignment` avec preferred code exact `TEACHERS-*` reste acceptable **uniquement** comme aide si le code demandé est déjà le canon explicite du payload — pas comme filet « n’importe quel teacher de la classe ».

### 5.3 Historique

- Ne pas backfiller les evaluations existantes.  
- Authz multi-fiches : **conservée** pour lectures / accès notes des enseignants déjà jumelés.  
- Ne **pas** étendre la création de nouveaux jumeaux « pour que le multi-match fonctionne ».  
- Compte historique TEACHER-only : pas de création auto `TEACHERS-*` (§3.2.B / AC-HIST-02).

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

### 6.3 Historique — AC-HIST-*

| Id | Critère |
|----|---------|
| **AC-HIST-01** | Enseignant avec jumeaux **préexistants** : conserve l’accès notes (POST/PUT autorisé selon affectation) via multi-match temporaire — **aucune** fusion/DELETE |
| **AC-HIST-02** | Rejeu du sync sur un compte historique **TEACHER-* seul** → **aucun** nouveau `TEACHERS-*` créé ; pas de fusion ; pas de suppression |

### 6.4 Preuve machine dédiée (nouvelle)

- Script / extension : ex. `npm run verify:pre-e1-v2-identity-fix` (nom indicatif)  
- Artefact **nouveau** : `docs/audits/evidence/pre-e1-v2-identity-fix-results.json`  
- Couvrir explicitement : déterminisme §4.1 (cas multi-`TEACHERS-*` → erreur), AC-HIST-02, refus structuré eval (pas de `findAnyTeacher`)  
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
- **créer automatiquement** un `TEACHERS-*` sur un compte historique TEACHER-only (AC-HIST-02) ;  
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

1. Tests de caractérisation / red (AC-NEW, AC-HIST-02, ambiguïté canon → erreur).  
2. `UserTeacherSyncService` + alignement web (§3.2 / §4.1).  
3. Résolution evaluations : retrait `findAnyTeacher` ; lookup exact + refus structuré (§5.2).  
4. Gates 02b / v1 / fix harness.  
5. Rapport preuve + checklist AC-HIST-01 / AC-HIST-02.

---

## 10. Invariants non négociables (rappel)

- Isolation tenant (`TEACHER_USER_TENANT_CONFLICT`)  
- Rôle TEACHER (`TEACHER_USER_ROLE_CONFLICT`)  
- Idempotence sync  
- POST notes nominal + refus hors périmètre  
- Pas d’orphelins **nouveaux**  
- Pas d’affaiblissement RBAC  
- **Pas de sélection arbitraire d’identité** (created_at / première ligne / user_id seul)  

---

## 11. Critères d’acceptation du **contrat** (revalidation CTO)

Ce contrat est **accepté pour merge** si :

1. Option A+C bornée et périmètre (prévention + eval nouvelles) restent fidèles à l’arbitrage #97.  
2. **Déterminisme §4.1** est explicite (plus aucune phrase « à fixer en implémentation »).  
3. **Historique TEACHER-only** : pas de création auto `TEACHERS-*` + **AC-HIST-02**.  
4. **Fallback eval** tranché : lookup exact → matérialisation exacte → **refus structuré** ; pas de `findAnyTeacher` / pas de choix par `user_id` seul.  
5. Aucun code n’accompagne la PR du contrat.

**Après revalidation CTO + merge :** une **PR Draft code** distincte pourra être ouverte — **pas avant**.

---

## 12. Références

| Document | Rôle |
|----------|------|
| Plan cadrage + §0.1 arbitrage | PR #97 |
| Rapport / preuve caractérisation | PR #95/#96 |
| `CONTRAT-HOTFIX-PRE-E1-02B.md` | Canon `TEACHERS-*` sync PG / isolation |
| Revue CTO PR #98 (trois règles) | Déterminisme · TEACHER-only · fallback eval |

---

**Fin du contrat FIX V2.1 — aucun code · aucune migration · en attente de revalidation CTO.**
