# Pièces jointes — stockage effectif

## Contrôles déjà en place

`backend/lib/communicationsAttachments.js` :

- types MIME autorisés : PDF, JPEG, PNG
- taille max 10 Mo
- extensions exécutables bloquées
- magic bytes
- neutralisation path traversal
- pas de fichier public sans autorisation métier (GET authentifié)

## Stockage

| Env | Comportement |
|---|---|
| Production / préprod (`NODE_ENV=production`) | `SOMAFRIK_COMMUNICATION_STORAGE` **obligatoire**, hors `/tmp` |
| Dev/test | fallback tmp autorisé |

Chiffrement au repos : celui du disque / volume hébergeur (Render). Pas de chiffrement applicatif fichier-par-fichier supplémentaire.

Sauvegarde : politique volume / snapshots hébergeur. Non implémentée dans l’app.

Conservation : liée à l’entité parente (message, annonce, notification). **Pas** de job de purge PJ dans ce lot.

Suppression : avec l’entité parente côté métier ; à l’effacement de compte, les PJ de communications **ne sont pas** promises comme détruites (dossier / preuve possible).
