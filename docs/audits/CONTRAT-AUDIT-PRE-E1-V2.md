# Contrat d’audit Pré-E1 — Phase V2

**Type :** contrat d’audit (caractérisation) — **aucune implémentation**  
**Statut phase :** Audit V2 **OUVERTE** ([`DECISION-CTO-OUVERTURE-AUDIT-V2.md`](./DECISION-CTO-OUVERTURE-AUDIT-V2.md))  
**Base :** `develop` @ `094d5017` (merge PR #93)  
**Date :** 2026-07-27  

---

## 0. Nature du lot

| Champ | Valeur |
|-------|--------|
| Phase | **V2 — Modèle de données & intégrité** |
| Nature | **Audit uniquement** |
| E1 | **NO-GO** |
| Implémentation métier | **INTERDITE** |
| HOTFIX-01 / 02 / 02B | **CLOS** — ne pas rouvrir |
| Correctif | **Interdit** tant qu’aucune anomalie n’est **démontrée** puis validée CTO |

### Méthode obligatoire (chaque sujet V2)

1. Sélectionner un risque / sujet du périmètre V2  
2. Définir le **contrat d’audit** et les **critères de preuve** *(ce document pour le 1er sujet)*  
3. **Caractériser** le comportement réel (preuves machine / observations)  
4. Classer : **confirmé** · **infirmé** · **indéterminé**  
5. **Seulement après** preuve d’anomalie : soumettre un **plan correctif minimal** à validation CTO  

**Aucun correctif ne commence directement** — y compris pour `PRE-E1-IDENTITY-LIFECYCLE` ou `student_code`.

---

## 1. Périmètre V2 (rappel)

| Domaine | Exemples de sujets |
|---------|-------------------|
| Modèle de données | Identifiants, clés, contraintes UNIQUE/FK |
| Intégrité | Orphelins, suppressions, références cassées |
| Source of Truth | Dualité JSON BackOffice ↔ PostgreSQL |
| Dettes nommées | `PRE-E1-IDENTITY-LIFECYCLE`, `PRE-E1-STUDENT-CODE-SCOPE` |
| Autres risques documentés | Hypothèses Phase 0 (R-01…R-14), fallback authz BO, etc. |

Livrables autorisés dans V2 : **contrats**, **preuves**, **rapports de caractérisation**, **plans correctifs proposés** (non exécutés sans aval CTO).

---

## 2. Premier sujet sélectionné — V2.1

| Champ | Valeur |
|-------|--------|
| **ID lot** | **V2.1** |
| **Sujet** | **`PRE-E1-IDENTITY-LIFECYCLE`** |
| **Criticité documentée** | **MAJOR** |
| **Statut** | Contrat défini — caractérisation **à exécuter** (pas commencée dans cette PR) |

### 2.1 Motif de sélection (pourquoi en premier)

1. Explicitement inscrit dans le périmètre V2 par décision CTO.  
2. Classé **P1** dans l’état des lieux post-HOTFIX.  
3. Déjà **observé** (inspection HF02 / rapports 02–02B) sans avoir été **borné** comme anomalie V2 avec critères de preuve.  
4. Conditionne la lecture SoT enseignants / affectations / users — socle pour les sujets V2 suivants.  
5. Ne justifie **pas** un hotfix immédiat : le contrat cadre la caractérisation avant toute proposition de correction.

### 2.2 Sujets explicitement hors V2.1 (reportés)

| Sujet | Rang indicatif | Traitement |
|-------|----------------|------------|
| `PRE-E1-STUDENT-CODE-SCOPE` | P2 | Contrat V2.x dédié ultérieur |
| `PRE-E1-AUTHZ-FALLBACK-BO` | P2 (V2/V4) | Contrat dédié après V2.1 |
| Orphelins notes / `evaluation_id` null (R-07…) | P1 agenda | Contrat dédié — ne pas mélanger ici |
| Suppressions destructrices (R-04/R-05) | Agenda V2/V6 | Contrat dédié |
| Matrice RBAC complète | V3 | Hors V2.1 |
| Bulletins / E1 | — | **Interdit** |

---

## 3. Objet de la caractérisation V2.1

Cartographier les **cycles de vie d’identité** réellement utilisés pour la chaîne pédagogique enseignants (et, en lecture seule comparative, élèves / users associés), sans modifier le code métier.

### 3.1 Couches à tracer

| Couche | Identifiants / artefacts à observer |
|--------|-------------------------------------|
| BackOffice JSON | Fiches `teachers[]` : ids `TEACHERS-*`, `TEACHER-*`, champs `userId`, `identifier`, `publicId`, `login` |
| Session / JWT | Claims utilisés pour l’authz notes (`userCode`, `ENS-*`, classNames, etc.) |
| PostgreSQL `users` | `user_code`, `role`, `school_id`, statut |
| PostgreSQL `teachers` | `teacher_code`, `user_id`, `school_id` |
| PostgreSQL `teacher_assignments` | `teacher_id` → quel `teachers.id` / code |
| Évaluations / notes (lecture) | `evaluations.teacher_id`, références JSON `teacherId` |

### 3.2 Questions d’audit (à trancher par preuve)

| # | Question |
|---|----------|
| Q1 | Combien d’identités distinctes coexistent pour **un** enseignant opérationnel (création → affectation → POST notes) ? |
| Q2 | Quels sont les **points d’écriture** qui créent ou mutent chaque identité (state BO, sync PG, login, seed) ? |
| Q3 | Existe-t-il une **identité canonique** de fait (même si non documentée) après HOTFIX-02B ? |
| Q4 | Les jumeaux `TEACHER-*` / `TEACHERS-*` restent-ils **deux fiches** après sync nominale post-02B ? |
| Q5 | Le `teacher_code` PG (`TEACHERS-*` vs `ENS-*` / `CD-…-ENS-…`) est-il stable et aligné sur l’id pédagogique BO ? |
| Q6 | `teachers.user_id` pointe-t-il toujours vers le user de session utilisé pour `POST /api/notes` ? |
| Q7 | Les références JSON (`assignment.teacherId`, `evaluation.teacherId`) convergent-elles vers la même identité que PG ? |

---

## 4. Critères de preuve

### 4.1 Preuves acceptées

| Type | Exigence |
|------|----------|
| Preuve machine | Artefact JSON/JSONL sous `docs/audits/evidence/` **dédié V2.1** (nouveau fichier — **ne pas** modifier les preuves HF01/02/02B ni PR #84) |
| Observation reproductible | Scénario nommé + commandes + extrait d’IDs / compteurs |
| Lecture code (appui) | Chemins cités — **insuffisante seule** pour classer « confirmé » |
| Preuve historique | Réutilisable en **contexte** uniquement ; une conclusion V2.1 doit s’appuyer sur un rejeu **post-`094d5017`** |

### 4.2 Harness / commandes autorisés (caractérisation)

Réutilisation en **lecture / exécution** des gates existants **sans** les modifier pour « faire passer » un correctif :

```text
npm run verify:pre-e1-v1
npm run verify:pre-e1-hotfix-02b
```

Extensions **autorisées uniquement** si nécessaire à la preuve V2.1 :

- script de caractérisation **read-only** (ou écritures de fixture isolées déjà pratiquées par les harness existants) ;
- nommage suggéré : `scripts/verify-pre-e1-v2-identity-lifecycle.js` + `npm run verify:pre-e1-v2-identity` ;
- sortie : `docs/audits/evidence/pre-e1-v2-identity-lifecycle-results.json`.

**Interdit dans V2.1 :** changer la sémantique métier, supprimer le fallback BO, fusionner les fiches enseignants, migrer `student_code`, assouplir RBAC.

### 4.3 Jeu de scénarios minimum

| Id | Scénario | Observations attendues (preuve) |
|----|----------|----------------------------------|
| **ID-01** | Création / sync enseignant BO nominal (post-02B) | Snapshot : ids JSON `teachers[]` · `teacher_code` PG · `users.user_code` · `teachers.user_id` |
| **ID-02** | Affectation classe+matière puis lecture `teacher_assignments` | `assignment.teacherId` JSON vs `teachers.id` / `teacher_code` PG |
| **ID-03** | Auth enseignant + `POST /api/notes` nominal | Identité JWT / lookup · `grantedBy` · `evaluations.teacher_id` |
| **ID-04** | Présence éventuelle d’un jumeau `TEACHER-*` à côté de `TEACHERS-*` | Comptage fiches · dedupe · non-fusion |
| **ID-05** | Replay sync identique (idempotence identité) | Pas de 3ᵉ fiche / pas de nouveau `teachers` row injustifié |
| **ID-06** | Comparaison élève (**borne / contexte**) | `students.student_code` vs id JSON — constat contextuel uniquement |

#### Réserve CTO — ID-06 (2026-07-27)

ID-06 peut rester dans le contrat **uniquement** comme comparaison bornée. Il ne devra :

- **ni** caractériser complètement `PRE-E1-STUDENT-CODE-SCOPE` ;
- **ni** produire une décision sur l’unicité de `student_code` ;
- **ni** entraîner une modification du modèle étudiant.

Toute observation sur les élèves devra être classée comme **contexte** (`INFORMATION`) ou **transmise** à un futur contrat V2 dédié `PRE-E1-STUDENT-CODE-SCOPE`.  
ID-06 **n’entre pas** dans la synthèse de confirmation/infirmation de la dette IDENTITY enseignant.

**Décision CTO :** CONTRAT V2.1 **ACCEPTÉ** · caractérisation **AUTORISÉE** · implémentation **INTERDITE** · E1 **NO-GO**.

---

## 5. Classification du résultat

Chaque question Q1–Q7 et chaque scénario ID-01…ID-06 reçoit **une** classe :

| Classe | Définition opérationnelle |
|--------|---------------------------|
| **Confirmé** | Comportement / écart **reproductible** avec preuve machine dédiée V2.1 |
| **Infirmé** | Comportement redouté **non observé** sur le protocole exécuté (preuves à l’appui) |
| **Indéterminé** | Preuve insuffisante, environnement non conclusif, ou dépendance hors scénario — **à relancer** ou borner |

### 5.1 Règles de synthèse V2.1

| Synthèse dette IDENTITY | Condition |
|-------------------------|-----------|
| **Maintenue MAJOR (confirmée)** | Au moins un écart d’identité multi-couches **confirmé** (ex. deux fiches stables, ou PG≠JSON sur teacherId, ou user_id ≠ session) |
| **Requalisée** | Uniquement sur faits prouvés + validation CTO (pas par le seul rapport agent) |
| **Infirmée** | Tous les écarts redoutés du contrat sont **infirmés** sur ID-01…ID-06 |
| **Indéterminée** | Trop de Q/scénarios en indéterminé → pas de plan correctif |

### 5.2 Sévérité (si anomalie confirmée)

Toute anomalie nouvellement démontrée doit être classée **BLOCKER / CRITICAL / MAJOR / MINOR / INFORMATION** avec impact bulletin / isolation / SoT argumenté.  
La sévérité historique « MAJOR » n’est **pas** une preuve ; elle peut être confirmée ou ajustée **après** caractérisation.

---

## 6. Livrables V2.1

| Ordre | Livrable | Contenu |
|-------|----------|---------|
| **L0** | **Ce contrat** | Sélection + critères de preuve |
| **L1** | Rapport de caractérisation | `docs/audits/RAPPORT-AUDIT-PRE-E1-V2-IDENTITY-LIFECYCLE.md` (nom indicatif) |
| **L1b** | Preuve machine | `docs/audits/evidence/pre-e1-v2-identity-lifecycle-results.json` |
| **L2** *(conditionnel)* | Plan correctif **minimal** | Uniquement si ≥1 anomalie **confirmée** — soumis à **validation CTO** avant toute PR de code métier |

### 6.1 Contenu minimal du rapport L1

1. Matrice Q1–Q7 × Confirmé / Infirmé / Indéterminé  
2. Table ID-01…ID-06 avec extraits d’identifiants  
3. Schéma des cycles de création/modification observés  
4. Liste des points d’écriture canoniques **candidats** (proposition documentaire, **pas** implémentée)  
5. Décision : maintenir / requalifier / infirmer IDENTITY — **sans** démarrer de correctif  

---

## 7. Interdictions (rappel dur)

| Interdit | |
|----------|--|
| Implémentation métier / refactor IDENTITY | ❌ |
| Convergence forcée `TEACHER-*` ↔ `TEACHERS-*` | ❌ |
| Migration `student_code` | ❌ |
| Réouverture HOTFIX-02 / 02B | ❌ |
| Modification des preuves historiques | ❌ |
| Ouverture E1 / développement bulletins | ❌ |
| Plan correctif **sans** anomalie confirmée | ❌ |
| Exécution d’un correctif **sans** aval CTO explicite | ❌ |

---

## 8. Critères d’acceptation du contrat (revue CTO)

Le présent contrat est **accepté** si :

1. Le premier sujet V2.1 est clairement `PRE-E1-IDENTITY-LIFECYCLE`.  
2. Les critères de preuve et scénarios sont exécutables sans correctif.  
3. La chaîne Confirmé / Infirmé / Indéterminé est définie.  
4. Aucune implémentation n’est proposée dans la PR du contrat.

**Prochaine étape après acceptation :** exécuter la caractérisation V2.1 (L1 + L1b) sur une PR Draft **distincte**, toujours sans correctif.

---

## 9. Références

| Document | Rôle |
|----------|------|
| [`DECISION-CTO-OUVERTURE-AUDIT-V2.md`](./DECISION-CTO-OUVERTURE-AUDIT-V2.md) | Autorisation phase V2 |
| [`PRE-E1-AUDIT-STATUS-AFTER-HOTFIX.md`](./PRE-E1-AUDIT-STATUS-AFTER-HOTFIX.md) | État des lieux / priorités |
| [`INSPECTION-PRE-E1-HOTFIX-02-INDEPENDANTE.md`](./INSPECTION-PRE-E1-HOTFIX-02-INDEPENDANTE.md) | Observations identité historiques |
| [`RAPPORT-HOTFIX-PRE-E1-02B.md`](../ux/design-system/RAPPORT-HOTFIX-PRE-E1-02B.md) | Dedupe volontaire TEACHER/TEACHERS |
| Plan foundations V2 (PR #84, historique) | Checklist SoT / intégrité (contexte) |

---

**Fin du contrat V2 / V2.1 — aucun correctif dans ce livrable.**
