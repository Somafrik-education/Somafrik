# LOT 6 — Soumission établissement, configuration Superadmin, activation

**Statut :** GO DEV / HOLD READY+MERGE. **LOT 7+ interdit.**  
**Ticket :** #639. **Prérequis :** LOT 5 mergé (`develop@074af9aa`).

Workflow backend/PostgreSQL uniquement. Aucune UI Web/Mobile, aucune route publique `/verify`, aucun mint QR, aucun PDF métier dans la transaction d’activation.

## Flux

`SUBMITTED` → `UNDER_REVIEW` → `CONFIGURING` → `READY_FOR_REVIEW` → (`CHANGES_REQUESTED` → `CONFIGURING`) ou `APPROVED` → `ACTIVE`.

`REJECTED` et `ARCHIVED` sont terminaux. Une nouvelle activation du même `(school_id, model_key)` archive l’ACTIVE précédente. Exactement une ligne ACTIVE par couple.

## Couches

Bundle exact : `AcademicRuleProfile` (LOT 1/1.1, calculable) + `ReportCardSchema` (LOT 2, `validateAgainstProfile`) + `RenderingTemplate` versionné (validateur LOT 5 partagé) + `engine_id = somafrik.report_card.v1`.

La spec template ne contient pas `school_id` / `country`. Canonicalisation JCS RFC 8785 + `spec_sha256`. Versions non-DRAFT immuables.

## RBAC

- Établissement `REPORT_CARD_SUBMIT_MODEL` : soumettre son `school_id`.
- Établissement `REPORT_CARD_SCHOOL_APPROVE_TEMPLATE` : approuver / changes sur sa demande `READY_FOR_REVIEW`.
- Superadmin `REPORT_CARD_CONFIGURE` + contexte plateforme explicite : revue / config / rejet / activation.
- Aucun fallback silencieux `actorSchoolId`. Audit append-only par transition.

## Dette

Pas de nouvel upload blob : la soumission porte une description/métadonnées. Réutiliser une infra fichiers existante si un artefact binaire devient nécessaire plus tard.

Pas de routes HTTP dans ce lot : le service `createReportCardConfiguration` est le contrat. LOT 7 pourra exposer l’UI.

**LOT 7+ interdit.**
