# LOT 11 — Onboarding réel d’un modèle établissement : artefact source + mapping traçable

**Statut :** GO DEV / HOLD READY+MERGE. **LOT 12+ interdit.**  
**Ticket :** #655. **Parent gouvernance Phase 2 :** #654. **Historique LOT 0→10 :** #620 (clôturé).  
**Prérequis :** LOT 10 mergé (`develop@43353cb9092194ef112d084393003ca16b67eaca`).  
**Branche :** `cursor/report-card-lot11-source-artifact`.

Permettre à l’établissement de joindre son **modèle source de bulletin** (PDF/JPG/JPEG/PNG) à une demande LOT 6/7, puis au Superadmin de le consulter et de le mapper **explicitement** vers le bundle canonique `AcademicRuleProfile + ReportCardSchema + RenderingTemplate`.

Le fichier source est une **preuve documentaire**, jamais une règle exécutable. Aucun OCR/IA. Aucune branche pays/école. Aucun Mobile.

## Révision courante

| Champ | Valeur |
| --- | --- |
| RED | `0ba33ac0d220723312ff4d00a4cc2d4d62947847` — tests + inventaire. Production code unmodified. |
| GREEN | `d07d462356ea7b48da5b038e83dad83d841aea92` — domaine, stockage dédié, HTTP, Web. **Production code modified: YES.** |
| Correctifs CTO P0-A / P1-B | commit suivant — transaction PG + verrou `(school_id, request_id)` + compensation blob ; audit mapping id/version/hash. **Production code modified: YES.** |
| Décision CTO stockage | Option 2 : `SOMAFRIK_REPORT_CARD_SOURCE_STORAGE` (root dédié). Même volume physique autorisé via sous-répertoire. **Ne pas** utiliser `SOMAFRIK_COMMUNICATION_STORAGE` comme root runtime. |

## Contrat stockage GREEN (validé CTO)

1. `SOMAFRIK_REPORT_CARD_SOURCE_STORAGE` obligatoire en préprod/prod (`NODE_ENV=production`) ; absence ou `/tmp` `/var/tmp` → fail-closed 503.
2. Clés opaques `YYYY/<uuid>` : **aucun** `schoolId`, `requestId`, `modelKey` ni nom original dans le chemin.
3. `artifact_id` opaque ≠ locator de stockage ; le storage key n’est **pas** exposé au client.
4. Magic bytes PDF/JPEG/PNG, MIME cohérent, max 10 MiB, SHA-256 enregistré.
5. ACL bulletin : pas de GET public ; établissement = son tenant/sa demande ; Superadmin = `REPORT_CARD_CONFIGURE` + contexte cible + audit.
6. Pattern de sécurité Communications réutilisé (`sniffMime`) **sans** refactor du domaine Communications.
7. Métadonnées PostgreSQL tenant-scopées ; binaire hors PG.
8. Docker : même volume `communication_storage`, env dédiée pointant vers `.../report-card-source`.

## Inventaire stockage — pré-gate CTO

Objectif : réutiliser un mécanisme de stockage **canonique, durable, déjà présent**, sans inventer un provider.

### Réutilisable : disque durable Communications

| Item | Détail |
| --- | --- |
| Module | `backend/lib/communicationsAttachments.js` — `storageRoot`, `persistAttachmentBytes`, `readAttachmentBytes`, `validateUploadBuffer`, `sniffMime` |
| Provider | Système de fichiers local. **Aucun S3 / R2 / Supabase Storage / multer.** |
| Env | `SOMAFRIK_COMMUNICATION_STORAGE` (obligatoire en production ; `/tmp` interdit). Volume Docker `communication_storage` → `/var/lib/somafrik/communication-storage` |
| Identifiants | `randomUUID()` — clés `{schoolId}/{year}/{uuid}` ou `platform-announcements/{year}/{uuid}` |
| Validation | Magic bytes PDF / JPEG / PNG ; MIME déclaré doit correspondre ; max **10 MiB** (`MAX_ATTACHMENT_BYTES`) |
| SHA-256 du contenu | **Non stocké aujourd’hui** — LOT 11 doit l’ajouter côté métadonnées artefact |
| Auth | JWT + RBAC ; établissement via `requireSchool` ; `school_id` PostgreSQL ; ACL au download |
| SQL | Métadonnées seulement (`communication_attachments`, `platform_announcement_attachments`) — `storage_key`, pas les bytes |

