# LOT 5 — PDF canonique et QR imprimable

**Statut :** GO DEV / HOLD READY+MERGE. **LOT 6+ interdit.**  
**Ticket :** #636. **Prérequis :** LOT 4 mergé (`develop@1a24cc49`).

Le PDF est un **consommateur** du snapshot LOT 4. Rendu uniquement après `payloadForRender` (JCS + SHA-256 + Ed25519). Puppeteer **après COMMIT**. Aucun mint/rotation de token. QR stratégie A reconstruit via `reprintUrl` (`public_id` + `token_ciphertext`).

Le driver par défaut consomme `{ html, qr }` (chaîne HTML, pas un objet passé à `setContent`). Il lance Chromium, bloque tout réseau hors `data:` / `about:blank`, rasterise `.qr` (jsQR) puis émet un Buffer A4 `%PDF`. Le HTML générique rend `cells`, `slots` (TOTAL / PERCENTAGE / RANK / DECISION / …) et `presence` du snapshot. `RenderingTemplate` n’est pas LOT 5 : s’il est fourni (y compris `null`), fail-closed `RENDERING_TEMPLATE_REQUIRED`.

## Invariants

- Lookup interne tenant-scopé. Tamper / clé inconnue / signature invalide → fail-closed.
- Aucun fallback vers notes/classes/élèves live.
- Un échec PDF ne mute pas la publication.
- ECC **Q**, quiet zone ≥ 4 modules, taille imprimée **30 mm**, scan round-trip = URL exacte, y compris après rendu Chromium.
- CSS `@page`, QR `page-break-inside: avoid`, polices serveur, HTML échappé, aucun asset réseau.

**LOT 6 (workflow établissement / Superadmin) interdit.** LOT 7 `/verify` UI, LOT 8 Mobile, LOT 9 historique, LOT 10 qualification : hors périmètre.
