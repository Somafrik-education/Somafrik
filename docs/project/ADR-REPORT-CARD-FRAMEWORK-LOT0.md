# ADR-014 — Framework bulletins scolaires (LOT 0)

**Statut :** Proposée — Draft PR LOT 0 (pas d’implémentation métier)  
**Date :** 2026-09-12  
**Source :** audit CTO [`docs/audits/report-card-framework-multicountry.md`](../audits/report-card-framework-multicountry.md) (PR #614, GO documentaire)

Cette ADR **fige** les contrats obligatoires pour LOT 1 à LOT 10. Elle n’ouvre pas de migration SQL, de route publique, d’UI, ni de moteur de notes.

---

## 1. Trois couches (pays ≠ template)

```text
pays → règles académiques autorisées → établissement → modèle / version de bulletin → classe(s)
```

| Couche | Rôle | Ne fait pas |
| --- | --- | --- |
| `AcademicRuleProfile` | Comment on calcule (périodes, composantes TJ/EX, maxima, coefs, N/A, arrondi, rang) | Couleur, pagination, logo |
| `ReportCardSchema` | Grille logique (groupes, colonnes, slots signature / appréciation) | Formules |
| `RenderingTemplate` | Papier, CSS, emplacement QR | Recalcul des notes |

**Interdit dans le moteur** (`backend/lib/reportCard/**`, `backend/lib/reportCardEngine/**`, `backend/contracts/reportCard/**` hors tests) :

```ts
if (country === "BI") ...
if (school === "La Colombière") ...
```

Gate : `no-country-school-branch`.

Pipeline unique :

```text
grades PostgreSQL → engine serveur → snapshot immuable → Web / Mobile / PDF / /verify
```

Aucun client ne recalcule un bulletin officiel. Le PDF **consomme** le snapshot.

---

## 2. Snapshot canonique — RFC 8785 JCS

**Choix :** RFC 8785 JSON Canonicalization Scheme (JCS).  
**Écarté pour le défaut :** blob `bytea` seul (reste une option d’implémentation interne si le JSON est figé **une fois** en bytes JCS, jamais re-sérialisé via `jsonb::text`).

Règles :

- `canonical_bytes = JCS(snapshot_payload)`
- le payload publié **inclut** `report_card_id`, `published_snapshot_version`, `school_id`, `published_at`
- `snapshot_sha256 = SHA-256(canonical_bytes)`
- `snapshot_signature = Ed25519.Sign(canonical_bytes)` — **les mêmes bytes** que le hash
- **interdit :** `JSON.stringify` comme canon, `jsonb::text`, round-trip qui réordonne les clés

Une fois `PUBLISHED`, le payload n’est plus muté. Correction = **nouvelle** version. Gate : `snapshot-immutability`, `snapshot-canonical-jcs`.

---

## 3. Authenticité — Ed25519

Champs : `snapshot_sha256`, `snapshot_signature`, `signing_key_id`.

- Algorithme **par défaut : Ed25519**
- Clé **privée hors PostgreSQL** (KMS / secret manager / HSM)
- Rotation : les cartes existantes vérifient avec le `signing_key_id` historique ; **jamais** re-signer un snapshot publié
- HMAC/KMS seulement si une ADR ultérieure l’impose. Un hash en base **seul** est insuffisant (un `UPDATE` peut réécrire payload + hash).

Gate : `snapshot-signature`.

---

## 4. QR — stratégie A (figée)

Capability URL :

```text
https://somafrik.app/verify/rc/<public_id>.<token>
```

| | |
| --- | --- |
| Token | Aléatoire ≥ **128 bits** |
| Vérification `/verify` | `token_hash` (SHA-256), comparaison constante |
| Reprint | `token_ciphertext` (AES-256-GCM / envelope KMS) + `wrapping_key_id` |
| Clé de wrapping | **Hors PostgreSQL** |
| Invariant | `même version → même URL → même QR` après redémarrage et des années |

**Écartés comme défaut :** B (HMAC/KDF déterministe), C (un seul opaque). Restent documentés dans l’audit ; les changer exige une ADR de remplacement.

**Interdit :** plaintext durable en PG ; token ou préfixe en logs Render/proxy/CDN/WAF/app/Sentry ; rate-limit par préfixe clair ; mint d’un token dans le PDF.

`/verify` : `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, CSP stricte, **zéro** ressource/analytics tierce.

Gates : `reprint-after-restart-keeps-same-qr`, `token-not-in-logs`.

---

## 5. Publication atomique et idempotente

Une **seule** frontière (transaction PG + outbox, LOT 4) crée :

1. statut `PUBLISHED`
2. snapshot figé (bytes JCS)
3. `snapshot_sha256` + `snapshot_signature`
4. identité QR `ACTIVE` (`public_id`, `token_hash`, `token_ciphertext`)
5. outbox `pedagogy.report_card.published`

Clé d’idempotence : `UNIQUE (report_card_id, published_snapshot_version)`.  
Un retry **relit** le même `public_id` / token. **Pas** de second QR.

Le PDF (LOT 5) s’exécute **après COMMIT**, déchiffre `token_ciphertext`, **n’émet jamais** de token.

Gate : `publish-idempotent-qr`.

---

## 6. Cycles de vie

Bulletin élève :

```text
DRAFT → CALCULATED → VALIDATED → PUBLISHED → ARCHIVED
```

Correction officielle : nouvelle version `PUBLISHED` liée ; v1 passe en vérification `SUPERSEDED` et **reste** résolvable (bandeau VERSION REMPLACÉE). Jamais de redirection silencieuse v1→v2.

Vérification publique : `ACTIVE | SUPERSEDED | REVOKED`. Pas de QR sur `DRAFT` / `CALCULATED` / `VALIDATED`.

Demande de modèle (6 bis) :

```text
SUBMITTED → UNDER_REVIEW → CONFIGURING → READY_FOR_REVIEW
  → (CHANGES_REQUESTED → CONFIGURING)* → APPROVED → ACTIVE
```

Branches : `REJECTED`, `ARCHIVED`.  
**Aucun upload n’active** un bulletin. Superadmin n’active qu’après `APPROVED`.

---

## 7. RBAC (jetons)

`REPORT_CARD_CONFIGURE` · `REPORT_CARD_SUBMIT_MODEL` · `REPORT_CARD_GENERATE` · `REPORT_CARD_VALIDATE` · `REPORT_CARD_PUBLISH` · `REPORT_CARD_READ` · `REPORT_CARD_REPRINT` · `REPORT_CARD_CORRECT` · `REPORT_CARD_REVOKE` · `REPORT_CARD_SCHOOL_APPROVE_TEMPLATE`

Les jetons legacy `Bulletins:*` / `Valider bulletins` / `Conception bulletins` sont des **alias de migration**, pas le contrat cible.

Isolation : `school_id = principal.school_id` fail-closed. Gate : `tenant-isolation`.

---

## 8. Fixtures de qualification

`Burundi modèle A` (groupes / bulletin rose) et `Burundi modèle B` (lignes TJ/EX/Total, EX N/A) sont des **fixtures**, pas un `country_pack_bi`. Même `engine_id` : `somafrik.report_card.v1`.

Fichiers : `backend/contracts/reportCard/fixtures/burundi-a.json`, `burundi-b.json`.

---

## 9. LOT 0 ne fait pas

- aucune migration SQL
- aucune route `/verify` ni `/api/report-cards` nouvelle
- aucune UI Web / Mobile métier
- aucun changement du calcul `grades` / `GradeBookService`

Code autorisé : modules de **contrat** + tests (`backend/contracts/reportCard/**`). Le moteur métier commence au LOT 1–3.

---

## 10. Ordre après merge LOT 0

LOT 1 profils → LOT 2 schema → LOT 3 moteur → LOT 4 snapshot/publication/QR → LOT 5 PDF → LOT 6 soumission Superadmin → LOT 7 Web + `/verify` → LOT 8 Mobile → LOT 9 historique → LOT 10 qualification Burundi.

Gate npm : `verify:report-card-lot0`.
