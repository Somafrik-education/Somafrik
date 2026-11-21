# NFC-PHYS-01 — Reprise d'audit CTO indépendante au 06/11/2026

Statut : **AUDIT / DRAFT / HOLD — NO READY / NO MERGE / NO DEPLOY**.

## Base et méthode
- Dépôt : Somafrik-education/Somafrik.
- Base canonique lue : `develop@a14c5866b3145758bdc48bf1285e16f6f3d49ad0`.
- Comparaison du SHA à develop le 06/11 : `identical`.
- Analyse GitHub en lecture seule de `Mobile/src/lib/studentCardNfcEncoderNative.ts`, `Mobile/src/lib/studentCardNfcEncoding.ts`, `Mobile/src/lib/nfcSession.ts`, `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx`, et de `Mobile/src/lib/studentCardNfcEncoding.test.ts`.
- Référence historique : PR #922 (audit) et #925 (correctif), **toujours ouvertes Draft/HOLD et divergentes** ; ne pas les merger en l'état.
- Contrôle des PR : #954, #956, #960, #970, #974 sont mergées. Ne pas confondre ces changements avec la preuve d'un smoke physique actuel.

## Constats du code courant

### ENC-01 — Interruption après écriture : risque toujours présent
L'encodeur natif exécute `writeNdefMessage(... { reconnectAfterWrite: true })`, puis `session.reset()` et `openNdef(expectedUid)`. `reset()` appelle `cancelTechnologyRequest()`, garde seulement le bail logiciel ; une nouvelle présentation NFC est nécessaire. La puce peut déjà contenir le NDEF alors que la confirmation serveur n'a pas eu lieu. **Chemin logiciel prouvé, panne physique actuelle NOT RUN.**

### ENC-02 — Erreur d'interruption masquée par un changement AppState
Le panneau individuel incrémente `generation` et ferme le matériel à toute transition hors `active`. Le `catch` de `run()` n'affiche l'erreur que si `valid()` est encore vrai. Cela permet de perdre le diagnostic d'une opération annulée alors que la puce pourrait déjà avoir été écrite. **Chemin logiciel prouvé ; cause du cas #921 non démontrée.**

### ENC-03 — Contrat de sécurité serveur préservé dans le flow
`confirmRead` relit le NDEF attendu et vérifie le statut en lecture seule avant `api.confirm`. `assertActive` exige la même carte, le même UID/modèle/opération et `active` avec `encoded/locked`. Les tests simulés vérifient absence de succès lors d'erreurs, rejeu sans nouvelle écriture, refus des cartes étrangères. **Tests de code présents ; ni exécution CI du présent rapport ni appel réel à PostgreSQL constatés.**

### ENC-04 — Risque sécurité / capacité
Un NDEF affiché par un lecteur externe contient une capability ; aucune capture complète, aucun UID brut, aucun jeton, hash ni nom d'élève ne doit figurer dans les journaux, PR ou preuves. Le code interdit `makeReadOnly` et n'écrit pas de verrou matériel par défaut. Le diagnostic Android des cartes inconnues doit rester strictement en lecture seule.

## Replay préalable — sans mutation
1. Comparer SHA APK installé, profil préprod et SHA backend Render déployé ; si inconnus, résultat NOT RUN et **aucun encodage**.
2. Préparer une NTAG213 et une NTAG216 de test **vierges** autorisées, n'ayant aucune ligne UID réservée, à vérifier côté établissement. Ne jamais utiliser la carte historique exposée, perdue, révoquée ou au propriétaire inconnu.
3. Capturer étapes assainies `inspect`, `openNdef`, `write`, `reset`, `rediscover`, `readback`, `confirm`, ACK API, avec codes statiques et horodatages ; pas de NDEF/token/UID/PII.
4. Confirmer physiquement relecture fraîche après écriture, même carte; observer tout passage `inactive/background`, ouverture application NFC externe et retour premier plan.
5. Lire uniquement les métadonnées canoniques de la carte de test (tenant, état, empreinte d'opération non sensible) : `active` + `encoded/locked` **après** ACK de confirmation, pas avant.
6. Rejouer interruption après écriture, timeout de confirmation, redémarrage, expiration, et réessai idempotent sans émission ni écriture à l'aveugle.
7. Après activation seulement : smoke lecture NFC et appel Présences; vérifier qu'une présence n'est enregistrée qu'une fois.

## Tests automatisés exigés pour la future PR corrective si le smoke révèle la panne
- Android : sortie `active → inactive → background → active` aux phases `writing/verification/confirmation` sans disparition du diagnostic; reprise explicite sans reprogrammation.
- Deux cartes différentes pendant la redécouverte : UID mismatch et aucune confirmation.
- Une seule acquisition du manager NFC, aucun propriétaire périmé ne ferme la session suivante, timeout et retry de lecture.
- Backend PostgreSQL réel : confirmation idempotente, réservation expirée ou révoquée, autre tenant, UUID/mapping, absence de double audit.
- CI : lint, TypeScript, build/preview APK, tests ciblés et gates requis. Mesures sans données sensibles.

## Table des preuves au moment du présent audit
| Contrôle | Statut |
| --- | --- |
| Audit source sur develop courant | PASS |
| Anciennes PR et dépendances vérifiées | PASS |
| Diff indépendant d'une PR corrective | NOT RUN (aucune PR corrective ouverte) |
| SHA APK installé vs backend Render préprod | NOT RUN |
| NTAG213 physique | NOT RUN |
| NTAG216 physique actuel | NOT RUN |
| Confirmation PostgreSQL actuelle | NOT RUN |
| Présence NFC de bout en bout | NOT RUN |
| GO Ready/Merge/Deploy | **NO GO** |

## Décision
Ne pas fusionner #922/#925 à l'aveugle : ancien arbre, modifications plus récentes, absence de smoke actuel. La prochaine action utile est **le contrôle des versions et le smoke physique non destructif**, puis seulement un correctif minimal sur branche fraîche si une cause est confirmée. La branche de ce document ne contient aucun code, secret, SQL exécuté ni mutation production.
