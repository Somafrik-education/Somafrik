# Décisions d’architecture (ADR simplifié) — Somafrik

**Statut :** registre officiel des décisions durables  
**Dernière mise à jour :** 2026-07-26

Format obligatoire pour chaque entrée :

| Champ | Description |
|-------|-------------|
| **Date** | Date de décision (UTC) |
| **Décision** | Énoncé court et normatif |
| **Contexte** | Pourquoi la décision était nécessaire |
| **Alternatives** | Options écartées |
| **Impact** | Conséquences techniques / process |
| **Statut** | Proposée · Acceptée · Remplacée · Dépréciée |

Les conversations (Chat, agents) **ne remplacent pas** ce registre.

---

## ADR-001 — Stratégie develop → PR → préprod → production

| | |
|--|--|
| **Date** | 2026-07-20 |
| **Décision** | Tout changement passe par une branche → Draft PR → CI/Security → review CTO → merge `develop` → préproduction → (Go release) → `main` / production. |
| **Contexte** | Besoin d’un flux unique pour humains et agents Cloud, avec gate préprod avant prod. |
| **Alternatives** | Commit direct sur `develop` ; CD automatique `develop` → prod ; GitFlow lourd avec `release/*` systématique. |
| **Impact** | Branch protection ; Vercel `develop` = préprod ; Render API préprod ; pas de prod sans validation CTO. |
| **Statut** | Acceptée |

---

## ADR-002 — RBAC S1.4 fail-closed sur `PUT /backoffice/state`

| | |
|--|--|
| **Date** | 2026-07-20 |
| **Décision** | Les clés modifiables via `PUT /api/backoffice/state` sont bornées par rôle (`backOfficeWritableEntities`). Principal absent ⇒ aucun droit. `auditLog` n’est jamais writable client. |
| **Contexte** | Risque d’écriture hors périmètre (Secrétaire/Comptable) et de falsification du journal. |
| **Alternatives** | Confiance au client ; ACL uniquement UI ; API métier dédiée exclusive (trop tôt pour tout migrer). |
| **Impact** | 403 sur clés interdites ; tests `verify:rbac-s1-4` ; matrices Admin School / Secrétaire / Comptable / Préfet / Directeur / Admin Pays / Super Admin. |
| **Statut** | Acceptée |

---

## ADR-003 — Suppression de l’audit client (`auditLog` dans le PUT)

| | |
|--|--|
| **Date** | 2026-07-23 |
| **Décision** | Le navigateur ne doit plus envoyer `auditLog` dans `PUT /backoffice/state`. Toute présence → refus explicite 403. |
| **Contexte** | L’UI (Notes, puis Classes/Enseignants) construisait un journal local falsifiable ; le backend S1.4 le rejetait → 403 `Permission insuffisante…` et données optimistes non persistées. |
| **Alternatives** | Ignorer silencieusement `auditLog` ; autoriser Super Admin à écrire le journal ; conserver l’audit client « informatif ». |
| **Impact** | Strip DataContext ; workflows Notes/classes/enseignants/affectations nettoyés ; clients malveillants toujours 403. |
| **Statut** | Acceptée |

---

## ADR-004 — Adoption de l’audit serveur

| | |
|--|--|
| **Date** | 2026-07-23 |
| **Décision** | L’audit métier est produit exclusivement côté serveur (`AuditService.record`), dérivé du principal authentifié et rattaché au `schoolCode` de session. |
| **Contexte** | Besoin d’un journal non falsifiable pour users, payments, classes, teachers, assignments, etc. |
| **Alternatives** | Journal JSON client mergé ; double écriture client+serveur ; absence d’audit temporaire. |
| **Impact** | Collections critiques enrichies dans `auditCriticalStateChanges` ; UI Security lit les logs serveur filtrés ; conformité SEC-ME / WEB-ME. |
| **Statut** | Acceptée |

---

## ADR-005 — HOTFIX-RBAC-ADMIN-01 (classes / enseignants)

| | |
|--|--|
| **Date** | 2026-07-26 |
| **Décision** | Prioriser le hotfix RBAC-ADMIN-01 avant reprise roadmap : Admin établissement peut muter `classes` / `teachers` **sans** `auditLog` ; enseignant reste 403 sur ces clés ; Super Admin autorisé hors `auditLog`. |
| **Contexte** | Préprod : création « 2ème A » visible localement mais PUT 403 à cause de `{ classes, auditLog }`. |
| **Alternatives** | Contournement manuel DB ; élargir temporairement `auditLog` writable ; ignorer le 403 et continuer D3.7. |
| **Impact** | PR #81 ; `stripClientAuditLog` ; `verify:rbac-admin-01` ; gate préprod classes/enseignants obligatoire ; pas de suppression manuelle des fantômes locaux (localStorage). |
| **Statut** | Acceptée |

---

## ADR-006 — Sync Notes non destructive + RBAC enseignant isolé

| | |
|--|--|
| **Date** | 2026-07-23 |
| **Décision** | HOTFIX-SYNC-01/02/03 : outbox durable + ACK ; rattachement évaluations ; enseignant limité à `evaluations`/`notes` avec contrôle d’affectation et `teacherId` session. SYNC-04 reste isolé. |
| **Contexte** | Rollback P0 AUTH ; risque de perte de notes locales ; 403 enseignant sur state. |
| **Alternatives** | Merger #71/#72 tels quels ; API `POST /evaluations` immédiate ; élargir tout `/backoffice/state` aux enseignants. |
| **Impact** | KNOWN-ISSUE-NOTES-01 clôturée côté RBAC ; bootstrap CI obligatoire ; bissection contrôlée pour SYNC-04. |
| **Statut** | Acceptée |

---

## ADR-007 — Documentation comme source de vérité

| | |
|--|--|
| **Date** | 2026-07-26 |
| **Décision** | `docs/project/` est la gouvernance officielle. Toute évolution fonctionnelle met à jour ROADMAP / CHANGELOG (et DECISIONS / RELEASES / ARCHITECTURE / TESTING / SECURITY / OPERATIONS / DATABASE si concerné). Aucune PR fonctionnelle n’est terminée sans cette mise à jour lorsque nécessaire. |
| **Contexte** | Croissance du produit et des agents ; décisions perdues dans les fils de chat. |
| **Alternatives** | Wiki externe seul ; Notion exclusif ; README unique. |
| **Impact** | PR incomplète sans doc ; onboarding < 1 h via ARCHITECTURE + ROADMAP ; traçabilité phase ↔ release ↔ ADR ; runbooks ops/sécurité/tests versionnés. |
| **Statut** | Acceptée |

---

## Comment ajouter une décision

1. Incrémenter `ADR-00N`
2. Remplir les six champs
3. Lier la PR / le contrat DS
4. Mettre **Statut = Acceptée** seulement après validation CTO
5. Ne jamais réécrire une ADR acceptée : en créer une nouvelle « Remplace ADR-00X »
