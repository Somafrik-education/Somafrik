# LOT 7 — Web Bulletins et vérification publique `/verify`

**Statut :** GO DEV / HOLD READY+MERGE. **LOT 8+ interdit.**  
**Ticket :** #641. **Prérequis :** LOT 6 mergé (`develop@0e84e407`).

Web établissement, Web Superadmin, routes HTTP du workflow LOT 6, consultation des bulletins publiés **sans recalcul**, page publique `/verify/rc/:capability` consommant exclusivement `lookupPublic` (LOT 4).

## Routes HTTP

Namespace dédié `/api/report-card/...` (pas de collision avec le legacy `/api/report-cards`).  
Vérification publique : `POST /api/public/report-cards/verify` **sans auth**.

Établissement : soumettre, lister/lire son `school_id`, approuver / demander des modifications, audit, bundle figé, binding ACTIVE.  
Superadmin : file d’attente avec **école cible explicite**, catalogue profile/schema, revue, configuration, gabarit, bind, prévisualisation, READY_FOR_REVIEW, rejet, activation.

Adapter RBAC production : `Bulletins:CREATE` → soumettre ; `Bulletins:UPDATE` → approuver ; `Bulletins:READ` ne produit aucun token d’écriture. Pas de fallback de rôle `Admin School`.

Vérification publique : `POST /api/public/report-cards/verify` **sans auth**. Runtime HTTP : clé Ed25519 active + `SOMAFRIK_REPORT_CARD_SIGNING_HISTORICAL_PUBLIC_KEYS_JSON` (clés publiques historiques). Fail-closed si `signing_key_id` inconnu ; jamais de re-signature d’un snapshot ancien.

Erreurs stables : `RBAC_DENIED` / `PLATFORM_CONTEXT_REQUIRED` / `TENANT_MISMATCH` → 403 ; `REQUEST_NOT_FOUND` / `VERSION_NOT_FOUND` → 404 ; `INVALID_TRANSITION` / `IDEMPOTENCY_CONFLICT` → 409 ; sinon 400.

## `/verify`

Capability `publicId.token` sur **`/verify/rc/...` à la racine** (contrat QR LOT 0), hors basename `/web`. Snapshot `REVOKED` : statut public `revoked`, jamais « authentique ». Transport indisponible : état déterminé, pas un chargement infini.  
`Cache-Control: no-store`, `Referrer-Policy: no-referrer`. Pas de mint/rotation, pas de persistance client, pas de fallback live.

Acteur établissement : `effectiveSchoolId` UUID canonique (jamais le login_code V2 comme `school_id` PG).

## Web

- Établissement : `/bulletins/modele` (legacy `/bulletins` inchangé).
- Superadmin : `/parametres/bulletins-configuration`.
- Public : `/verify/rc/:capability` hors `ProtectedRoute`, `fetch` brut.
- Rendu snapshot : TOTAL / PERCENTAGE / RANK / DECISION / présence, sans arithmétique.

## Interdit

Mobile (LOT 8), historique (LOT 9), pack Burundi (LOT 10), recalcul LOT 3, mutation token/snapshot LOT 4.

Gate : `npm run verify:report-card-lot7`.
