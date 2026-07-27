# Plan correctif minimal — cadrage V2.1 `PRE-E1-IDENTITY-LIFECYCLE`

**Type :** dossier de cadrage (analyse + proposition) — **aucune implémentation**  
**Autorisation CTO :** cadrage **AUTORISÉ** · implémentation **INTERDITE** · migration de données **INTERDITE**  
**Anomalie :** `PRE-E1-IDENTITY-LIFECYCLE` — **MAJOR CONFIRMÉE — revalidation CTO**  
**Preuves de caractérisation (lecture seule) :** PR #95 / #96 · [`RAPPORT-AUDIT-PRE-E1-V2-IDENTITY-LIFECYCLE.md`](./RAPPORT-AUDIT-PRE-E1-V2-IDENTITY-LIFECYCLE.md) · [`evidence/pre-e1-v2-identity-lifecycle-results.json`](./evidence/pre-e1-v2-identity-lifecycle-results.json)  
**Base :** `develop` @ `3175f433`  
**Date :** 2026-07-27  

> Ce document **ne choisit pas** l’option cible de façon exécutoire.  
> L’option retenue et le périmètre d’implémentation exigent un **nouvel arbitrage CTO explicite**.  
> Les preuves brutes `scenarios` / `questions` des PR #95/#96 **ne sont pas modifiées**.

---

## 0. Mandat et interdictions

| Élément | Statut |
|---------|--------|
| Caractérisation V2.1 | VALIDÉE |
| Cadrage plan correctif minimal | **AUTORISÉ** (ce dossier) |
| Implémentation du correctif | **INTERDITE** |
| Migration de données | **INTERDITE** |
| Modification preuves brutes #95/#96 | **INTERDITE** |
| E1 | **NO-GO** |
| HOTFIX-01 / 02 / 02B | **CLOS** — ne pas rouvrir |
| Contrat prochain sujet V2 | **Différé** jusqu’à examen de ce cadrage |

---

## 1. Anomalie confirmée (rappel factuel)

| Fait | Preuve |
|------|--------|
| PUT contact+user crée spontanément `TEACHER-*` | ID-04A / Q4-CREATE |
| Fiche pédagogique ajoute ensuite `TEACHERS-*` | ID-04A |
| Les deux coexistent sans fusion | ID-04A · ID-04B / Q4-PRESERVE |
| `assignment.teacherId` JSON et affectation PG s’ancrent sur `TEACHERS-*` | ID-02 · Q3 · Q5 |
| `evaluation.teacherId` JSON = `TEACHERS-*` mais `evaluations.teacher_id` PG peut résoudre vers `TEACHER-*` | Q7-NOMINAL · Q7-FIXTURE |
| `teachers.user_id` du row canonique d’affectation lié au user de session | Q6 |
| POST notes nominal 201 via `pg_teacher_assignment` | ID-03 |

**Problème à traiter (cadrage) :** deux cycles d’écriture produisent deux identités pédagogiques pour le même acteur ; les références (affectation vs évaluation) peuvent diverger ; la dette est structurante pour SoT bulletins.

---

## 2. Points d’écriture précis

### 2.1 Création de `TEACHER-*` (nominal)

| Étape | Mécanisme | Artefact |
|-------|-----------|----------|
| Compte utilisateur rôle Enseignant persisté via `PUT /api/backoffice/state` | `UserTeacherSyncService.buildTeacherFromUser` | `backend/services/userTeacherSyncService.js` |
| Si aucune fiche match (`userId` / `identifier`) | `id: TEACHER-${Date.now()}` | même fichier ~L67–L69 |
| Déclencheur typique | Contact enseignant + `hasAccess` / compte user (parcours BO) | `server.js` + sync teachers from user accounts |

**Constats V2.1 :** ce PUT **seul** suffit à matérialiser un `TEACHER-*` JSON **et** un row PG `teachers.teacher_code = TEACHER-*` (via sync staff ultérieur / même batch).

### 2.2 Création de `TEACHERS-*` (nominal)

| Étape | Mécanisme | Artefact |
|-------|-----------|----------|
| Création fiche pédagogique / affectations UI | id généré `TEACHERS-*` (`newId("TEACHERS")` côté clients / harness) | surfaces enseignants + workflow affectations |
| Sync BO → PG | `resolveStableTeacherCode` **préfère** `TEACHERS-*` | `backend/lib/pedagogyStaffBoPersistence.js` |
| Affectation | `assignment.teacherId = TEACHERS-*` → `teacher_assignments` | HOTFIX-02B |

