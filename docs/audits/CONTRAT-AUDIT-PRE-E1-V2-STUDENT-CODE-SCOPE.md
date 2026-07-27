# Contrat d’audit Pré-E1 — Phase V2.2 · `PRE-E1-STUDENT-CODE-SCOPE`

**Type :** contrat d’audit (caractérisation) — **aucune implémentation**  
**Lot :** **V2.2**  
**Sujet :** **`PRE-E1-STUDENT-CODE-SCOPE`**  
**Criticité documentée (historique) :** **MAJOR**  
**Statut :** Contrat défini — caractérisation **à exécuter** (pas commencée dans cette PR)  
**Base :** `develop` @ `0e7d559a` (post clôture technique FIX V2.1 · PR #100)  
**Date :** 2026-07-27  
**Autorisation CTO :** ouverture V2.2 — 2026-07-27  

**Prédécesseurs :**  
- Audit V2 ouvert · [`CONTRAT-AUDIT-PRE-E1-V2.md`](./CONTRAT-AUDIT-PRE-E1-V2.md)  
- V2.1 `PRE-E1-IDENTITY-LIFECYCLE` · **CLOS TECHNIQUEMENT** ([`DECISION-CTO-CLOTURE-FIX-V2.1-IDENTITY.md`](./DECISION-CTO-CLOTURE-FIX-V2.1-IDENTITY.md))  
- ID-06 V2.1 : comparaison élève **bornée / contexte uniquement** — **aucune** décision `student_code`  

---

## 0. Nature du lot

| Champ | Valeur |
|-------|--------|
| Phase | **V2 — Modèle de données & intégrité** |
| Lot | **V2.2** |
| Nature | **Audit uniquement** (caractérisation) |
| E1 | **NO-GO** |
| Implémentation métier | **INTERDITE** |
| HOTFIX-01 / 02 / 02B | **CLOS** — ne pas rouvrir |
| FIX V2.1 IDENTITY | **CLOS TECHNIQUEMENT** — ne pas rouvrir |
| Consolidation jumeaux enseignants | **DIFFÉRÉE / NON AUTORISÉE** |
| Correctif `student_code` | **Interdit** tant qu’aucune anomalie n’est **démontrée** puis validée CTO |

### Méthode obligatoire

1. Exécuter la caractérisation selon ce contrat  
2. Produire preuves machine **dédiées V2.2** (nouveaux artefacts)  
3. Classer chaque question / scénario : **confirmé** · **infirmé** · **indéterminé**  
4. **Seulement après** preuve d’anomalie : soumettre un **cadrage correctif minimal** à validation CTO  

**Aucun correctif ne commence directement.**

---

## 1. Motifs de sélection (décision CTO)

1. Dette déjà identifiée dans le périmètre V2 (`PRE-E1-STUDENT-CODE-SCOPE`).  
2. ID-06 de V2.1 a **volontairement** évité de la trancher (réserve CTO).  
3. Concerne directement : **intégrité**, **isolation établissement**, **contraintes PostgreSQL**.  
4. Doit être caractérisée **avant** les sujets plus larges (fallback authz, consolidation historique enseignants).

---

## 2. Constat documentaire de départ (hypothèses à **vérifier**, non conclusions)

> Ces points sont des **entrées d’audit** issues des livrables HOTFIX-01 / bilans V1.  
> Ils ne valent **pas** classification « confirmé » pour V2.2 sans rejeu dédié.

| Source | Affirmation documentaire |
|--------|--------------------------|
| `backend/db/schema.sql` | `students.student_code VARCHAR(64) NOT NULL UNIQUE` — **unicité globale** de colonne |
| Index | `idx_students_school_id` · `idx_students_school_search (school_id, student_code, …)` — **pas** de UNIQUE composite `(school_id, student_code)` |
| HOTFIX-01 | Mapping `matricule ?? publicId ?? id` → `student_code` ; lookup scopé école ; `409 STUDENT_TENANT_CONFLICT` si code déjà porté par un autre `school_id` |
| Matérialisation PG | `ON CONFLICT (student_code) DO UPDATE … WHERE students.school_id = EXCLUDED.school_id` |
| Dette nommée | Arbitrage reporté : unicité **globale** vs composite **`(school_id, student_code)`** |

---

## 3. Objet de la caractérisation V2.2

Déterminer la **portée réelle** et les **effets observables** de `student_code` (et de ses équivalents JSON) dans le système actuel, sans modifier le modèle.

### 3.1 Portée à trancher (question centrale)

Quelle est la portée **effective** de `student_code` ?

| Hypothèse | Signification opérationnelle |
|-----------|------------------------------|
| **Globale** | Un même `student_code` ne peut exister qu’une fois dans toute la base (contrainte UNIQUE colonne) |
| **Établissement** | Unicité attendue / souhaitée par `(school_id, student_code)` — à confronter au schéma réel |
| **Année scolaire** | Unicité liée à une inscription / année — à prouver ou infirmer |
| **Autre** | Ex. dérivée de `matricule` local, `publicId`, id `STUDENTS-*`, combinaison |

La caractérisation doit dire **ce que le système fait aujourd’hui**, pas ce qu’il « devrait » faire.

### 3.2 Producteurs de la valeur (points d’écriture candidats)

Cartographier **où** la valeur est créée ou mutée :

| Producteur | Zone / symbole (piste) | À prouver |
|------------|------------------------|-----------|
| Création BO (UI / state) | `students[]` JSON : `id`, `matricule`, `publicId`, `schoolCode` | Qui génère `STUDENTS-*` / matricule ? |
| Import / onboarding | chaînes e2e / contacts → élève | Code stable ou régénéré ? |
| Sync BO → PG | `syncStudentsDomainFromBackOffice` · `materializeBackOfficeStudent` · `resolveStableStudentCode` | Mapping exact `matricule ?? publicId ?? id` |
| Seed / dataset runtime | `postgresRepository` seed / `getDataset` | Codes seed collisionnent-ils avec BO ? |
| API notes | `resolveStudentForGrade` | Lookup par code / UUID scopé école |

### 3.3 Contraintes et index PostgreSQL actuels

| Objet | Définition documentée | À vérifier en base de rejeu |
|-------|----------------------|----------------------------|
| Colonne | `students.student_code NOT NULL` | Oui |
| UNIQUE | `UNIQUE` sur `student_code` (globale) | Confirmer via `\d students` / catalogue |
| FK | `school_id → schools(id)` | Oui |
| Index non unique | `idx_students_school_id` · `idx_students_school_search` | Lister |
| Enrollments | `UNIQUE (student_id, academic_year_id)` | Lien inscription ≠ unicité code |
| Grades | `UNIQUE (school_id, evaluation_id, student_id)` (via `student_id` UUID) | Référence via UUID PG, pas le code textuel |

**Interdit en V2.2 :** modifier / ajouter / supprimer toute contrainte UNIQUE.

### 3.4 Références à `student_code` / ids élèves

| Domaine | Forme observée (piste) | Question d’audit |
|---------|------------------------|------------------|
| JSON BO `students[]` | `id` (`STUDENTS-*`), `matricule`, `publicId` | Lequel est écrit en PG `student_code` ? |
| Notes JSON | `studentId` | Aligné sur `id` BO ou sur `student_code` PG ? |
| Évaluations | rattachement élève via notes / classe | Pas de `student_code` direct sur eval ? |
| Bulletins / documents | chemins / libellés avec `student_code` | Lecture seule |
| API `POST /api/notes` | résolution `resolveStudentForGrade` | Isolation école + conflit tenant |
| API listes | filtres `studentCode` / matricule | Cohérence affichage |
| Users | éventuel `user_code = student_code` (jointures seed) | Collision compte / élève ? |

### 3.5 Collisions

| Type | Scénario | Effet attendu à **mesurer** |
|------|----------|------------------------------|
| **Inter-écoles** | Même code dans école A et B | UNIQUE global refuse ? `STUDENT_TENANT_CONFLICT` ? écrasement ? |
| **Intra-école** | Deux fiches BO → même `student_code` | Dédup ? double row ? rejet ACK ? |
| **Seed vs BO** | Code seed = id BO d’une autre école | Conflit à la matérialisation |

### 3.6 Transfert / réinscription

| Événement | Questions |
|-----------|-----------|
| Changement de `schoolCode` sur fiche BO | Le `student_code` suit-il ? Nouvelle row PG ? Conflit UNIQUE ? |
| Réinscription même établissement (nouvelle année) | `enrollments` UNIQUE `(student_id, academic_year_id)` — le code reste-t-il stable ? |
| « Transfert » simulé (même identité humaine, autre école) | Possible sans changer le code ? Bloqué par UNIQUE global ? |

> Pas de workflow produit « transfert » à inventer : caractériser les **écritures existantes** (PUT state, sync, ensure).

---

## 4. Questions d’audit (à trancher par preuve)

| # | Question |
|---|----------|
| **Q1** | Quelle est la contrainte d’unicité **effective** en PG sur `student_code` (globale / composite / autre) ? |
| **Q2** | Quelle chaîne de priorité produit `student_code` depuis le BO (`matricule` / `publicId` / `id`) — et est-elle stable sur re-PUT ? |
| **Q3** | Un même `student_code` peut-il être matérialisé pour **deux** `school_id` distincts ? Sinon, quel code d’erreur / comportement ? |
| **Q4** | Deux élèves **intra-école** avec le même code stable convergent-ils vers **une** row PG ou prolifèrent-ils ? |
| **Q5** | Les notes (`grades.student_id` / JSON `studentId`) référencent-elles toujours la row PG résolue par `student_code` de l’école de l’évaluation ? |
| **Q6** | Un changement de `schoolCode` (transfert simulé) sur une fiche existante : que devient la row PG (update `school_id`, nouvelle row, conflit, no-op) ? |
| **Q7** | Y a-t-il divergence JSON↔PG sur l’identifiant élève en parcours nominal (au-delà du constat contextuel ID-06 V2.1) ? |

---

## 5. Scénarios de preuve reproductibles

Chaque scénario produit une entrée dans la preuve machine dédiée V2.2.  
**Ne pas** modifier : preuves V1, HOTFIX-01/02/02B, V2.1 identity (brutes ou post-merge).

| ID | Scénario | Protocole minimal | Sortie attendue (mesure) |
|----|----------|-------------------|--------------------------|
| **SC-01** | Inventaire schéma | Lecture `schema.sql` + introspection PG rejeu | DDL UNIQUE / index listés |
| **SC-02** | Création nominale 1 élève / 1 école | PUT state élèves → sync → SELECT PG | `student_code` = f(matricule/publicId/id) |
| **SC-03** | Collision **inter-écoles** | École A matérialise code `C` ; école B tente le même `C` | HTTP/ACK/`STUDENT_TENANT_CONFLICT` / row count |
| **SC-04** | Collision **intra-école** | Deux records BO même code stable, même `schoolCode` | 1 vs N rows PG · ACK rejected |
| **SC-05** | Notes / résolution | Élève sync + `POST /api/notes` (ou PUT notes) | `grades.student_id` = UUID de la row attendue · isolation |
| **SC-06** | Transfert simulé | PUT change `schoolCode` d’un élève déjà en PG | Comportement school_id / conflit / nouvelle identité |
| **SC-07** | Réinscription année | 2ᵉ enrollment même `student_id`, autre `academic_year_id` | UNIQUE enrollments respecté · code inchangé |
| **SC-08** | Replay sync | Double PUT / sync identique | Idempotence : pas de prolifération de rows |

### 5.1 Harness / commandes autorisés

| Action | Autorisé |
|--------|----------|
| Nouveau script `verify:pre-e1-v2-student-code` (indicatif) | Oui — **nouveau** fichier |
| Réutiliser gates V1 / HOTFIX-01 en **lecture** | Oui — sans les modifier pour « faire passer » un correctif |
| Nouveau artefact `docs/audits/evidence/pre-e1-v2-student-code-scope-results.json` | Oui |
| Modifier `schema.sql` / migrations | **Non** |
| Modifier `studentsBoPersistence` / repository | **Non** |

---

## 6. Classification du résultat

Chaque question Q1–Q7 et chaque scénario SC-01…SC-08 reçoit **une** classe :

| Classe | Définition opérationnelle |
|--------|---------------------------|
| **Confirmé** | Comportement / écart **reproductible** avec preuve machine dédiée V2.2 |
| **Infirmé** | Comportement redouté **non observé** sur le protocole exécuté (preuves à l’appui) |
| **Indéterminé** | Preuve insuffisante, environnement non conclusif, ou dépendance hors scénario — à relancer ou borner |

### 6.1 Synthèse dette `PRE-E1-STUDENT-CODE-SCOPE`

| Synthèse | Condition |
|----------|-----------|
| **Maintenue MAJOR (confirmée)** | Écart de portée / collision / divergence SoT **confirmé** (ex. UNIQUE globale incompatible avec isolation métier attendue, ou collision inter-écoles pathologique) |
| **Requalifiée** | Uniquement sur faits prouvés + validation CTO |
| **Infirmée** | Tous les écarts redoutés du contrat sont **infirmés** |
| **Indéterminée** | Trop de Q/SC en indéterminé → pas de cadrage correctif |

### 6.2 Sévérité (si anomalie confirmée)

Classer **BLOCKER / CRITICAL / MAJOR / MINOR / INFORMATION** avec impact : isolation établissement · notes/bulletins · intégrité PG · SoT JSON↔PG.  
La sévérité historique « MAJOR » n’est **pas** une preuve ; elle peut être confirmée ou ajustée **après** caractérisation.

---

## 7. Livrables V2.2

| Ordre | Livrable | Contenu |
|-------|----------|---------|
| **L0** | **Ce contrat** | Sélection + critères de preuve |
| **L1** | Rapport de caractérisation | `docs/audits/RAPPORT-AUDIT-PRE-E1-V2-STUDENT-CODE-SCOPE.md` (indicatif) |
| **L1b** | Preuve machine | `docs/audits/evidence/pre-e1-v2-student-code-scope-results.json` |
| **L2** *(conditionnel)* | Cadrage correctif **minimal** | Uniquement si ≥1 anomalie **confirmée** — soumis à **validation CTO** avant toute PR de code |

### 7.1 Contenu minimal du rapport L1

1. Matrice Q1–Q7 × Confirmé / Infirmé / Indéterminé  
2. Table SC-01…SC-08 avec extraits d’identifiants / codes erreur  
3. Schéma : producteurs → `student_code` → références notes/API  
4. Verdict portée réelle (globale / établissement / autre) **prouvé**  
5. Décision : maintenir / requalifier / infirmer la dette — **sans** démarrer de correctif  

---

## 8. Interdictions (rappel dur)

| Interdit | |
|----------|--|
| Modification de contrainte `UNIQUE` | ❌ |
| Migration / backfill | ❌ |
| Régénération de codes élèves | ❌ |
| Correctif métier / refactor modèle étudiant | ❌ |
| Ouverture E1 | ❌ |
| Réouverture HOTFIX / FIX V2.1 | ❌ |
| Fusion / DELETE jumeaux enseignants | ❌ |
| Modifier preuves historiques V1 / HF / V2.1 | ❌ |

---

## 9. Hors périmètre V2.2

| Sujet | Traitement |
|-------|------------|
| Fallback authz BO (`PRE-E1-AUTHZ-FALLBACK-BO`) | Contrat V2.x ultérieur |
| Consolidation identités enseignants | Dette différée post-V2.1 |
| Matrice RBAC complète | V3 |
| Bulletins / E1 | Interdit |
| Import massif production | Hors rejeu local sauf mandat CTO |

---

## 10. Décision attendue à la fin de V2.2 (caractérisation)

À l’issue de L1/L1b, le rapport doit permettre au CTO de trancher **uniquement** :

1. La dette `PRE-E1-STUDENT-CODE-SCOPE` est-elle **confirmée / requalifiée / infirmée / indéterminée** ?  
2. Un **cadrage correctif** peut-il être autorisé (lot séparé) — oui/non ?  
3. Quel est le **prochain sujet V2** éventuel ?

**Pas** de merge de correctif dans la foulée de la caractérisation.

---

## 11. Acceptation du contrat

| Rôle | Attendu |
|------|---------|
| Cursor | Produire ce contrat (PR Draft docs-only) |
| CTO | Valider le contrat **avant** exécution de la caractérisation V2.2 |
| Caractérisation | **Interdite** tant que ce contrat n’est pas accepté CTO |

---

**Fin du contrat V2.2 — audit uniquement · aucune migration · E1 NO-GO.**
