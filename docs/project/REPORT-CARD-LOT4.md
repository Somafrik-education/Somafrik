# LOT 4 — Snapshot immuable, publication atomique, QR stratégie A

**Statut :** GO DEV / HOLD READY+MERGE. **LOT 5 interdit.**  
**Ticket :** #634. **Prérequis :** LOT 3 mergé (`develop@6e3ba773`).

Consomme exclusivement les contrats LOT 0/0.1 : `canonicalize` (RFC 8785 JCS), `sealSnapshot` / `payloadForRender` (SHA-256 + Ed25519 sur **les mêmes bytes**), `verificationSecret` (stratégie A), `PUBLISH.unique = (report_card_id, published_snapshot_version)`.

Aucun second contrat parallèle. Aucun PDF, aucune route `/verify`, aucune UI Web/Mobile.

## Frontière atomique

Une transaction crée ensemble : `PUBLISHED` + `canonical_bytes` + `snapshot_sha256` + `snapshot_signature` + identité QR `ACTIVE` + outbox `pedagogy.report_card.published`.

Retry même `snapshot_sha256` → même `public_id` / même URL. Payload différent → `IDEMPOTENCY_CONFLICT`.

Publications concurrentes de **versions distinctes** du même bulletin : sérialisation PostgreSQL `pg_advisory_xact_lock(hashtext(school_id), hashtext(report_card_id))` dans la transaction d’insert. Exactement une ligne `ACTIVE` ; les autres `SUPERSEDED`. Index unique partiel `(school_id, report_card_id) WHERE verification_status = 'ACTIVE'` en filet fail-closed. L’idempotence même-version reste inchangée.

## Snapshot signé

Validation fail-closed **avant** `sealSnapshot` : `engine_id === somafrik.report_card.v1`, provenance `profile` + `schema` (id / version / spec_sha256), `students[]` canonique, version entière ≥ 1, cohorte signée `academic_year_id` + `class_id`. PostgreSQL persiste l’`engine_id` déjà présent dans les bytes signés — aucun fallback.

## Tenant

Lookups internes (`lookup`, `reprintUrl`, `payloadForRender`) : `schoolId` et `actorSchoolId` obligatoires, toujours `school_id`-scopés. Aucun fallback cross-school.

## QR A

`https://somafrik.app/verify/rc/<public_id>.<token>` — opaque, sans PII ni clé privée. Même version = même URL. Nouvelle version = nouveau `public_id`. `lookupPublic({ publicId, token })` résout sans tenant (capability URL). Clés Ed25519 / wrapping **hors PostgreSQL**.

**LOT 5 (PDF) interdit.**