Conclusion : **un magasin binaire durable canonique existe.** GREEN doit en réutiliser le **pattern / module** (magic bytes, clé opaque, volume durable, fail-closed production), avec un **préfixe / namespace dédié bulletins** et ACL séparée — ne pas mélanger les PJ de messages et les originaux de modèles.

L’audit framework (§9.4) demandait déjà un stockage durable **dédié** (`original_storage_key`) : même allowlist Communications, isolation `school_id` sur la clé, **nouvelle env plutôt que réutiliser le bucket Communications sans ACL séparée**.

**Décision CTO (option 2) :** `SOMAFRIK_REPORT_CARD_SOURCE_STORAGE` — même volume physique autorisé, root runtime distinct, clés `YYYY/<uuid>` sans identifiants métier dans le chemin.

### Non réutilisable comme magasin d’artefacts source

| Candidat | Pourquoi refusé |
| --- | --- |
| Logos établissement | Même racine disque, JPEG/PNG/WebP, **GET public non authentifié** `/api/schools/:code/logo` |
| `school_documents` / `student_documents` | Métadonnées / `storage_key` texte seulement. DATABASE.md : **pas de binaire PG** |
| `report_card_templates` | Layout JSONB, pas un original PDF/image |
| `evaluationAttachment.js` | Résolution d’entité, pas de fichiers |
| Export data | Snapshot JSON |
| `report_card_published_snapshots.canonical_bytes` BYTEA | JCS JSON du bulletin **publié**, pas un PDF source. Pattern blob PG **interdit** pour les originaux |
| PDF générés LOT 5 | Réponses HTTP éphémères, pas un store d’onboarding |

### Interdit sans nouvel accord CTO

- nouveau provider externe (S3, R2, GCS, …) ;
- blobs PostgreSQL arbitraires pour le fichier source ;
- disque éphémère Render comme store durable ;
- URL publique brute non protégée.

## Contrat GREEN

Module : `backend/lib/reportCard/reportCardSourceArtifact.js` → `createReportCardSourceArtifact`.
Stockage : `backend/lib/reportCard/reportCardSourceStorage.js`.
Métadonnées PG : `report_card_source_artifacts` + audit append-only.

- Upload établissement : `REPORT_CARD_SUBMIT_MODEL`, propre `school_id`, propre demande.
- Superadmin : `REPORT_CARD_CONFIGURE`, preview cross-tenant audité, mapping **humain** vers profile/schema/template.
- Magic bytes, taille max testée, nom original non fiable, clé opaque, SHA-256, pas d’HTML/SVG/script.
- Versioning : replace = nouvelle version + archive de l’ancienne ; un seul `current` ; retry idempotent (même clé + même hash) ; conflit si même clé + contenu différent.
- Après activation : référence d’artefact immuable.
- Hash mismatch / artefact absent → fail-closed.
- Audit append-only attach/replace/archive.
- `READY_FOR_REVIEW` pin la version + hash exacts.
- Web uniquement. Mobile inchangé.
- Remplacement PG : transaction dédiée, `pg_advisory_xact_lock` + `FOR UPDATE` sur la demande `(school_id, request_id)`, calcul de version sous verrou, archivage + INSERT + audit atomiques. Le blob est persisté sous verrou ; si le commit DB échoue, compensation `remove` du nouvel objet. Le `Set` processus n’est plus le verrou de production.
- Mapping traçable : `MAP_EXPLICIT` persiste `artifact_id` / `artifact_version` / `artifact_sha256` et les refs exactes du bundle (`profile|schema|template` id + version + spec_sha256) — jointure testée, pas de corrélation par horodatage.
- Pin mapping durable (`report_card_source_artifact_mapping`) : replace après mapping invalide le pin ; `markReadyForReview` fail-closed si `current != mapped` ou mapping stale ; le statut request est relus sous `FOR UPDATE` avant mutation artefact.
- Preview Web authentifié établissement et Superadmin (iframe PDF / img) ; `/source-artifact/content` en `Content-Disposition: inline` (`?download=1` = attachment), `nosniff`, `private, no-store`.

Gate : `npm run verify:report-card-lot11` (domaine, HTTP, PG, Web).