### 2.3 Non-fusion

| Mécanisme | Comportement | Artefact |
|-----------|--------------|----------|
| Dedupe BO teachers | **Ne fusionne pas** `TEACHERS-*` ↔ `TEACHER-*` (volontaire 02B) | `backend/lib/backofficeDedupe.js` |
| Match multi-fiches notes | Authz tente **toutes** les fiches liées user/identifier | `postgresRepository.js` (fallback BO / PG) |

### 2.4 Divergence `evaluations.teacher_id`

| Couche | Valeur observée (preuve) |
|--------|--------------------------|
| JSON `evaluation.teacherId` | `TEACHERS-*` (auteur / fiche d’affectation) |
| PG `evaluations.teacher_id` → `teachers.teacher_code` | souvent `TEACHER-*` (row créé plus tôt / résolution lookup) |

**Hypothèse de causalité (à confirmer en implémentation, non exécutée ici) :** la résolution PG de l’enseignant pour l’évaluation privilégie une clé `TEACHER-*` / user déjà matérialisée, alors que le payload JSON porte l’id d’affectation `TEACHERS-*`.

### 2.5 Cartographie des couches impactées

```text
Contact + User (ENS-*) ──► UserTeacherSync ──► teachers JSON TEACHER-*
                                              └─► users PG + teachers PG (TEACHER-*)

Fiche pédagogique     ──► teachers JSON TEACHERS-* + assignments
                                              └─► teachers PG (TEACHERS-*) + teacher_assignments

PUT/POST notes        ──► evaluations JSON teacherId=TEACHERS-*
                                              └─► evaluations.teacher_id → souvent TEACHER-* PG

JWT / session         ──► identifier ENS-* / user_code USERS-*
                                              └─► authz notes (multi-fiches liées)
```

---

## 3. Identité canonique cible — définition (sans mise en œuvre)

Le correctif minimal doit **définir explicitement** trois notions distinctes :

| Notion | Rôle | Exemple actuel |
|--------|------|----------------|
| **Identité compte** | Login / JWT / `users` | `USERS-*`, `identifier` `ENS-*` |
| **Identité pédagogique** | Fiche métier enseignants / affectations / notes | aujourd’hui **ambiguë** (`TEACHER-*` vs `TEACHERS-*`) |
| **Lien canonique** | Relation 1–1 (ou 1–1 scopée école) compte ↔ pédagogique | aujourd’hui **implicite** (`userId`, `identifier`, multi-rows PG) |

**Invariant cible (proposition de cadrage, non implémentée) :**

> Pour un couple `(schoolCode, user_code)` actif rôle enseignant, il existe **au plus une** identité pédagogique canonique utilisée pour :  
> `assignments.teacherId` · `teacher_assignments` · `evaluations.teacherId` / `evaluations.teacher_id` · lectures SoT bulletin.

Les options §5 choisissent **quelle** forme prend cette identité pédagogique et **comment** le lien au compte est matérialisé.

---

## 4. Stratégie minimale proposée (structure, pas d’exécution)

Séparer **strictement** deux volets :

### 4.1 Nouvelles créations (prévention — priorité)

Objectif : **empêcher** la naissance de nouveaux jumeaux.

Pistes (selon option §5) :

| Levier | Intention |
|--------|-----------|
| Sync user → teacher | Ne plus créer un **second** id si une fiche pédagogique existe déjà pour le user ; ou créer directement l’id canonique choisi |
| Création fiche pédagogique | Réutiliser la fiche liée au user au lieu d’un `newId("TEACHERS")` parallèle |
| Dedupe / guards serveur | Refuser ou coalescer les doubles écritures **nouvelles** (sans toucher HOTFIX-02 isolation) |
| Contrat d’API state | Documenter : un user enseignant ⇒ une fiche `teachers[]` canonique |

### 4.2 Identités existantes (remédiation — différée / optionnelle)

Objectif : **ne pas** migrer en masse dans le lot minimal sans arbitrage.

| Approche | Nature |
|----------|--------|
| Gel + prévention seule | Stopper la dette nouvelle ; laisser l’historique coexister avec règles de résolution |
| Mapping explicite (table / champ) | Relier jumeaux sans supprimer |
| Convergence / rewrite d’ids | Migration — **hors scope** tant que non autorisée |
| Backfill `evaluations.teacher_id` | Migration données — **INTERDITE** dans ce mandat |

