# LOT 5 — PDF canonique et QR imprimable

**Statut :** GO DEV / HOLD READY+MERGE. **LOT 6+ interdit.**  
**Ticket :** #636. **Prérequis :** LOT 4 mergé (`develop@1a24cc49`).

Le PDF est un **consommateur** du snapshot LOT 4. Rendu uniquement après `payloadForRender` (JCS + SHA-256 + Ed25519). Puppeteer **après COMMIT**. Aucun mint/rotation de token. QR stratégie A reconstruit via `reprintUrl` (`public_id` + `token_ciphertext`).

Le driver par défaut consomme `{ html, qr }` (chaîne HTML, pas un objet passé à `setContent`). Il lance Chromium, bloque tout réseau hors `data:` / `about:blank`, rasterise `.qr` (jsQR) puis émet un Buffer A4 `%PDF`. Police de rendu : `SomafrikReportCard` embarquée en `@font-face` `data:` depuis `templates/reportCard/fonts/LiberationSans-Regular.ttf` (pas de substitution Arial/réseau).

Le HTML générique rend `cells`, `slots` (TOTAL / PERCENTAGE / RANK / DECISION / …) et `presence` du snapshot **lorsqu’aucun** `RenderingTemplate` n’est fourni. Un template générique valide (sections `id` / `order` / `label` / `source`) pilote l’ordre et les libellés. `null` → `RENDERING_TEMPLATE_REQUIRED` ; objet invalide → `RENDERING_TEMPLATE_INVALID` ; `qr_required: false` interdit. Aucun stockage ni workflow Superadmin (LOT 6).

## Invariants

- Lookup interne tenant-scopé. Tamper / clé inconnue / signature invalide → fail-closed.
- Aucun fallback vers notes/classes/élèves live.
- Un échec PDF ne mute pas la publication.
- ECC **Q**, quiet zone ≥ 4 modules, taille imprimée **30 mm**, scan round-trip = URL exacte, y compris après rendu Chromium.
- CSS `@page`, QR `page-break-inside: avoid`, polices serveur, HTML échappé, aucun asset réseau.

**LOT 6 (workflow établissement / Superadmin) interdit.** LOT 7 `/verify` UI, LOT 8 Mobile, LOT 9 historique, LOT 10 qualification : hors périmètre.
