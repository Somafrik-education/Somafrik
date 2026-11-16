# NFC-PRES-LOCAL-PR1b — Clés de signature du pack hors ligne

Statut : **DRAFT / HOLD**. Fonction non activée ; aucune clé de production ou de préproduction n'est créée par cette PR.

Contrat : `docs/audits/NFC-PRES-LOCAL-PR0-architecture-offline-20261107.md` (§4.1 à §4.5).
Code : `backend/lib/rollCallOfflinePackSigner.js`, `backend/lib/rollCallOfflinePack.js`.

## 1. Rôle des clés

La route `GET /api/student-cards/roll-call/offline/v1/pack` renvoie un pack signé en Ed25519. Le téléphone vérifie cette signature avec les clés publiques embarquées dans l'APK (PR2), pour détecter une altération du pack stocké.

**Le pack est indicatif** : il n'accorde aucun droit. Une clé compromise permet au pire d'afficher une carte comme « reconnue » à tort ; la synchronisation (PR1c) revalide tout en base.

## 2. Configuration (variables d'environnement du service API)

| Variable | Nature | Contenu |
| --- | --- | --- |
| `ROLL_CALL_PACK_SIGNING_KEY` | **secret** | Clé privée Ed25519 **active**, PKCS#8 DER encodé en base64 ou base64url, sur une ligne |
| `ROLL_CALL_PACK_KEYRING` | public | JSON du trousseau (ci-dessous) |
| `ROLL_CALL_PACK_MATCH_SECRET` | **secret** | Secret dédié de dérivation des `matchKey` (HKDF), ≥ 32 caractères, **distinct de `JWT_SECRET`** et propre à chaque environnement |

```json
{
  "revocationSequence": 0,
  "keys": [
    { "keyId": "rc-pack-prod-1", "publicKey": "<32 octets, base64url>", "status": "active" },
    { "keyId": "rc-pack-prod-2", "publicKey": "<32 octets, base64url>", "status": "standby" }
  ]
}
```

Règles vérifiées à **chaque** requête de pack (fail-closed, réponse `503 ROLL_CALL_PACK_SIGNING_UNAVAILABLE`, aucun pack) :
- `keyId` de la forme `rc-pack-<a-z0-9->`, unique ; clé publique Ed25519 de 32 octets, unique ;
- `status` ∈ `active`, `standby`, `retired`, `revoked` ; **exactement une** clé `active` ;
- la clé privée doit correspondre à la clé publique `active` ;
- `revocationSequence` entier ≥ 0, et ≥ 1 dès qu'une clé est `revoked`.

Secret de rapprochement : absent, de moins de 32 caractères, égal à une valeur d'exemple connue ou égal à `JWT_SECRET` → `503 ROLL_CALL_PACK_MATCH_SECRET_UNAVAILABLE`, aucun pack.

Aucune valeur par défaut. Sans ces trois variables, la route répond 503 ; les autres routes ne sont pas concernées.

