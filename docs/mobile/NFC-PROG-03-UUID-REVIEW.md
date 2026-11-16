# NFC-PROG-03 — Correctif Backend de l’UUID de confirmation

Date : 13 octobre 2026. **DRAFT / HOLD — NO READY — DIFF CTO REQUIS — NO MERGE.**

## Origine et constat

Correctif ciblé demandé après la revue CTO de #913. Branche isolée
`codex/nfc-prog-03-confirm-operation-uuid`, depuis #913 à
`db6ca7ec48817dc52740fb64d3bf52229d01ec6a`.
#912 a été vérifiée à `c6f5eaaa23711e4c797f1dac6a764a49f5039096`.
Les deux PR étaient ouvertes, Draft et non mergées ; leurs branches ne sont
pas modifiées. Base GitHub prévue : `develop`, merge-base contrôlée
`1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f`.
Le HEAD livré, le diff exact et la CI sont relevés dans la description de la PR.

Le test PostgreSQL ajouté a été exécuté **avant le correctif** : la confirmation
avec le bon id de carte, le bon secret et le bon UID mais un autre UUID valide
était acceptée. L'assertion exigeant son refus échouait avec
`Missing expected rejection`. Après correction, le même test passe.

Ce constat démontre une absence de liaison de l'intention déclarée à l'opération
réservée. Il ne démontre pas une confirmation d'une autre carte ou d'un autre
établissement : la route, le hash du secret, l'UID/modèle, l'élève, le RBAC,
les flags et le tenant étaient déjà vérifiés. Ces contrôles restent appliqués.

## Correction et ordre des contrôles

Seul le service Backend de confirmation est modifié en production.

1. RBAC existant, identité NFC et observation `locked` sont vérifiés.
2. Un UUID fourni doit être une **chaîne** et respecter le validateur UUID
   canonique. Les tableaux/objets ne peuvent pas bénéficier d'une conversion
   implicite en chaîne. Casse et espaces périphériques sont normalisés.
3. La transaction existante vérifie les flags, verrouille l'élève et la carte
   dans le tenant, puis valide publicId/hash, UID/modèle et élève.
4. Si la ligne possède `nfc_operation_id`, le payload doit fournir exactement
   cet UUID. Le contrôle précède expiration, activation, remplacement, replay
   et toute mise à jour de métadonnées/audit.
5. Expiration, bascule transactionnelle, audit et replay reprennent ensuite
   leur comportement canonique existant.

| Situation | Réponse |
| --- | --- |
| Réservation avec UUID, champ absent ou null | HTTP 400 `STUDENT_CARD_NFC_OPERATION_REQUIRED` |
| UUID vide, malformé ou non textuel fourni | HTTP 400 `STUDENT_CARD_NFC_OPERATION_REQUIRED` |
| UUID valide différent de celui de la ligne | HTTP 409 `STUDENT_CARD_NFC_OPERATION_MISMATCH` |
| UUID de retry/rotation au lieu de l'UUID réservé | HTTP 409 `STUDENT_CARD_NFC_OPERATION_MISMATCH` |
| UUID correct, écriture déjà confirmée et autres contrôles valides | replay idempotent, sans seconde activation/audit |
| Mauvais UUID avec `locked:true` sur carte active | refus ; aucune mise à jour de l'état lecture seule |
| Mauvais UUID pour remplacement préparé | refus ; ancienne carte active et nouvelle réservation inchangées |

L'UUID est une corrélation d'opération, pas une nouvelle preuve d'authentification.
Il ne remplace aucun des contrôles existants, notamment la capability.
Les messages d'erreur sont fixes : aucun token, secret, UID ou UUID attendu
n'est exposé. Les erreurs HTTP du parcours restent `Cache-Control: no-store`.

## Compatibilité des anciennes cartes

