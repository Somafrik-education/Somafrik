# Audit Pré-E1 — État consolidé après clôture des HOTFIX

**Type :** dossier de cadrage (gouvernance) — **aucune implémentation**  
**Date :** 2026-07-27  
**Base code de référence :** `develop` @ `8c570584` (merge PR #92 — clôture formelle HOTFIX-02)  
**Arbitrage CTO :** **Option A** — Audit V2 **autorisé** (phase d’audit, non de développement) — 2026-07-27

---

## 0. Objet et limites

Ce document répond uniquement aux questions autorisées par la décision CTO d’ouverture contrôlée :

1. Quel est l’état consolidé de l’Audit Pré-E1 après la clôture des HOTFIX ?  
2. Quels blockers restent réellement ouverts, classés par criticité ?  
3. Lequel empêche effectivement l’ouverture de V2 ?  
4. `PRE-E1-IDENTITY-LIFECYCLE` relève-t-il de V2, ou existe-t-il un blocker plus prioritaire ?  
5. Quelle recommandation argumentée pour le prochain lot ?

### Interdictions respectées

| Interdiction | Statut |
|--------------|--------|
| Implémentation / correctif / refactor | Non réalisé |
| PR de correction métier | Non réalisée |
| Modification des preuves historiques (PR #84, artefacts V1 d’origine) | Non réalisée |
| Réouverture HOTFIX-02 / HOTFIX-02B | Non réalisée |
| Développement métier | Non réalisé |

---

## 1. État consolidé post-HOTFIX

### 1.1 Lots HOTFIX

| Lot | Statut | Preuve de clôture |
|-----|--------|-------------------|
| HOTFIX-PRE-E1-01 (élèves → PG) | **CLOS** (livré / mergé) | [`BILAN-PRE-E1-V1-RERUN-HOTFIX-01.md`](./BILAN-PRE-E1-V1-RERUN-HOTFIX-01.md) · preuve `evidence/pre-e1-v1-rerun-hotfix-pre-e1-01-results.json` |
| HOTFIX-PRE-E1-02 | **CLOS** | [`DECISION-CTO-CLOTURE-HOTFIX-02.md`](./DECISION-CTO-CLOTURE-HOTFIX-02.md) · PR #87 `f8999ebe` |
| HOTFIX-PRE-E1-02B | **CLOS** | Même décision CTO · PR #90 `fc953883` · rejeu PR #91 `45f55a9e` |
| Gel `WAIT_FOR_INDEPENDENT_REPLAY` | **LEVÉ** | Décision CTO 2026-07-27 |

**Règle maintenue :** aucun nouveau correctif HOTFIX-02 n’est autorisé tant qu’aucune **nouvelle** anomalie n’apparaît.

### 1.2 Gate technique V1 (chaîne intégrée)

| Métrique | V1 historique (PR #84) | Post HOTFIX-01 | Post HOTFIX-02 |
|----------|------------------------|----------------|----------------|
| Passés | 27/33 | 28/33 | **33/33** |
| Échoués | 6 | 5 | **0** |
| Anomalies BLOCKER/CRITICAL | 6 | 5 | **0** |
| Harness `recommendation.decision` | BLOQUER V2 | BLOQUER V2 | **`V2 AUTORISABLE`** |

**Preuve machine post-HOTFIX-02 (intacte, non modifiée ici) :**  
[`evidence/pre-e1-v1-rerun-hotfix-pre-e1-02-results.json`](./evidence/pre-e1-v1-rerun-hotfix-pre-e1-02-results.json)

```text
summary: { total: 33, passed: 33, failed: 0, anomalies: 0 }
recommendation: {
  launchV2: true,
  decision: "V2 AUTORISABLE",
  rationale: "Chaîne V1 verte sans BLOCKER/CRITICAL. V2 peut démarrer sur instruction CTO."
}
```

**Preuve machine post-merge HOTFIX-02B :**  
[`evidence/pre-e1-hotfix-02b-rejeu-post-merge-results.json`](./evidence/pre-e1-hotfix-02b-rejeu-post-merge-results.json) → **13/13**.

### 1.3 Anomalies V1 ciblées — statut après HOTFIX

| ID | Sévérité initiale | Cible | Statut consolidé | Preuve |
|----|-------------------|-------|------------------|--------|
| V1-PG-01c | BLOCKER | Élèves absents de `students` PG | **CLOS** | Re-run HOTFIX-01 + re-run HOTFIX-02 33/33 |
| V1-POST-01 | BLOCKER | `POST /api/notes` 404 élève | **CLOS** | Re-run HOTFIX-02 : POST **201** |
| V1-PG-01b | CRITICAL | `evaluations.teacher_id` null | **CLOS** | Re-run HOTFIX-02 |
| V1-PG-02 | CRITICAL | 0 grades PG | **CLOS** | Re-run HOTFIX-02 : **2** grades |
| V1-SOT-01 | CRITICAL | Divergence JSON/PG notes | **CLOS** | `json=2 pg=2` |
| V1-DUP-01 | CRITICAL | Idempotence non prouvable | **CLOS** | Comptages + IDs stables ([bilan HOTFIX-02](./BILAN-PRE-E1-V1-RERUN-HOTFIX-02.md) §4) |
| Matérialisation PG teachers/assignments + isolation | (cause 02B) | HOTFIX-02B | **CLOS** | Gate 02B 13/13 + décision CTO |

### 1.4 Gouvernance Audit / produit

| Élément | Statut au 2026-07-27 (après Option A) |
|---------|----------------------------------------|
| Audit Pré-E1 | **OUVERT** |
| HOTFIX-01 / 02 / 02B | **CLOS** — ne pas rouvrir |
| V2 (phase audit « modèle de données & intégrité ») | **AUTORISÉE** (Option A CTO) — phase d’**audit**, pas de développement |
| E1 Bulletins | **NO-GO** |
| PR #84 (audit foundations / preuves V1 historiques) | **Draft** — artefacts historiques **intacts** |
| Document foundations (branche audit) | Contient encore la recommandation historique **BLOQUER V2** (27/33) — **périmé** au regard des rejeux post-HOTFIX ; ne pas réécrire les preuves |

---

## 2. Inventaire des sujets encore ouverts

Classification utilisée :

- **BLOCKER** — empêche formellement la suite (gate ou anomalie prouvée bloquante)  
- **CRITICAL** — risque corruption / sécurité / source de vérité, prouvé ou à prouver en priorité dans la phase suivante  
- **MAJOR** — dette structurante documentée, non bloquante seule pour ouvrir la phase suivante  
- **MINOR** — écart local sans impact bulletin immédiat  
- **INFORMATION** — contexte / hypothèse Phase 0 non rejouée comme anomalie V1

### 2.1 Inventaire prioritaire (ouverts)

| ID | Criticité | Nature | Statut | Empêche l’ouverture de V2 ? | Preuves associées |
|----|-----------|--------|--------|-----------------------------|-------------------|
| **GATE-CTO-AUTHORIZE-V2** | **Gouvernance** | Autorisation CTO pour démarrer la phase V2 | **TRANCHÉE — Option A** | N/A (décision prise) — voir §3 | Arbitrage CTO 2026-07-27 (ce dossier) · [`DECISION-CTO-OUVERTURE-AUDIT-V2.md`](./DECISION-CTO-OUVERTURE-AUDIT-V2.md) |
| **PRE-E1-IDENTITY-LIFECYCLE** | **MAJOR** | Cycles multiples BackOffice ↔ user/session ↔ PG (`TEACHER-*` / `TEACHERS-*` / `ENS-*`) ; pas de convergence d’identité | **OUVERT** → périmètre V2 | **NON** (à elle seule ne justifie pas un nouveau hotfix) | Rapports HF02/02B · [`INSPECTION-PRE-E1-HOTFIX-02-INDEPENDANTE.md`](./INSPECTION-PRE-E1-HOTFIX-02-INDEPENDANTE.md) §4 · décision CTO |
| **PRE-E1-STUDENT-CODE-SCOPE** | **MAJOR** | `students.student_code` UNIQUE global ; arbitrage `(school_id, student_code)` reporté | **OUVERT** → périmètre V2 | **NON** | [`RAPPORT-HOTFIX-PRE-E1-01.md`](../ux/design-system/RAPPORT-HOTFIX-PRE-E1-01.md) · bilan re-run HF01 |
| **PRE-E1-AUTHZ-FALLBACK-BO** | **MAJOR** *(observabilité / dette)* | Fallback authz snapshot BO encore **observé** (`fallbackUsed=true`) même après chemin PG prouvé | **OUVERT** → caractériser en V2/V4 | **NON** | Gate `FALLBACK-DOC` · [`RAPPORT-HOTFIX-PRE-E1-02B.md`](../ux/design-system/RAPPORT-HOTFIX-PRE-E1-02B.md) · preuve rejeu 02B |
| **PR-84-HISTORICAL-STALE-REC** | **INFORMATION** | Recommandation « BLOQUER V2 » figée sur preuves 27/33 | **OUVERT** (doc historique) | **NON** (ne pas réécrire) | Branche `cursor/audit-pre-e1-foundations-8ed4` · `AUDIT-PRE-E1-FOUNDATIONS.md` |

### 2.2 Hypothèses Phase 0 (R-01…R-14) — pas des blockers V1 ouverts

Le document foundations liste des risques provisoires (ex. bus `PUT /api/backoffice/state`, dualité JSON↔PG, suppressions, isolation A↔B, `evaluation_id` nullable, etc.).

| Lecture | Conséquence |
|---------|-------------|
| Ce sont des **hypothèses de cartographie** (Phase 0), classées CRITICAL/MAJOR de façon **provisoire** | Elles constituent l’**agenda** des phases V2–V6 |
| Elles n’ont **pas** été reconfirmées comme anomalies V1 ouvertes après les HOTFIX | Elles **ne remplacent pas** un inventaire d’anomalies prouvées |
| Plusieurs chevauchent le périmètre V2 (« source de vérité », intégrité, orphelins) | À **prouver ou infirmer** pendant V2, pas via un nouveau HOTFIX-02 |

**Conclusion :** aucun R-0x ne constitue, dans le périmètre de ce dossier, un blocker technique **prouvé** plus prioritaire que la dette IDENTITY pour empêcher l’ouverture de V2.

### 2.3 Sujets explicitement clos (ne pas rouvrir)

| Sujet | Statut |
|-------|--------|
| HOTFIX-02 / HOTFIX-02B | **CLOS / archivés** |
| Anomalies V1 BLOCKER/CRITICAL listées §1.3 | **CLOS** |
| `WAIT_FOR_INDEPENDENT_REPLAY` | **LEVÉ** |

---

## 3. Ouverture de V2 — lecture de ce dossier

### 3.1 Condition technique historique (foundations)

La condition écrite pour réautoriser V2 était :

> correction (ou arbitration) des BLOCKER V1-PG-01c / V1-POST-01 **et** re-run vert de `verify:pre-e1-v1`.

**État actuel :** condition **satisfaite** (33/33, 0 anomalie BLOCKER/CRITICAL ; harness `V2 AUTORISABLE`).

### 3.2 Formulation retenue (réserve CTO)

> **Aucun blocker technique V1 n’a été identifié dans ce dossier comme empêchant l’ouverture de V2.**  
> **L’ouverture de V2 relève désormais d’une décision de gouvernance CTO.**

Cette formulation reflète le périmètre d’un **état des lieux** : elle ne affirme pas de manière absolue qu’aucun autre sujet hors inventaire ne pourrait exister ; elle constate l’absence, dans ce dossier, de blocker technique V1 empêchant V2.

| Question | Réponse (périmètre dossier) |
|----------|----------------------------|
| Anomalie V1 **BLOCKER/CRITICAL** ouverte identifiée ici ? | **Non** (preuves rejeu) |
| Correctif métier requis **avant** d’ouvrir V2 d’après ce dossier ? | **Non** |
| Qui tranche l’ouverture de V2 ? | **CTO** (gouvernance) |

---

## 4. `PRE-E1-IDENTITY-LIFECYCLE` : V2 ou prioritaire avant V2 ?

| Critère | Évaluation |
|---------|------------|
| Sévérité documentée | **MAJOR** (jamais requalifiée BLOCKER par CTO) |
| Empêche clôture HOTFIX-02 ? | **Non** (décision CTO explicite) |
| Empêche rejeu V1 vert ? | **Non** (33/33 avec dualité `TEACHER-*` / `TEACHERS-*` encore présente) |
| Alignement avec le plan V2 foundations | **Oui** — V2 = « Modèle de données & intégrité » |
| Justifie un nouveau hotfix à elle seule ? | **Non** (arbitrage CTO) |
| Blocker technique plus prioritaire *avant* V2 identifié dans ce dossier ? | **Non** |

**Verdict (validé CTO) :** `PRE-E1-IDENTITY-LIFECYCLE` **relève de V2**.  
Ce n’est **pas** un prérequis HOTFIX supplémentaire avant d’ouvrir V2.

Même lecture pour `PRE-E1-STUDENT-CODE-SCOPE` et pour la caractérisation du fallback BO (`PRE-E1-AUTHZ-FALLBACK-BO`) en V2/V4.

---

## 5. Ordre de priorité (après Option A)

| Rang | ID | Criticité | Action attendue |
|------|----|-----------|-----------------|
| **P0** | Ouverture Audit V2 | Gouvernance | **Décidée — Option A** |
| **P1** *(dans V2)* | `PRE-E1-IDENTITY-LIFECYCLE` | MAJOR | Caractériser / prouver ; identifiants & points d’écriture canoniques |
| **P1** *(dans V2)* | Intégrité SoT JSON↔PG / orphelins (agenda R-02, R-03, R-07…) | CRITICAL *provisoire Phase 0* | Prouver ou infirmer sous protocole V2 |
| **P2** *(dans V2)* | `PRE-E1-STUDENT-CODE-SCOPE` | MAJOR | Arbitrer unicité `student_code` |
| **P2** *(V2/V4)* | `PRE-E1-AUTHZ-FALLBACK-BO` | MAJOR | Caractériser dépendance résiduelle au fallback BO vs chemin PG |
| **P3** | Phases V3–V7 du plan foundations | — | Après V2, selon résultats |
| **Hors file** | HOTFIX-02 / 02B | — | **Ne pas rouvrir** |
| **Hors file** | Développement Bulletins / métier E1 | — | **Interdit** — V2 = audit uniquement |

---

## 6. Recommandation et arbitrage CTO

### 6.1 Recommandation du dossier (avant arbitrage)

**Prochain lot : ouverture officielle de l’Audit Pré-E1 — phase V2**  
(« Modèle de données & intégrité »), **sans** correctif HOTFIX préalable et **sans** développement métier.

### 6.2 Arbitrage CTO — Option A (retenue)

| Champ | Décision |
|-------|----------|
| **Option** | **A — Autoriser V2** |
| **Nature** | Phase d’**audit**, non de développement |
| **Périmètre** | Modèle de données · Intégrité · Source of Truth · `PRE-E1-IDENTITY-LIFECYCLE` · `student_code` · autres risques documentés à caractériser |
| **Contraintes** | Aucune implémentation métier ; uniquement caractérisation, preuves et contrats ; **chaque anomalie devra être démontrée avant toute proposition de correction** |
| **HOTFIX-01/02/02B** | Restent **clos** — ne pas rouvrir |
| Décision formelle | [`DECISION-CTO-OUVERTURE-AUDIT-V2.md`](./DECISION-CTO-OUVERTURE-AUDIT-V2.md) |

### 6.3 Ce que V2 n’est pas

| N’est pas | Pourquoi |
|-----------|----------|
| Un HOTFIX-02C | HOTFIX-02 est clos ; pas de nouvelle anomalie V1 ouverte dans ce dossier |
| Une implémentation Bulletins / E1 | E1 reste NO-GO jusqu’à V7 |
| Une réécriture de PR #84 / preuves historiques | Les preuves restent archives ; V2 produit ses propres preuves |

---

## 7. Références (preuves — lecture seule)

| Document / artefact | Rôle |
|---------------------|------|
| [`DECISION-CTO-OUVERTURE-AUDIT-V2.md`](./DECISION-CTO-OUVERTURE-AUDIT-V2.md) | Arbitrage Option A — ouverture V2 |
| [`DECISION-CTO-CLOTURE-HOTFIX-02.md`](./DECISION-CTO-CLOTURE-HOTFIX-02.md) | Clôture formelle HF02 / 02B |
| [`BILAN-PRE-E1-V1-RERUN-HOTFIX-02.md`](./BILAN-PRE-E1-V1-RERUN-HOTFIX-02.md) | Rejeu V1 33/33 |
| [`BILAN-PRE-E1-HOTFIX-02B-REJEU-POST-MERGE.md`](./BILAN-PRE-E1-HOTFIX-02B-REJEU-POST-MERGE.md) | Rejeu 02B 13/13 |
| [`INSPECTION-PRE-E1-HOTFIX-02-INDEPENDANTE.md`](./INSPECTION-PRE-E1-HOTFIX-02-INDEPENDANTE.md) | Causalité historique + confirmation IDENTITY |
| [`RAPPORT-HOTFIX-PRE-E1-01.md`](../ux/design-system/RAPPORT-HOTFIX-PRE-E1-01.md) | Dette STUDENT-CODE-SCOPE |
| [`RAPPORT-HOTFIX-PRE-E1-02.md`](../ux/design-system/RAPPORT-HOTFIX-PRE-E1-02.md) | Dette IDENTITY + clôture |
| [`RAPPORT-HOTFIX-PRE-E1-02B.md`](../ux/design-system/RAPPORT-HOTFIX-PRE-E1-02B.md) | PG assignments + fallback observé |
| `evidence/pre-e1-v1-rerun-hotfix-pre-e1-02-results.json` | Machine : V2 AUTORISABLE |
| `evidence/pre-e1-hotfix-02b-rejeu-post-merge-results.json` | Machine : 13/13 |
| `AUDIT-PRE-E1-FOUNDATIONS.md` (branche audit PR #84) | Plan V0–V7 + risques Phase 0 (historique) |

---

## 8. Synthèse exécutive (une page)

| Question | Réponse courte |
|----------|----------------|
| État Audit Pré-E1 | **OUVERT** ; HOTFIX-01/02/02B **CLOS** ; V1 technique **verte** |
| Blockers techniques V1 identifiés dans ce dossier comme empêchant V2 | **Aucun** |
| Ouverture de V2 | **Décision de gouvernance CTO** → **Option A retenue** |
| IDENTITY | **MAJOR → V2** ; ne justifie pas un nouveau hotfix à elle seule |
| Prochain lot | **Audit V2** (caractérisation / preuves / contrats — pas de métier) |

**Fin du dossier de cadrage.**