**Cache et rotation.** Le signataire construit est réutilisé tant que `ROLL_CALL_PACK_SIGNING_KEY` et `ROLL_CALL_PACK_KEYRING` gardent exactement la même valeur dans le processus ; toute autre valeur produit un nouveau signataire, et une configuration devenue invalide est refusée (aucun signataire périmé n'est servi depuis le cache). En revanche, les variables d'environnement d'un processus Node ne changent pas pendant sa vie : sur Render, modifier une variable déclenche un **redéploiement**, et chaque instance ne prend la nouvelle configuration qu'à son **redémarrage**. **Aucune rotation à chaud n'est possible ni promise.** Pendant un redéploiement multi-instances, une instance non encore redémarrée continue de signer avec l'ancienne clé : c'est sans danger en rotation planifiée (ancienne clé `retired`, encore vérifiable), et maîtrisé en rotation d'urgence par la liste de révocation (§5, §6), testée avec deux instances simultanées dans `rollCallOfflinePack.http.pg.test.js`.

**Secret de rapprochement.** Le `matchKey` n'est qu'une clé de jointure locale entre `students` et `cards` **à l'intérieur d'un même pack** (dérivée de `LP(packId, studentId)`) ; il n'est ni envoyé au serveur lors de la synchronisation, ni vérifié ensuite. Changer `ROLL_CALL_PACK_MATCH_SECRET` n'invalide donc aucun pack déjà téléchargé : les nouveaux packs ont simplement d'autres `matchKey`. Il est dissocié de `JWT_SECRET` pour qu'une rotation du secret JWT (ou une fuite de celui-ci) n'ait aucun lien avec les packs, et réciproquement. Génération : `openssl rand -base64 48`, une valeur différente par environnement (préproduction ≠ production).

Les clés de **préproduction et de production sont distinctes** ; l'APK de chaque environnement n'embarque que les clés publiques de son environnement.

## 3. Génération d'une paire de clés (poste de l'opérateur, hors dépôt)

```bash
openssl genpkey -algorithm ed25519 -outform DER -out rc-pack.der
```

```bash
base64 -w0 rc-pack.der
```

Clé publique brute en base64url, pour le trousseau et l'APK :

```bash
openssl pkey -inform DER -in rc-pack.der -pubout -outform DER | tail -c 32 | base64 -w0 | tr '+/' '-_' | tr -d '='
```

La sortie de la deuxième commande va dans le secret Render `ROLL_CALL_PACK_SIGNING_KEY` ; le fichier `rc-pack.der` est ensuite détruit. Ne jamais coller une clé privée dans une issue, une PR, un journal ou une conversation.

La clé `standby` est générée de la même façon ; sa clé **privée** est conservée hors ligne, dans un coffre distinct, et n'est **pas** déployée tant qu'elle n'est pas activée. Seule sa clé publique figure dans le trousseau et dans l'APK.

## 4. Rotation planifiée

1. Générer une nouvelle clé `standby` (clé N+1) ; publier une APK dont le trousseau embarqué contient les clés `active`, `standby` et N+1.
2. Attendre que cette APK soit la version minimale supportée.
3. Déployer la clé privée `standby` dans `ROLL_CALL_PACK_SIGNING_KEY` et mettre à jour le trousseau : ancienne `active` → `retired`, `standby` → `active`, N+1 → `standby`. `revocationSequence` inchangée. Les deux variables sont modifiées **dans le même redéploiement** (une clé privée qui ne correspond pas à la clé `active` du trousseau donne 503).
4. **Redéployer** le service et vérifier que **toutes** les instances ont redémarré (tableau de bord Render), puis qu'un pack récent porte le nouveau `keyId`.
5. Les packs déjà signés par la clé retirée restent vérifiables jusqu'à leur expiration (au plus 37 h).

## 5. Rotation d'urgence (clé compromise)

Aucune hypothèse de mise à jour instantanée des APK :

1. Déployer immédiatement la clé privée `standby` (déjà présente dans toutes les APK supportées) comme `active`.
2. Passer la clé compromise à `revoked` et **incrémenter** `revocationSequence`, dans le même redéploiement ; vérifier que **toutes** les instances ont redémarré : tant qu'une ancienne instance tourne, elle signe encore avec la clé compromise (ces packs sont refusés par tout téléphone ayant déjà reçu la révocation).
3. Chaque pack émis transporte désormais la liste de révocation signée par la nouvelle clé active. Une APK qui la reçoit refuse tout pack signé par la clé révoquée, y compris un pack déjà stocké (comportement PR2).
4. Une APK restée hors ligne peut encore accepter un pack frauduleux signé par la clé compromise : effet limité à l'affichage, aucun droit (risque P1-9 du contrat).
5. Générer une nouvelle clé `standby`, la livrer dans une APK.

## 6. Liste de révocation

Pas de route dédiée : la liste est jointe à **chaque** réponse de pack.

```json
"revocations": {
  "list": { "contractVersion": "rc-offline-1", "sequence": 1, "revokedKeyIds": ["rc-pack-prod-1"], "issuedAt": "…" },
  "signature": { "alg": "Ed25519", "keyId": "rc-pack-prod-2", "value": "…" }
}
```

- Message signé : `utf8("somafrik.rc-offline.revocations.v1\n") ‖ utf8(JCS(list))`, étiquette ajoutée à `rollCallOfflineProof.js`.
- Contenu limité aux `keyId` révoqués et à la séquence : aucune clé (privée ou publique), aucune donnée d'établissement, aucune information sur les autres comptes.
- Accès : celui du pack (enseignant affecté, permissions et flags). Une route de révocation séparée aurait élargi la surface (nouvelle permission, nouveaux appelants) sans bénéfice pour la V1 : le téléphone reçoit la liste à chaque pack téléchargé.
- **Anti-rollback côté client (PR2)** : le téléphone conserve la plus grande séquence vue et l'union des `keyId` révoqués ; il refuse une liste de séquence inférieure et ne retire jamais une révocation. Côté serveur, la règle d'exploitation est de ne **jamais** diminuer `revocationSequence`.

Évolution du contrat PR0 : la réponse HTTP contient, en plus de `pack` et `signature`, le champ `revocations` ci-dessus.

## 7. Fenêtre d'émission (rappel)

Pour une date `D`, dans le fuseau IANA de l'établissement (`schools.profile_payload->>'timezone'`, vide → `Africa/Kinshasa`, invalide → `503 ROLL_CALL_OFFLINE_TIMEZONE_INVALID`) :

| Borne | Valeur |
| --- | --- |
| Émission | `[D−1 12:00 ; D+1 00:00[`, sinon `409 ROLL_CALL_PACK_DATE_OUT_OF_RANGE` |
| `notBefore` | `D 00:00` |
| `expiresAt` | `D+1 00:00` (exclusif) |
| `syncDeadline` | `D+4 00:00` |

Bornes calculées à partir des heures murales locales (jamais « + 24 h ») et recoupées en test avec `AT TIME ZONE` de PostgreSQL. Une heure inexistante (saut d'heure, y compris à minuit) donne l'instant du saut.

Les bornes signées protègent l'**intégrité** du pack, pas la fiabilité de l'horloge du téléphone : une horloge Android manipulée peut tromper l'affichage local. Seule la validation serveur (PR1c) fait autorité.