**Règle de cadrage :** le lot minimal **doit** couvrir §4.1 ; §4.2 ne démarre qu’avec arbitrage CTO + plan de migration dédié.

---

## 5. Comparaison des options cibles

### Option A — `TEACHERS-*` comme identité pédagogique canonique

**Alignement actuel :** affectations + `resolveStableTeacherCode` (02B) + payload notes JSON.

| | |
|--|--|
| **Avantages** | Cohérent avec HOTFIX-02B et le chemin d’affectation déjà prouvé ; JSON notes déjà majoritairement `TEACHERS-*` ; moindre rupture UI pédagogique |
| **Risques** | Le sync user crée encore `TEACHER-*` en premier → il faut **détourner ou supprimer** ce point d’écriture ; evaluations PG pointent souvent vers `TEACHER-*` → divergence à corriger côté résolution (code) avant toute migration |
| **Coût migration** | Moyen si on ne fait que la prévention ; élevé si backfill evaluations / suppression des rows `TEACHER-*` |
| **Compatibilité données existantes** | Bonne pour assignments ; dette sur evaluations historiques et rows `TEACHER-*` orphelins de fait |

### Option B — `TEACHER-*` comme identité pédagogique canonique

**Alignement actuel :** création spontanée user sync ; souvent row PG d’évaluation.

| | |
|--|--|
| **Avantages** | Suit le premier point d’écriture nominal (contact+user) ; peut simplifier le lien user→teacher |
| **Risques** | Contredit le canon 02B (`TEACHERS-*` préféré) ; impose de réécrire les affectations / UI qui génèrent `TEACHERS-*` ; risque de régression POST notes / assignments déjà verts en 02B/V1 |
| **Coût migration** | Élevé (assignments JSON + `teacher_assignments` + clients) |
| **Compatibilité** | Mauvaise avec l’état post-02B sans chantier large |

### Option C — Correspondance explicite compte ↔ identité pédagogique

Introduire un lien premier-classe (ex. `teachers.user_id` déjà présent + **contrainte** 1–1 scopée école, et/ou table `user_teacher_link`, et/ou champ `canonicalTeacherId` sur user), **indépendamment** du préfixe `TEACHER` vs `TEACHERS`.

| | |
|--|--|
| **Avantages** | Traite la cause racine (ambiguïté multi-ids) ; permet de conserver temporairement les deux préfixes tout en déclarant **un** canon par user ; meilleure évolution long terme SoT |
| **Risques** | Conception + enforcement serveur plus larges ; tentation de migration ; complexité de transition |
| **Coût migration** | Variable : bas si « lien + prévention » seulement ; élevé si normalisation d’ids |
| **Compatibilité** | Meilleure si on **ajoute** le lien sans delete ; les jumeaux historiques restent lisibles via mapping |

### Synthèse comparative (aide à l’arbitrage)

| Critère | A (`TEACHERS-*`) | B (`TEACHER-*`) | C (mapping explicite) |
|---------|------------------|-----------------|------------------------|
| Continuité HOTFIX-02B | ★★★ | ★ | ★★ |
| Stop nouveaux jumeaux (minimal) | ★★ | ★★ | ★★★ |
| Évite migration immédiate | ★★ | ★ | ★★★ |
| SoT evaluations | ★★ (à aligner) | ★★ | ★★★ |
| Surface de changement code | Moyenne | Large | Moyenne→large |
| Recommandation de **cadrage** (non exécutoire) | **Favorite pour lot minimal** si couplée à un **stop** du sync `TEACHER-*` parallèle | Déconseillée comme premier lot | **Favorite stratégique** ; peut **cadrer** le lot minimal (lien + prévention) sans choisir encore le préfixe final |

**Proposition de cadrage pour arbitrage CTO (non implémentée) :**

1. **Court terme (lot minimal) :** Option **A opérationnelle** + prévention : une seule fiche pédagogique écrite pour les **nouvelles** créations, id `TEACHERS-*` (ou réutilisation), **interdiction** de créer un second `TEACHER-*` si un lien user existe.  
2. **Cadre durable :** Option **C** (contrainte / mapping explicite user↔teacher) comme socle, sans migration destructive.  
3. **Éviter Option B** comme premier correctif (coût / régression 02B).

---

## 6. Impacts par surface

