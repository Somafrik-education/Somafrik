# ADR — LOT 8 : suppression de PUT /api/backoffice/state

## Statut

Accepté — Draft PR LOT 8

## Contexte

Après les LOTS 1–7, tous les domaines métier majeurs disposent d’APIs PostgreSQL dédiées. Le snapshot JSON global `backoffice_state` n’est plus une source de vérité acceptable.

## Décision

- `PUT /api/backoffice/state` renvoie **410 Gone** avec `BACKOFFICE_STATE_WRITE_REMOVED` pour tous les rôles et tous les payloads.
- `GET /api/backoffice/state` reste temporairement en **projection read-only** composée depuis les repositories canoniques (déprécié).
- Aucun backfill JSON, aucune recréation implicite de ligne `backoffice_state` au bootstrap.
- Domaines résiduels (`academicConfigs`, `exams`, `bulletins`, `documents`) : tables `school_academic_configs` et `establishment_residual_records` + APIs dédiées.
- Auth (`last_login_at`, mots de passe) : table `users` uniquement.

## APIs de remplacement

| Ancien usage PUT state | Remplacement |
|------------------------|--------------|
| `academicConfigs` | `PUT /api/academic-config` |
| `exams` (planning) | `PUT /api/backoffice/planning-exams` |
| `bulletins` | `PUT /api/backoffice/report-cards` |
| `documents` | `PUT /api/backoffice/establishment-documents` |
| clients, plateforme, finance, pédagogie, etc. | APIs LOT 1–7 existantes |

## Rollback

Redéploiement de la version précédente. Pas de réactivation silencieuse du PUT.