Le schéma canonique conserve des cartes **déjà actives et encoded/locked**
antérieures aux réservations, avec `nfc_operation_id=NULL`. #913 prévoit leur
relecture et transmet un UUID null. Ce correctif conserve cette observation :
UUID absent/null autorisé uniquement si la ligne est déjà active/encoded/locked.
Un UUID inventé est refusé ; une carte inactive ne peut pas être réactivée par
cette exception. Aucun UUID n'est attribué, aucune migration n'est exécutée.

Cette exception ne s'applique pas aux réservations #912, même après activation :
leur UUID est présent et reste obligatoire pour chaque confirmation/replay.
La contrainte PostgreSQL impose déjà un UUID aux lignes NFC pending.

## Contrat Backend/Mobile

Route inchangée : `POST /api/student-cards/:id/nfc-confirm`.
Corps #913 inchangé : `{uid, tagType, cardToken, locked, studentId, operationId}`.
`operationId` correspond à `card.nfc.operationId`, l'UUID **de réservation**.
Il reste constant après renouvellement du secret. L'UUID de retry est distinct.

La première confirmation et la reprise après réponse perdue vérifient la même
liaison UUID/id/capability. La réponse reste la carte canonique active, ou le
replay sans token. Aucun endpoint, cache, registre, champ SQL ni flux Android
n'est ajouté. Aucun fichier Mobile n'est modifié par cet incrément.

Le paragraphe de vigilance dans le rapport original #913 décrit son HEAD
historique ; le présent correctif remplace cette limitation pour son propre HEAD.
Les anciennes versions qui confirment une réservation #912 sans UUID recevront
400. Le client #913 envoie déjà le champ correct. Les versions Mobile/Backend
compatibles devront être déployées selon le processus approuvé ultérieurement.

## Tests

- **8 nouveaux tests sur PostgreSQL 16 réel** : UUID divergent avec capability
  correcte ; absence/null/syntaxe/types ; casse canonique et replay incorrect ;
  UUID d'une autre réservation ou d'une rotation ; remplacement ; concurrence
  de confirmations valide/divergente ; expiration sans effet de bord sur mauvais
  UUID ; cartes historiques actives/inactives.
- Suite ciblée Backend : **43/43 PASS, zéro skip** : 36 tests lifecycle PostgreSQL,
  1 SQL et 6 unitaires NFC. Les anciens tests passent désormais l'UUID de réservation
  attendu pour exercer réellement expiration, transactions, audit et concurrence.
- HTTP réel : matrice d'erreurs 400/409, absence de token/secret/UID/UUID attendu
  dans les erreurs, no-store, absence de mutation/audit ; refus RBAC/tenant,
  réponse de confirmation perdue suivie d'un replay correct ; refus du replay
  avec nouvel UUID et refus du remplacement avec UUID de l'ancienne carte.
- **7 runners PostgreSQL** registre, lifecycle, resolve, présence, finance,
  gestion HTTP et scan HTTP : PASS sur le conteneur local jetable.
- **52 tests Mobile individuels** et **15 tests session/pont natif**, lecteur/QR :
  PASS sans changement de code Mobile.
- Gate de périmètre LOT4 : ajout de la seule référence exacte de ce rapport,
  avec le cas comportemental d'allowlist ; les refus hors périmètre sont conservés.

Les résultats CI au HEAD livré sont publiés dans la description de la PR.
Les workflows hérités testent PostgreSQL, le Mobile et les gates générales au
même SHA ; aucun succès CI n'est annoncé avant leur exécution.

## Revue CTO et suite

Diff indépendant requis : **#913 HEAD → HEAD du correctif**. Le diff contre
`develop` contient aussi les modifications héritées de #909, #912 et #913.
Le correctif n'autorise pas lui-même Ready, merge ou NFC-PROG-04.

Aucun déploiement, migration préproduction/production, changement des PR sources
ou test physique. Le jeton statique de la carte reste clonable ; l'UUID ne
constitue pas une authentification forte. La revue ligne par ligne des dépendances
et la future recette Android NTAG213/216 restent nécessaires.

**DRAFT / HOLD — NO READY — DIFF CTO REQUIS — NO MERGE.**