| Surface | Impact si lot minimal (prévention A±C) | Impact si remédiation existants |
|---------|----------------------------------------|----------------------------------|
| **BackOffice JSON `teachers[]`** | Une fiche par user (nouvelles) ; déduplique à l’écriture | Optionnel : marquage `canonical` / soft-hide jumeau |
| **`users` PG** | Inchangé (compte) ; éventuellement enforcement rôle TEACHER déjà 02B | — |
| **`teachers` PG** | Un `teacher_code` canonique lié `user_id` pour les nouveaux | Mapping / pas de DELETE sans aval |
| **`teacher_assignments`** | Continuer sur `TEACHERS-*` (A) | Réécriture = migration (hors scope) |
| **`evaluations.teacher_id`** | Aligner la **résolution d’écriture** sur le canon (code) pour le **futur** | Backfill = migration (interdit maintenant) |
| **Session / JWT** | Inchangé (`ENS-*` / `USERS-*`) | — |
| **Authz notes** | Conserver multi-match **temporairement** pour ne pas casser l’historique ; documenter dette de simplification | Retirer fallback multi-fiches seulement après convergence |

---

## 7. Invariants à préserver (non-négociables)

| Invariant | Référence / gate |
|-----------|------------------|
| Isolation tenant | `TEACHER_USER_TENANT_CONFLICT` · 02B-TENANT |
| Rôle TEACHER (pas de lien PARENT→teacher) | `TEACHER_USER_ROLE_CONFLICT` · 02B-ROLE |
| Idempotence sync staff | 02B-REPLAY · ID-05 |
| POST notes nominal 201 (affectation valide) | ID-03 · `verify:pre-e1-v1` / 02b |
| Pas d’orphelins **nouveaux** (assignment sans teacher, eval sans teacher résoluble) | V2 SoT |
| Pas d’affaiblissement RBAC / fallback authz « large » | Contrats HOTFIX notes |
| Pas de réouverture HOTFIX-02 logique isolation | Décision clôture CTO |

Tout plan d’implémentation futur devra **rejouer** ces invariants avant merge.

---

## 8. Tests de non-régression et critères d’acceptation (futurs)

### 8.1 Gates existants à conserver verts

```text
npm run verify:pre-e1-hotfix-02b
npm run verify:pre-e1-v1
npm run verify:pre-e1-v2-identity   # caractérisation — adapter assertions si contrat évolue
npm run check
```

### 8.2 Critères d’acceptation proposés pour un **futur** lot d’implémentation (non démarré)

| Id | Critère | Portée |
|----|---------|--------|
| **AC-NEW-01** | Création contact+user enseignant **ne crée pas** un second id si fiche pédagogique déjà présente (ou crée directement le canon unique) | Nouvelles créations |
| **AC-NEW-02** | Création fiche pédagogique + affectation ⇒ **un seul** `teachers[]` lié au user | Nouvelles |
| **AC-NEW-03** | Après sync : au plus **un** row `teachers` PG actif lié à `user_id` pour l’école (nouvelles) | Nouvelles |
| **AC-NEW-04** | `evaluation.teacherId` JSON et `evaluations.teacher_id` PG résolvent le **même** `teacher_code` canonique (parcours nominal neuf) | Nouvelles |
| **AC-REG-01** | POST notes 201 + refus hors affectation / hors tenant inchangés | Régression |
| **AC-REG-02** | TENANT / ROLE / REPLAY / ACK-ISOLATION 02B toujours verts | Régression |
| **AC-HIST-01** | Données historiques jumelées : **pas de perte** d’accès notes pour enseignants existants (multi-match temporaire OK) | Existants |
| **AC-OUT-01** | Aucune migration destructive ; aucune fusion forcée sans aval CTO | Gouvernance |

### 8.3 Preuve machine dédiée (future)

Suggestion : `docs/audits/evidence/pre-e1-v2-identity-fix-*.json` — **nouveau** fichier ; **ne pas** altérer `pre-e1-v2-identity-lifecycle-results.json`.

---

## 9. Classification des opérations proposées

### 9.1 Obligatoire (pour un lot minimal futur, après aval CTO)

| Opération | Motif |
|-----------|-------|
| Choisir l’option cible (A / C / hybride) par arbitrage CTO | Bloque le design |
| Stopper la **double création** sur le chemin nominal (user sync vs fiche pédagogique) | Cause racine ID-04A |
| Aligner la **résolution d’écriture** evaluations → teacher canonique pour les **nouveaux** flux | Cause Q7 future |
| Conserver invariants §7 + gates §8.1 | Non-régression |
| Documenter contrat d’identité (compte vs pédagogique vs lien) | Gouvernance |

### 9.2 Optionnelle (second rideau, aval séparé)

| Opération | Motif |
|-----------|-------|
| Mapping explicite / contrainte UNIQUE `(school_id, user_id)` sur `teachers` | Renforce Option C |
| Soft-flag `deprecated` sur jumeaux historiques | Lisibilité sans migration |
| Simplifier authz multi-fiches une fois convergence prouvée | Dettes |
| UI : empêcher création manuelle d’une 2ᵉ fiche | Prévention UX |
| Étendre caractérisation V2.1 (comptages prod/préprod) | Preuve terrain |

### 9.3 Explicitement hors scope (ce cadrage + mandat actuel)

| Opération | Motif |
|-----------|-------|
| Toute implémentation code métier **maintenant** | Interdit |
| Migration / backfill `evaluations.teacher_id` | Migration interdite |
| DELETE / merge destructif des rows `TEACHER-*` | Migration / risque orphelins |
| Réécriture massive `assignments.teacherId` | Migration |
| Changement schéma bulletins / E1 | NO-GO |
| Réouverture HOTFIX-02 / 02B | Clos |
| `PRE-E1-STUDENT-CODE-SCOPE` | Contrat V2 dédié différé |
| Suppression immédiate du fallback authz BO | Hors IDENTITY minimal |
| Option B comme premier lot | Coût / régression 02B |

---

## 10. Découpage suggéré d’un futur chantier (après arbitrage)

| Lot | Contenu | Prérequis |
|-----|---------|-----------|
| **V2.1-FIX-0** | Arbitrage CTO option A / C / hybride + contrat d’implémentation | Ce dossier |
| **V2.1-FIX-1** | Prévention nouvelles créations seulement + tests AC-NEW-* / AC-REG-* | Aval FIX-0 |
| **V2.1-FIX-2** | Alignement écriture evaluations (nouveaux flux) | FIX-1 vert |
| **V2.1-FIX-3** | Mapping / remédiation existants (si autorisé) | Aval migration distinct |

**Aucun de ces lots n’est autorisé à démarrer par le présent document.**

---

## 11. Questions ouvertes pour l’arbitrage CTO

1. Option cible retenue : **A**, **C**, ou **hybride A+C** (recommandation de cadrage) ?  
2. Le lot minimal inclut-il **uniquement** la prévention (§4.1), ou aussi l’alignement d’écriture evaluations pour nouveaux flux (§ FIX-2) ?  
3. Autorise-t-on une contrainte PG `UNIQUE(school_id, user_id)` filtrée (teachers actifs) sans backfill ?  
4. Les jumeaux historiques restent-ils supportés via multi-match authz jusqu’à un lot migration dédié ?  
5. Faut-il un contrat d’implémentation séparé (`CONTRAT-HOTFIX-…` / `CONTRAT-FIX-V2.1-IDENTITY`) avant toute PR code ?

---

## 12. Recommandation de cadrage (non exécutoire)

| Élément | Proposition |
|---------|-------------|
| Option | **Hybride : A (canon pédagogique `TEACHERS-*`) + C (lien explicite user↔teacher)** |
| Périmètre minimal | **Prévention des nouveaux jumeaux** + résolution d’écriture evaluations alignée sur le canon pour **nouveaux** parcours |
| Existants | **Gel** (pas de migration) + authz multi-fiches conservée |
| Sévérité | MAJOR confirmée — **pas** BLOCKER/CRITICAL |
| Prochaine étape | Arbitrage CTO sur §11 → contrat d’implémentation → seulement alors PR code |

---

## 13. Références

| Document | Rôle |
|----------|------|
| [`RAPPORT-AUDIT-PRE-E1-V2-IDENTITY-LIFECYCLE.md`](./RAPPORT-AUDIT-PRE-E1-V2-IDENTITY-LIFECYCLE.md) | Caractérisation validée |
| [`CONTRAT-AUDIT-PRE-E1-V2.md`](./CONTRAT-AUDIT-PRE-E1-V2.md) | Contrat V2.1 |
| [`DECISION-CTO-OUVERTURE-AUDIT-V2.md`](./DECISION-CTO-OUVERTURE-AUDIT-V2.md) | Ouverture V2 |
| `backend/services/userTeacherSyncService.js` | Point d’écriture `TEACHER-*` |
| `backend/lib/pedagogyStaffBoPersistence.js` | Canon `TEACHERS-*` sync PG |
| `backend/lib/backofficeDedupe.js` | Non-fusion volontaire |

---

**Fin du dossier de cadrage — aucune implémentation · aucune migration · aucun correctif démarré.**
