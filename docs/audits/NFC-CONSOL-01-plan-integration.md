# NFC-CONSOL-01 — Plan d'intégration des PR NFC

**Statut :** `NFC-CONSOL-01 — DRAFT / HOLD — AUCUN READY — AUCUN MERGE — AUCUNE PR DE DÉVELOPPEMENT.`

Référence obligatoire : `docs/audits/AUDIT-NFC-02-systeme-nfc.md`, mergé par [#918](https://github.com/Somafrik-education/Somafrik/pull/918) au commit `e68807cc2d72bb946c9e656b29456ec6cba97eb9`. Ce commit est le `develop` mesuré ici.

Mesure : comparaisons GitHub `develop...head` (trois points) le 13 octobre 2026. Les dix PR n'ont pas été modifiées, rebasées, ni mergées. Aucun test PostgreSQL ni aucune carte physique n'a été rejoué dans cet environnement. Un check GitHub vert n'est pas une recette NTAG216.

Matériel : **NTAG216 P0** (stock disponible, première recette Android), **NTAG213 P1** (même contrat NDEF, 144 octets utilisateur). Les 888 octets de la NTAG216 ne sont pas une dépendance fonctionnelle. Le bus scolaire reste hors périmètre : aucune des dix PR ne crée de module transport.

---

## 1. Inventaire

`develop` courant : `e68807cc2d72bb946c9e656b29456ec6cba97eb9`.

| PR | Branche | Base enregistrée | HEAD | Merge-base avec `develop` | Ahead / behind | Fichiers | CI du dernier rollup | Décision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [#891](https://github.com/Somafrik-education/Somafrik/pull/891) | `cursor/carte-pr8-mobile-nfc-94fc` | `72aea41b15f234afc867530f6728a3a239d1914f` | `b2aaa6151468b9398b1644299f4bdc081ccb050c` | `72aea41b15f2` | 6 / 15 | 24 | verte, 8 octobre, base périmée | **ABANDONNER** |
| [#908](https://github.com/Somafrik-education/Somafrik/pull/908) | `codex/nfc-encoding-ntag213-216` | `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f` | `c3db71cbaa6e77e761576d439562336c4d6791e6` | `1bdd302e8ab2` | 5 / 1 | 40 | verte | **EXTRAIRE** le verrouillage, ne pas merger |
| [#909](https://github.com/Somafrik-education/Somafrik/pull/909) | `codex/nfc-recon-02-android-ntag213-216` | `1bdd302e8ab2` | `91c2af5c5a6255f010fbbbf7f3b5f85a5d04cb22` | `1bdd302e8ab2` | 6 / 1 | 56 | verte, 42 checks | **ABANDONNER** |
| [#910](https://github.com/Somafrik-education/Somafrik/pull/910) | `codex/nfc-prog-01-audit-contract` | `1bdd302e8ab2` | `c0230910b97a3c6aeb43ac7bd7a5c3b102e77231` | `1bdd302e8ab2` | 1 / 1 | 1 | verte (Scope, Secrets, Required ; le reste ignoré) | **ABANDONNER** |
| [#912](https://github.com/Somafrik-education/Somafrik/pull/912) | `codex/nfc-prog-02-backend-postgres` | `1bdd302e8ab2` | `c6f5eaaa23711e4c797f1dac6a764a49f5039096` | `1bdd302e8ab2` | 7 / 1 | 64 | verte, 42 checks | **ABANDONNER** |
| [#913](https://github.com/Somafrik-education/Somafrik/pull/913) | `codex/nfc-prog-03-android-individual` | `1bdd302e8ab2` | `db6ca7ec48817dc52740fb64d3bf52229d01ec6a` | `1bdd302e8ab2` | 8 / 1 | 65 | verte, 43 checks | **ABANDONNER** |
| [#914](https://github.com/Somafrik-education/Somafrik/pull/914) | `codex/nfc-prog-03-confirm-operation-uuid` | `1bdd302e8ab2` | `01d2ebc95c84c68d2c23ba03490ff1f77c634fc0` | `1bdd302e8ab2` | 9 / 1 | 66 | verte, 43 checks | **ABANDONNER** |
| [#915](https://github.com/Somafrik-education/Somafrik/pull/915) | `codex/nfc-prog-04-android-batch` | `1bdd302e8ab2` | `051751e6c7412d78546ec33596ca7dec774e925c` | `1bdd302e8ab2` | 10 / 1 | 73 | verte, 43 checks | **ABANDONNER** |
| [#916](https://github.com/Somafrik-education/Somafrik/pull/916) | `codex/nfc-prog-05-integration-readiness` | `1bdd302e8ab2` | `6734ff816317163830a5b3df2edd4b4e6d5b2e7b` | `1bdd302e8ab2` | 11 / 1 | 79 | **FAIL** : `NFC APK preview exact HEAD` | **ABANDONNER** |
| [#917](https://github.com/Somafrik-education/Somafrik/pull/917) | `codex/nfc-prog-05-apk-sdk-diagnostic` | `1bdd302e8ab2` | `5f2aa2522f89675dc99809955feef41e486e4b51` | `1bdd302e8ab2` | 24 / 1 | 80 | verte, y compris APK preview, PostgreSQL isolé, Secrets | **REBASER** |

Le retard de 1 commit des PR #908 à #917 est exactement le merge documentaire #918. Leur merge-base reste `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f`.

---

## 2. Tableau comparatif

| Sujet | Déjà sur `develop` | #891 | Pile #908 → #917 | Encore absent |
| --- | --- | --- | --- | --- |
| Carte logique, QR, révocation, remplacement, présence, badge finance | Oui | inchangé | conservé, avec un refus de scan si l'encodage NFC est encore `pending` | — |
| Lecture NDEF Android | Non | Oui, one-shot, base `72aea41b` | Reprise dans #909 puis #917, Android seulement | Session d'appel continue |
| Refus d'une carte étrangère (Navigo) | Non | Oui (NFC-FIX-02) | Oui : `NfcA` + `NfcB` + `IsoDep`, message de refus, pas d'appel API | Recette physique |
| Encodage NTAG213 / NTAG216 | Non | Non | Oui, dès #908, `GET_VERSION` `0x60` | Recette NTAG216 |
| Réservation puis activation | Non | Non | Oui, dès #912 : statut `issued` tant que l'écriture n'est pas confirmée | — |
| UUID d'opération à la confirmation | Non | Non | Oui, #914 | — |
| Programmation en série par classe | Non | Non | Oui, #915 : décompte des cartes à programmer, pas des élèves à pointer | — |
| Verrouillage physique de la puce | Non | Non | `makeReadOnly()` dans #908 ; **retiré** dans l'encodeur de #917 | Décision CTO |
| Gate APK minSdk | Non | Non | #916 en échec ; #917 exige un minSdk compilé dans `[24, 30]` et un target ≥ 31 | Ce n'est pas un test de puce |
| Flag NFC côté serveur | Colonnes seulement | Projection du flag | Encodage refusé si master ou NFC est faux ; le `POST /api/student-cards/scan` n'appelle pas `assertNfcEnabled` | Enforcement du flag sur le scan |
| Droits finance du scan | Présence d'abord, finance ensuite | inchangé | Le bouton NFC exige la présence ; le badge exige `canReadFeeGrids` **et** le flag finance. Le comptable sans présence ne scanne toujours pas | NFC-02-06 ouvert |
| Données sur la puce | — | token NDEF | Un record Text `somafrik:card:<publicId>.<secret>`. Pas de nom, classe, présence, finance | — |
| Bus | Non | Non | Non | Hors chantier |

---

## 3. Graphe de dépendances

Deux lignées. Elles ne se contiennent pas.

```text
72aea41b  (#890, develop du 8 octobre)
    └── #891  b2aaa615   lecteur NFC-FIX-02, 6 commits, 15 commits derrière develop
                          n'est l'ancêtre d'aucune PR Codex

1bdd302e  (develop avant #918)
    ├── #910  c0230910   1 commit, document seul, divergé de la pile
    └── #908  c3db71cb   encodeur + migration UID
            └── #909  91c2af5c   + lecteur et session partagée
                    └── #912  c6f5eaaa   + réservations PostgreSQL
                            └── #913  db6ca7ec   + programmation individuelle
                                    └── #914  01d2ebc9   + UUID de confirmation
                                            └── #915  051751e6   + série par classe
                                                    └── #916  6734ff81   + tests d'intégration
                                                            └── #917  5f2aa252   + 13 commits gate APK / gitleaks

e68807cc  develop actuel = 1bdd302e + merge documentaire #918
```

Preuve d'inclusion, comparaisons `ancien...récent` :

| Paire | Statut | Ahead / behind | Lecture |
| --- | --- | --- | --- |
| #908...#909 | ahead | 1 / 0 | #909 contient #908 |
| #909...#912 | ahead | 1 / 0 | un commit |
| #912...#913 | ahead | 1 / 0 | un commit |
| #913...#914 | ahead | 1 / 0 | un commit |
| #914...#915 | ahead | 1 / 0 | un commit |
| #915...#916 | ahead | 1 / 0 | un commit |
| #916...#917 | ahead | 13 / 0 | #917 contient #916, puis 13 commits |
| #908...#917 | ahead | 19 / 0 | #917 contient #908 |
| #910...#917 | diverged | 24 / 1 | #910 n'est pas dans la pile |
| #891...#917 | diverged | 38 / 6 | les 6 commits de #891 ne sont pas dans #917 |

Merger #908 puis #909 puis #912 ne construit pas un produit : chaque tête contient déjà la précédente. Merger #891 en plus de #917 touche les mêmes fichiers Mobile (`StudentCardNfcScannerModal.tsx`, `studentCardNfc.ts`, plugins, `package.json`).

---

## 4. Conflits

### Avec `develop`

#917 ne modifie pas `docs/audits/AUDIT-NFC-02-systeme-nfc.md`. Le seul chevauchement textuel mesuré est `.gitleaksignore`.

Les deux côtés ajoutent les mêmes empreintes :

- `73da7fe2...:Mobile/scripts/verify-student-card-nfc-apk_test.py:generic-api-key:88`
- `73da7fe2...:Mobile/scripts/verify-student-card-nfc-apk_test.py:generic-api-key:90`

Les commentaires du point 7 diffèrent. Les fichiers ont 46 lignes et ne sont pas identiques. Un rebase de #917 sur `e68807cc` doit garder les empreintes et un seul commentaire. Ce ne sont pas des secrets : condensés publics SHA-256 et MD5 du certificat `CN=Android Debug`.

Aucun autre fichier de #918 n'est dans le diff de #917.

### Entre PR

| Si l'on merge | Conséquence |
| --- | --- |
| #891 et #917 | Conflit sur le lecteur, les plugins NFC, les manifests et les tests Mobile. Deux histoires du même écran. |
| #908 à #916 en plus de #917 | Diff déjà contenu. Double revue, risque de réintroduire `makeReadOnly` ou l'échec APK de #916. |
| #910 | Pas de conflit de code. Le document dit encore que la réservation n'est pas implémentée, ce que #912 a ensuite codé. Le merger publierait un contrat périmé. |
| #916 seul | Le check `NFC APK preview exact HEAD` est rouge. #917 est le correctif de ce check. |

---

## 5. Décision par PR

### #891 — ABANDONNER

Lecteur Android one-shot : `react-native-nfc-manager@4.0.0-beta.10`, permission `android.permission.NFC`, découverte `Ndef` + `NfcA` + `NfcB` + `IsoDep` + `MifareUltralight` + `NdefFormatable`, refus d'une carte non Somafrik, fallback QR seulement si le flag QR et l'auteur d'appel sont vrais, `isSupported()` avant `start()`.

La CI du 8 octobre est verte sur `b2aaa615`, y compris PR Gates. Elle ne couvre pas les 15 commits de `develop` depuis `72aea41b`, ni le merge #918.

#909 a repris ce lecteur sur la base `1bdd302e`. #917 le conserve, Android uniquement (`Platform.OS !== "android"` lève une erreur). Le corps de #891 mentionne encore un chemin iOS `Ndef` + `NfcA`. Ce chemin n'est pas la cible : la première recette est Android, et AUDIT-NFC-02 n'accorde pas de PASS iPhone.

Fichiers : annexe A. Décision : ne pas rebaser #891. Le code utile est déjà dans #917. Fermer #891 sans merge seulement après accord CTO, une fois la tête #917 rebasée.

### #908 — EXTRAIRE le verrouillage, ne pas merger la PR

Apporte l'encodeur, la migration `20261012_student_cards_nfc_encoding.sql` (UID, type `NTAG213`/`NTAG216`, états `pending` / `encoded` / `locked`, index unique sur `nfc_uid`), les routes d'écriture, et `makeReadOnly()` dans `studentCardNfcEncoderNative.ts`.

#917 contient le reste de cette PR (ahead 19, behind 0) **sauf le verrouillage physique**. L'encodeur de `5f2aa252` dit : « Programming never commands a physical lock. » Il observe `NdefStatus.ReadOnly` et envoie ce booléen au serveur. Il n'appelle pas `makeReadOnly()`. Une puce encodée par #917 reste réinscriptible tant qu'un autre outil ne la verrouille pas.

Ne pas merger #908 à côté de #917. Si le CTO exige le verrouillage matériel, l'extraire dans une PR courte après le rebase, avec relecture obligatoire avant l'état `locked`. Sans cet ordre, le constater comme écart, pas le réintroduire en silence.

CI #908 : verte sur son HEAD, y compris `NFC APK preview exact HEAD` et `NFC PostgreSQL 16 isolated`. Ce PASS est antérieur au gate minSdk de #917 et ne valide pas une NTAG216.

### #909 — ABANDONNER

Un commit sur #908 : session unique lecteur/encodeur (`nfcSession.ts`), scanner de #891 repris, écran d'appel branché. CI verte. Contenu inclus dans #917. La session est un bail matériel (une opération à la fois), pas un appel de classe.

### #910 — ABANDONNER

Un seul fichier, `docs/audits/NFC-PROG-01-audit-et-contrat.md`, 639 lignes, divergé de la pile. La section 6 y décrit un contrat de réservation « non implémenté ». #912 l'a implémenté ensuite. Merger #910 contredirait le code de #917.

À conserver dans ce plan, pas dans un second merge documentaire :

- un record NDEF Text, langue `en`, `somafrik:card:` + publicId 22 caractères + `.` + secret 43 caractères ;
- texte 80 octets, record 87, TLV 90, donc dans les 144 octets NTAG213 ;
- pas de nom, de classe, de présence ni de finance sur la puce ;
- le secret sur la puce est une capability révocable, copiable, pas une session Somafrik ;
- `GET_VERSION` : `0x0f` = NTAG213, `0x13` = NTAG216, UID `04` + 6 octets.

Cette taille est une mesure du document #910. Elle n'a pas été revérifiée sur une puce ici : **NOT RUN**.

### #912 — ABANDONNER

Un commit sur #909. Migration `20261013_student_cards_nfc_reservations.sql` : `nfc_operation_id`, expiration, `nfc_replaces_card_id` avec clé étrangère `(school_id, student_id, id)`, une seule réservation `issued` + `pending` par élève. Le cycle passe par une transaction et un audit. L'activation n'a plus lieu avant la confirmation de lecture. CI verte. Inclus dans #917.

### #913 — ABANDONNER

Programmation individuelle Android au-dessus de #912. C'est ici que l'encodeur passe de 88 à 80 lignes et que le verrouillage matériel disparaît du fichier lu sur #917. CI verte. Inclus dans #917.

### #914 — ABANDONNER

La confirmation exige l'UUID d'opération de la réservation, pas un UUID de retry. CI verte. Inclus dans #917.

### #915 — ABANDONNER

Série par classe : `StudentCardNfcBatchControl.tsx`, `studentCardNfcBatch.ts`. Le champ `remaining` compte les cartes de la série de programmation, pas les élèves encore absents de l'appel. CI verte. Inclus dans #917.

### #916 — ABANDONNER

Tests d'intégration Mobile/PostgreSQL, recette documentaire, durcissement du logger (`cardToken` / capability). Le rollup a 42 checks verts et **un échec** : `NFC APK preview exact HEAD`. Ces commits sont dans #917, qui corrige ce job. Ne pas prendre #916 comme tête.

### #917 — REBASER

Tête unique de la pile Codex. 24 commits devant `1bdd302e`, 13 devant #916, 0 commit de #916 absent. 80 fichiers, +9442 / −56 par rapport à `1bdd302e`.

Les 13 commits propres à #917 parsent le badging aapt2, refusent un minSdk compilé ≥ 31, acceptent `[24, 30]`, exigent un target ≥ 31, et alignent le parseur `apksigner` build-tools 37. Le seul chemin nouveau par rapport à #916 est `.gitleaksignore`. Le gate minSdk modifie les scripts APK déjà présents. Le job `NFC APK preview exact HEAD` est vert sur `5f2aa252`. C'est un contrôle d'APK, pas une carte présentée au téléphone.

CI verte observée sur ce HEAD : PR Gates (Scope, Secrets, Quality, Core, Risk-targeted, LOT 0–8, Required), `NFC PostgreSQL 16 isolated`, `NFC Android individual and batch contracts`, `NFC APK verifier unit tests`, `NFC APK preview exact HEAD`. **PASS de workflow. NOT RUN physique.**

Rebase autorisé seulement par un mandat ultérieur, sur `e68807cc`, puis nouvelle CI. Pas dans cette PR.

---

## 6. Architecture cible

Conserver sans les réécrire : émission, liste, perte, révocation, remplacement, QR, upsert de présence, badge financier, cinq flags fail-closed, hash SHA-256 du secret, comparaison en temps constant, une seule carte `active` par élève.

Reprendre depuis #917, après rebase, sans réécriture :

1. **Programmation.** Réservation `issued` + `pending`, écriture NDEF, relecture, puis `nfc-confirm` avec l'UUID. Le `POST /api/student-cards/scan` refuse une carte encore `pending`. Révocation et remplacement restent des transitions serveur. Le remplacement d'une carte qui a un UID NFC exige une nouvelle réservation, pas l'ancien `replace` direct.
2. **NDEF.** Un record Text. Charge utile bornée par la puce au moment de l'écriture (`bytes.length > status.capacity` → `NFC_CAPACITY`). Le plafond de parse `MAX_NFC_RECORD_LENGTH = 256` n'autorise pas un payload métier de 256 octets : le message fonctionnel reste le token canonique, mesuré à 90 octets TLV dans #910. Aucun champ nom, finance ou classe.
3. **Identification.** `GET_VERSION` uniquement. NTAG216 et NTAG213 suivent le même parcours. Un tag qui n'est ni l'un ni l'autre est refusé. L'UID est stocké et unique globalement (`student_access_cards_nfc_uid_unique`). L'erreur « déjà affectée » ne nomme pas l'autre établissement. L'UID n'authentifie pas la puce.
4. **Android.** Permission NFC ajoutée par `withSomafrikNfcAndroid.js`. Pas d'entitlement iOS. MinSdk compilé tenu dans `[24, 30]`.
5. **Secrets.** Le token clair sort à la réservation et à un retry. La confirmation qui rejoue renvoie `tokenAvailable: false`. `safeLogger.ts` masque `cardToken`, `token_hash` et `capability`. L'audit enregistre l'action et le type de puce, pas le secret.

Écarts à ne pas déclarer couverts par #917 :

- **Appel continu.** `scanNfcCardToken` ferme la session dans un `finally` après un tag. Le modal propose « Réessayer ». Ce n'est pas un reader mode qui enchaîne les élèves. Le compteur présents/effectif de l'appel existe déjà sur `develop`. Le décompte des restants **dans une session NFC** n'existe dans aucune des dix PR.
- **Finance.** Le bouton NFC exige le droit de présence et les flags master, NFC et pointage. Le badge exige en plus la lecture des grilles et le flag finance. Le serveur de scan n'a pas été ouvert au comptable sans droit de présence. NFC-02-06 reste ouvert. Aucun montant n'est écrit sur la puce. Le badge ne bloque pas l'appel.
- **Flag NFC sur le scan HTTP.** `assertNfcEnabled` protège l'encodage. Le scan HTTP reste le chemin mergé (master + droits de présence). Un token déjà émis reste présentable par QR. C'est cohérent avec un seul hash pour deux canaux. Ce n'est pas un contournement d'encodage : sans écriture confirmée, la carte NFC n'est pas `active`.
- **Verrouillage.** Voir #908. Tant que `makeReadOnly()` n'est pas rappelé, l'état `locked` ne peut venir que d'une puce déjà en lecture seule.
- **Bus.** Aucun fichier transport dans les diffs. Ne pas en créer.

Isolation : les transactions NFC lisent `school_settings` par `school_id`, verrouillent l'élève et la carte dans ce tenant, et la clé de remplacement est `(school_id, student_id, id)`. Le garde-fou `platformPersonalDataGuard.js` est touché (+2). Ce diff n'a pas été relu ligne à ligne au-delà de cette présence : le rebase devra confirmer que les nouvelles routes restent dans le déni plateforme déjà mergé.

---

## 7. Ordre d'intégration

Aucun de ces lots n'est ouvert par le présent mandat.

1. **Rebase de #917 sur `e68807cc`.** Une PR. Résoudre le commentaire `.gitleaksignore` sans retirer les empreintes. Relancer la CI. Ne pas y ajouter l'appel continu ni le bus.
2. **Si cette PR est jugée trop large pour une revue :** la couper selon l'histoire déjà empilée, sans réécrire :
   - backend #912 + #914 (migrations, réservation, UUID) ;
   - Android individuel + lecteur (#909 et #913) ;
   - série #915 + gate APK #917.
3. **Verrouillage physique**, seulement si le CTO l'exige. Extraire `makeReadOnly()` de #908, relecture avant `locked`, test qui échoue si la puce reste inscriptible. Sinon, documenter le non-verrouillage dans la PR rebasée.
4. **Appel continu**, PR nouvelle. Reader mode qui ne rend pas la main entre deux élèves, effectif initial, décompte des restants, doublon, carte révoquée, élève hors classe, réseau coupé. Réutiliser l'upsert de présence et le compteur d'appel existants. Le badge finance reste informatif et soumis au droit finance.
5. **Correction NFC-02-06**, dans la PR d'appel si le diff reste petit : le comptable consulte le badge sans droit de pointer ; l'enseignant sans droit finance ne reçoit pas les montants. Aucune exclusion automatique.
6. **Recette NTAG216** sur l'APK issu du HEAD rebasé. Ce n'est pas une PR de fonctionnalité. NTAG213 ensuite, même binaire, même NDEF.
7. Fermer #891 et #908 à #916 **sans merge** une fois la tête rebasée acceptée. #910 se ferme aussi : son contrat utile est repris ici et dans #917.

---

## 8. Plan de tests

| Cas | État au 13 octobre 2026 | Preuve pour un futur PASS |
| --- | --- | --- |
| CI #917 : PostgreSQL 16 isolé, contrats Android, unitaires APK, PR Gates | **PASS** de workflow sur `5f2aa252` | Rejouer après rebase sur `e68807cc`. Non rejoué dans cette VM |
| CI #916 : APK preview | **FAIL** | Ne pas utiliser ce HEAD |
| CI #891, #908, #909, #910, #912, #913, #914, #915 | **PASS** de workflow sur leur HEAD d'alors | #891 est périmé de 15 commits. Les autres sont inclus dans #917 |
| Gate minSdk compilé `[24, 30]`, target ≥ 31 | **PASS** statique sur l'APK de #917 | Lire le badging de l'APK rebasé. Ce n'est pas une puce |
| NTAG216 vierge : écriture, relecture, puis seulement `active` | **NOT RUN** | Téléphone Android + carte du stock |
| NTAG216 déjà affectée, révoquée, remplacée | **NOT RUN** | Même téléphone |
| NTAG213, même binaire, NDEF ≤ 144 octets | **NOT RUN** | Après la série NTAG216, stock non confirmé |
| 1, 5, 10, 30 cartes, doublons, invalides, coupure réseau | **NOT RUN** | La série de #915 programme ; elle ne pointe pas |
| Appel continu sans réarmement, décompte des restants | **NOT RUN** | Fonction absente. Le bouton « Réessayer » ne la simule pas |
| Établissement A contre B, UID déjà pris | **NOT RUN** | L'index unique est dans la migration ; pas de jeu croisé ici |
| Enseignant sans finance, comptable sans présence, administrateur | **NOT RUN** | Le code client sépare les boutons. Le trou serveur NFC-02-06 reste |
| Token absent des logs et de l'audit | **PASS** de tests statiques cités par la CI #917 (`studentCardNfcSecurity`, logger) | Confirmer sur le HEAD rebasé qu'aucun body de réponse d'erreur n'écho le `cardToken` |
| QR inchangé pour une carte sans UID NFC | **NOT RUN** dans cette revue | Les tests PG de #917 modifient le refus `pending`. Les rejouer après rebase |
| iPhone | **NOT RUN** | Hors première recette. #917 désactive la lecture hors Android |
| Bus | **NOT RUN** | Hors périmètre. Aucun test à inventer |

Un mock, un test de parseur `apksigner`, ou un APK preview vert ne deviennent pas un PASS matériel.

---

## 9. Risques bloquants

1. Merger plusieurs PR de la pile, ou merger #891 avec #917.
2. Prendre #916 comme candidat : son APK preview est rouge.
3. Déclarer #917 intégrable sans rebase : il ne contient pas #918, et `.gitleaksignore` diverge par le commentaire.
4. Croire l'appel continu livré. Il ne l'est pas.
5. Croire la puce verrouillée. #917 n'envoie pas l'ordre de verrouillage.
6. Traiter la CI PostgreSQL ou l'APK preview comme une recette NTAG216.
7. Élargir le NDEF au-delà du token canonique pour utiliser les 888 octets.
8. Ouvrir le badge finance à tout enseignant, ou le scan présence à tout comptable, pour « faire passer » le test de rôle.
9. Créer un module bus dans la foulée.

---

## 10. Nombre de PR pour finir le chantier

Cette PR documentaire ne compte pas.

| Lot | PR | Nature |
| --- | --- | --- |
| Rebase de #917 | 1 | Code existant, pas une réécriture |
| Découpage de ce rebase, seulement s'il est refusé en un lot | 3 à la place de la ligne précédente | Backend, Android unitaire + lecteur, série + gate APK |
| Appel continu et trou de droits finance | 1 | Code nouveau, réutilise présence et badge |
| Verrouillage physique | 0 ou 1 | Uniquement sur ordre. Extrait de #908 |
| Bus | 0 | Hors périmètre |
| Recette NTAG216 | 0 PR | Campagne sur l'APK du HEAD rebasé |

**Minimum : 2 PR de produit** (rebase #917, puis appel continu). **4 PR de produit** si le rebase est découpé et si le verrouillage est exigé. Aucune n'est autorisée par ce document.

---

## Annexe A — Fichiers mesurés contre `develop`

Comparaison GitHub `e68807cc2d72bb946c9e656b29456ec6cba97eb9...HEAD`. `A` ajouté, `M` modifié. Aucune suppression de fichier sur ces dix diffs. #908 à #916 sont des sous-ensembles de chemins de #917. #891 aussi : aucun chemin qui lui soit propre. Le seul chemin ajouté par les 13 commits de #917 au-dessus de #916 est `.gitleaksignore`.

### #891 — 24 fichiers

- `M` `Mobile/app.config.js` (+0/−1)
- `M` `Mobile/app.json` (+7/−0)
- `M` `Mobile/package-lock.json` (+17/−0)
- `M` `Mobile/package.json` (+9/−1)
- `M` `Mobile/plugins/withSomafrikAndroidSecurity.js` (+15/−1)
- `M` `Mobile/scripts/verify-mobile-security.js` (+10/−4)
- `M` `Mobile/scripts/verify-native-prebuild.js` (+112/−5)
- `M` `Mobile/scripts/verify-student-card-qr.js` (+42/−5)
- `A` `Mobile/src/components/StudentCardNfcScannerModal.tsx` (+410/−0)
- `M` `Mobile/src/lib/mobileUsability.ts` (+1/−0)
- `A` `Mobile/src/lib/studentCardNfc.test.ts` (+557/−0)
- `A` `Mobile/src/lib/studentCardNfc.ts` (+297/−0)
- `A` `Mobile/src/lib/studentCardNfcNative.ts` (+59/−0)
- `M` `Mobile/src/lib/studentCardScan.test.ts` (+1/−0)
- `M` `Mobile/src/lib/studentCardScan.ts` (+32/−0)
- `M` `Mobile/src/screens/TeacherAttendanceScreen.tsx` (+72/−1)
- `M` `Mobile/src/services/studentCardScanApi.ts` (+1/−0)
- `M` `backend/lib/schoolSettings.studentCard.test.js` (+20/−2)
- `M` `backend/lib/studentAccessCards.scan.http.pg.test.js` (+2/−0)
- `M` `backend/lib/studentCardCapabilities.js` (+2/−0)
- `M` `backend/lib/studentCardCapabilities.test.js` (+23/−2)
- `M` `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` (+5/−4)
- `M` `docs/mobile/RELEASE-READINESS.md` (+5/−5)
- `M` `scripts/verify-school-setup-lot4-red.ts` (+29/−1)

### #908 — 40 fichiers

- `A` `.github/workflows/nfc-encoding-preprod.yml` (+102/−0)
- `M` `Mobile/app.config.js` (+0/−1)
- `M` `Mobile/app.json` (+5/−3)
- `M` `Mobile/package-lock.json` (+18/−1)
- `M` `Mobile/package.json` (+4/−2)
- `M` `Mobile/plugins/withSomafrikAndroidSecurity.js` (+15/−1)
- `A` `Mobile/plugins/withSomafrikNfcAndroid.js` (+3/−0)
- `M` `Mobile/scripts/verify-mobile-security.js` (+4/−3)
- `M` `Mobile/scripts/verify-native-prebuild.js` (+3/−1)
- `A` `Mobile/scripts/verify-student-card-nfc-apk.py` (+98/−0)
- `A` `Mobile/scripts/verify-student-card-nfc-apk_test.py` (+51/−0)
- `M` `Mobile/scripts/verify-student-card-qr.js` (+4/−2)
- `A` `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` (+166/−0)
- `A` `Mobile/src/lib/studentCardEnrollmentAccess.ts` (+22/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoderNative.ts` (+86/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.test.ts` (+116/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.ts` (+112/−0)
- `M` `Mobile/src/lib/studentCardScan.test.ts` (+2/−0)
- `M` `Mobile/src/screens/StudentDetailScreen.tsx` (+8/−0)
- `A` `Mobile/src/services/studentCardEnrollmentApi.ts` (+21/−0)
- `A` `backend/db/migrations/20261012_student_cards_nfc_encoding.sql` (+24/−0)
- `M` `backend/db/schema.sql` (+25/−0)
- `M` `backend/db/studentAccessCardsPgStore.js` (+31/−3)
- `M` `backend/db/studentAccessCardsSchema.js` (+1/−0)
- `A` `backend/db/studentCardsNfcSchema.js` (+30/−0)
- `M` `backend/lib/platformPersonalDataGuard.js` (+2/−0)
- `M` `backend/lib/schoolSettings.studentCard.test.js` (+4/−2)
- `M` `backend/lib/studentAccessCards.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCardsManagement.js` (+15/−2)
- `A` `backend/lib/studentCardsNfcEncoding.js` (+86/−0)
- `A` `backend/lib/studentCardsNfcEncoding.sql.test.js` (+67/−0)
- `A` `backend/lib/studentCardsNfcEncoding.test.js` (+98/−0)
- `M` `backend/scripts/verify-student-access-cards.js` (+3/−1)
- `M` `backend/server.js` (+19/−1)
- `M` `backend/services/rbacService.js` (+2/−0)
- `A` `docs/mobile/NFC-ENC-01-REVIEW.md` (+45/−0)
- `A` `docs/mobile/NFC-ENCODING-SMOKE.md` (+77/−0)
- `M` `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` (+4/−0)
- `M` `scripts/verify-android-release-readiness.js` (+7/−2)
- `M` `scripts/verify-school-setup-lot4-red.ts` (+14/−0)

### #909 — 56 fichiers

- `A` `.github/workflows/nfc-encoding-preprod.yml` (+102/−0)
- `M` `Mobile/app.config.js` (+0/−1)
- `M` `Mobile/app.json` (+5/−3)
- `M` `Mobile/package-lock.json` (+19/−1)
- `M` `Mobile/package.json` (+13/−3)
- `M` `Mobile/plugins/withSomafrikAndroidSecurity.js` (+15/−1)
- `A` `Mobile/plugins/withSomafrikNfcAndroid.js` (+3/−0)
- `M` `Mobile/scripts/verify-mobile-security.js` (+4/−3)
- `M` `Mobile/scripts/verify-native-prebuild.js` (+87/−3)
- `A` `Mobile/scripts/verify-student-card-nfc-apk.py` (+98/−0)
- `A` `Mobile/scripts/verify-student-card-nfc-apk_test.py` (+51/−0)
- `M` `Mobile/scripts/verify-student-card-qr.js` (+39/−6)
- `A` `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` (+166/−0)
- `A` `Mobile/src/components/StudentCardNfcScannerModal.tsx` (+414/−0)
- `M` `Mobile/src/lib/mobileUsability.ts` (+1/−0)
- `A` `Mobile/src/lib/nfcSession.test.ts` (+209/−0)
- `A` `Mobile/src/lib/nfcSession.ts` (+97/−0)
- `A` `Mobile/src/lib/nfcSessionNative.ts` (+25/−0)
- `A` `Mobile/src/lib/studentCardEnrollmentAccess.ts` (+22/−0)
- `A` `Mobile/src/lib/studentCardNfc.test.ts` (+557/−0)
- `A` `Mobile/src/lib/studentCardNfc.ts` (+300/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoderNative.ts` (+88/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.test.ts` (+116/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.ts` (+112/−0)
- `A` `Mobile/src/lib/studentCardNfcNative.ts` (+50/−0)
- `M` `Mobile/src/lib/studentCardScan.test.ts` (+3/−0)
- `M` `Mobile/src/lib/studentCardScan.ts` (+32/−0)
- `M` `Mobile/src/screens/StudentDetailScreen.tsx` (+8/−0)
- `M` `Mobile/src/screens/TeacherAttendanceScreen.tsx` (+72/−1)
- `A` `Mobile/src/services/studentCardEnrollmentApi.ts` (+21/−0)
- `M` `Mobile/src/services/studentCardScanApi.ts` (+1/−0)
- `A` `backend/db/migrations/20261012_student_cards_nfc_encoding.sql` (+24/−0)
- `M` `backend/db/schema.sql` (+25/−0)
- `M` `backend/db/studentAccessCardsPgStore.js` (+31/−3)
- `M` `backend/db/studentAccessCardsSchema.js` (+1/−0)
- `A` `backend/db/studentCardsNfcSchema.js` (+30/−0)
- `M` `backend/lib/platformPersonalDataGuard.js` (+2/−0)
- `M` `backend/lib/schoolSettings.studentCard.test.js` (+23/−2)
- `M` `backend/lib/studentAccessCards.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.scan.http.pg.test.js` (+2/−0)
- `M` `backend/lib/studentAccessCardsManagement.js` (+15/−2)
- `M` `backend/lib/studentCardCapabilities.js` (+2/−0)
- `M` `backend/lib/studentCardCapabilities.test.js` (+23/−2)
- `A` `backend/lib/studentCardsNfcEncoding.js` (+86/−0)
- `A` `backend/lib/studentCardsNfcEncoding.sql.test.js` (+67/−0)
- `A` `backend/lib/studentCardsNfcEncoding.test.js` (+98/−0)
- `M` `backend/scripts/verify-student-access-cards.js` (+3/−1)
- `M` `backend/server.js` (+19/−1)
- `M` `backend/services/rbacService.js` (+2/−0)
- `A` `docs/mobile/NFC-ENC-01-REVIEW.md` (+45/−0)
- `A` `docs/mobile/NFC-ENCODING-SMOKE.md` (+77/−0)
- `A` `docs/mobile/NFC-RECON-02-REVIEW.md` (+63/−0)
- `M` `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` (+9/−4)
- `M` `docs/mobile/RELEASE-READINESS.md` (+5/−5)
- `M` `scripts/verify-android-release-readiness.js` (+7/−2)
- `M` `scripts/verify-school-setup-lot4-red.ts` (+50/−1)

### #910 — 1 fichiers

- `A` `docs/audits/NFC-PROG-01-audit-et-contrat.md` (+639/−0)

### #912 — 64 fichiers

- `A` `.github/workflows/nfc-encoding-preprod.yml` (+113/−0)
- `M` `Mobile/app.config.js` (+0/−1)
- `M` `Mobile/app.json` (+5/−3)
- `M` `Mobile/package-lock.json` (+19/−1)
- `M` `Mobile/package.json` (+13/−3)
- `M` `Mobile/plugins/withSomafrikAndroidSecurity.js` (+15/−1)
- `A` `Mobile/plugins/withSomafrikNfcAndroid.js` (+3/−0)
- `M` `Mobile/scripts/verify-mobile-security.js` (+4/−3)
- `M` `Mobile/scripts/verify-native-prebuild.js` (+87/−3)
- `A` `Mobile/scripts/verify-student-card-nfc-apk.py` (+98/−0)
- `A` `Mobile/scripts/verify-student-card-nfc-apk_test.py` (+51/−0)
- `M` `Mobile/scripts/verify-student-card-qr.js` (+39/−6)
- `A` `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` (+166/−0)
- `A` `Mobile/src/components/StudentCardNfcScannerModal.tsx` (+414/−0)
- `M` `Mobile/src/lib/mobileUsability.ts` (+1/−0)
- `A` `Mobile/src/lib/nfcSession.test.ts` (+209/−0)
- `A` `Mobile/src/lib/nfcSession.ts` (+97/−0)
- `A` `Mobile/src/lib/nfcSessionNative.ts` (+25/−0)
- `A` `Mobile/src/lib/studentCardEnrollmentAccess.ts` (+22/−0)
- `A` `Mobile/src/lib/studentCardNfc.test.ts` (+557/−0)
- `A` `Mobile/src/lib/studentCardNfc.ts` (+300/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoderNative.ts` (+88/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.test.ts` (+116/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.ts` (+112/−0)
- `A` `Mobile/src/lib/studentCardNfcNative.ts` (+50/−0)
- `M` `Mobile/src/lib/studentCardScan.test.ts` (+3/−0)
- `M` `Mobile/src/lib/studentCardScan.ts` (+32/−0)
- `M` `Mobile/src/screens/StudentDetailScreen.tsx` (+8/−0)
- `M` `Mobile/src/screens/TeacherAttendanceScreen.tsx` (+72/−1)
- `A` `Mobile/src/services/studentCardEnrollmentApi.ts` (+21/−0)
- `M` `Mobile/src/services/studentCardScanApi.ts` (+1/−0)
- `A` `backend/db/migrations/20261012_student_cards_nfc_encoding.sql` (+24/−0)
- `A` `backend/db/migrations/20261013_student_cards_nfc_reservations.sql` (+45/−0)
- `M` `backend/db/schema.sql` (+71/−0)
- `M` `backend/db/studentAccessCardsPgStore.js` (+76/−4)
- `M` `backend/db/studentAccessCardsSchema.js` (+2/−0)
- `A` `backend/db/studentCardsNfcReservationsSchema.js` (+9/−0)
- `A` `backend/db/studentCardsNfcSchema.js` (+30/−0)
- `M` `backend/lib/platformPersonalDataGuard.js` (+2/−0)
- `M` `backend/lib/schoolSettings.studentCard.test.js` (+23/−2)
- `M` `backend/lib/studentAccessCards.http.pg.test.js` (+45/−1)
- `M` `backend/lib/studentAccessCards.lifecycle.pg.test.js` (+2/−2)
- `M` `backend/lib/studentAccessCards.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.resolve.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.scan.http.pg.test.js` (+2/−0)
- `M` `backend/lib/studentAccessCardsManagement.js` (+25/−2)
- `M` `backend/lib/studentCardCapabilities.js` (+2/−0)
- `M` `backend/lib/studentCardCapabilities.test.js` (+23/−2)
- `A` `backend/lib/studentCardsNfcEncoding.js` (+37/−0)
- `A` `backend/lib/studentCardsNfcEncoding.sql.test.js` (+68/−0)
- `A` `backend/lib/studentCardsNfcEncoding.test.js` (+49/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.js` (+195/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.pg.test.js` (+259/−0)
- `M` `backend/scripts/verify-student-access-cards.js` (+3/−1)
- `M` `backend/server.js` (+23/−1)
- `M` `backend/services/rbacService.js` (+2/−0)
- `A` `docs/mobile/NFC-ENC-01-REVIEW.md` (+45/−0)
- `A` `docs/mobile/NFC-ENCODING-SMOKE.md` (+77/−0)
- `A` `docs/mobile/NFC-PROG-02-REVIEW.md` (+216/−0)
- `A` `docs/mobile/NFC-RECON-02-REVIEW.md` (+63/−0)
- `M` `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` (+9/−4)
- `M` `docs/mobile/RELEASE-READINESS.md` (+5/−5)
- `M` `scripts/verify-android-release-readiness.js` (+7/−2)
- `M` `scripts/verify-school-setup-lot4-red.ts` (+57/−1)

### #913 — 65 fichiers

- `A` `.github/workflows/nfc-encoding-preprod.yml` (+133/−0)
- `M` `Mobile/app.config.js` (+0/−1)
- `M` `Mobile/app.json` (+5/−3)
- `M` `Mobile/package-lock.json` (+19/−1)
- `M` `Mobile/package.json` (+13/−3)
- `M` `Mobile/plugins/withSomafrikAndroidSecurity.js` (+15/−1)
- `A` `Mobile/plugins/withSomafrikNfcAndroid.js` (+3/−0)
- `M` `Mobile/scripts/verify-mobile-security.js` (+4/−3)
- `M` `Mobile/scripts/verify-native-prebuild.js` (+87/−3)
- `A` `Mobile/scripts/verify-student-card-nfc-apk.py` (+98/−0)
- `A` `Mobile/scripts/verify-student-card-nfc-apk_test.py` (+51/−0)
- `M` `Mobile/scripts/verify-student-card-qr.js` (+39/−6)
- `A` `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` (+145/−0)
- `A` `Mobile/src/components/StudentCardNfcScannerModal.tsx` (+414/−0)
- `M` `Mobile/src/lib/mobileUsability.ts` (+1/−0)
- `A` `Mobile/src/lib/nfcSession.test.ts` (+254/−0)
- `A` `Mobile/src/lib/nfcSession.ts` (+97/−0)
- `A` `Mobile/src/lib/nfcSessionNative.ts` (+25/−0)
- `A` `Mobile/src/lib/studentCardEnrollmentAccess.ts` (+22/−0)
- `A` `Mobile/src/lib/studentCardNfc.test.ts` (+557/−0)
- `A` `Mobile/src/lib/studentCardNfc.ts` (+300/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoderNative.ts` (+80/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.test.ts` (+256/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.ts` (+255/−0)
- `A` `Mobile/src/lib/studentCardNfcNative.ts` (+50/−0)
- `M` `Mobile/src/lib/studentCardScan.test.ts` (+3/−0)
- `M` `Mobile/src/lib/studentCardScan.ts` (+32/−0)
- `M` `Mobile/src/screens/StudentDetailScreen.tsx` (+8/−0)
- `M` `Mobile/src/screens/TeacherAttendanceScreen.tsx` (+72/−1)
- `A` `Mobile/src/services/studentCardEnrollmentApi.ts` (+4/−0)
- `M` `Mobile/src/services/studentCardScanApi.ts` (+1/−0)
- `A` `backend/db/migrations/20261012_student_cards_nfc_encoding.sql` (+24/−0)
- `A` `backend/db/migrations/20261013_student_cards_nfc_reservations.sql` (+45/−0)
- `M` `backend/db/schema.sql` (+71/−0)
- `M` `backend/db/studentAccessCardsPgStore.js` (+76/−4)
- `M` `backend/db/studentAccessCardsSchema.js` (+2/−0)
- `A` `backend/db/studentCardsNfcReservationsSchema.js` (+9/−0)
- `A` `backend/db/studentCardsNfcSchema.js` (+30/−0)
- `M` `backend/lib/platformPersonalDataGuard.js` (+2/−0)
- `M` `backend/lib/schoolSettings.studentCard.test.js` (+23/−2)
- `M` `backend/lib/studentAccessCards.http.pg.test.js` (+45/−1)
- `M` `backend/lib/studentAccessCards.lifecycle.pg.test.js` (+2/−2)
- `M` `backend/lib/studentAccessCards.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.resolve.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.scan.http.pg.test.js` (+2/−0)
- `M` `backend/lib/studentAccessCardsManagement.js` (+25/−2)
- `M` `backend/lib/studentCardCapabilities.js` (+2/−0)
- `M` `backend/lib/studentCardCapabilities.test.js` (+23/−2)
- `A` `backend/lib/studentCardsNfcEncoding.js` (+37/−0)
- `A` `backend/lib/studentCardsNfcEncoding.sql.test.js` (+68/−0)
- `A` `backend/lib/studentCardsNfcEncoding.test.js` (+49/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.js` (+195/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.pg.test.js` (+259/−0)
- `M` `backend/scripts/verify-student-access-cards.js` (+3/−1)
- `M` `backend/server.js` (+23/−1)
- `M` `backend/services/rbacService.js` (+2/−0)
- `A` `docs/mobile/NFC-ENC-01-REVIEW.md` (+45/−0)
- `A` `docs/mobile/NFC-ENCODING-SMOKE.md` (+77/−0)
- `A` `docs/mobile/NFC-PROG-02-REVIEW.md` (+216/−0)
- `A` `docs/mobile/NFC-PROG-03-REVIEW.md` (+207/−0)
- `A` `docs/mobile/NFC-RECON-02-REVIEW.md` (+63/−0)
- `M` `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` (+9/−4)
- `M` `docs/mobile/RELEASE-READINESS.md` (+5/−5)
- `M` `scripts/verify-android-release-readiness.js` (+7/−2)
- `M` `scripts/verify-school-setup-lot4-red.ts` (+59/−1)

### #914 — 66 fichiers

- `A` `.github/workflows/nfc-encoding-preprod.yml` (+133/−0)
- `M` `Mobile/app.config.js` (+0/−1)
- `M` `Mobile/app.json` (+5/−3)
- `M` `Mobile/package-lock.json` (+19/−1)
- `M` `Mobile/package.json` (+13/−3)
- `M` `Mobile/plugins/withSomafrikAndroidSecurity.js` (+15/−1)
- `A` `Mobile/plugins/withSomafrikNfcAndroid.js` (+3/−0)
- `M` `Mobile/scripts/verify-mobile-security.js` (+4/−3)
- `M` `Mobile/scripts/verify-native-prebuild.js` (+87/−3)
- `A` `Mobile/scripts/verify-student-card-nfc-apk.py` (+98/−0)
- `A` `Mobile/scripts/verify-student-card-nfc-apk_test.py` (+51/−0)
- `M` `Mobile/scripts/verify-student-card-qr.js` (+39/−6)
- `A` `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` (+145/−0)
- `A` `Mobile/src/components/StudentCardNfcScannerModal.tsx` (+414/−0)
- `M` `Mobile/src/lib/mobileUsability.ts` (+1/−0)
- `A` `Mobile/src/lib/nfcSession.test.ts` (+254/−0)
- `A` `Mobile/src/lib/nfcSession.ts` (+97/−0)
- `A` `Mobile/src/lib/nfcSessionNative.ts` (+25/−0)
- `A` `Mobile/src/lib/studentCardEnrollmentAccess.ts` (+22/−0)
- `A` `Mobile/src/lib/studentCardNfc.test.ts` (+557/−0)
- `A` `Mobile/src/lib/studentCardNfc.ts` (+300/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoderNative.ts` (+80/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.test.ts` (+256/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.ts` (+255/−0)
- `A` `Mobile/src/lib/studentCardNfcNative.ts` (+50/−0)
- `M` `Mobile/src/lib/studentCardScan.test.ts` (+3/−0)
- `M` `Mobile/src/lib/studentCardScan.ts` (+32/−0)
- `M` `Mobile/src/screens/StudentDetailScreen.tsx` (+8/−0)
- `M` `Mobile/src/screens/TeacherAttendanceScreen.tsx` (+72/−1)
- `A` `Mobile/src/services/studentCardEnrollmentApi.ts` (+4/−0)
- `M` `Mobile/src/services/studentCardScanApi.ts` (+1/−0)
- `A` `backend/db/migrations/20261012_student_cards_nfc_encoding.sql` (+24/−0)
- `A` `backend/db/migrations/20261013_student_cards_nfc_reservations.sql` (+45/−0)
- `M` `backend/db/schema.sql` (+71/−0)
- `M` `backend/db/studentAccessCardsPgStore.js` (+76/−4)
- `M` `backend/db/studentAccessCardsSchema.js` (+2/−0)
- `A` `backend/db/studentCardsNfcReservationsSchema.js` (+9/−0)
- `A` `backend/db/studentCardsNfcSchema.js` (+30/−0)
- `M` `backend/lib/platformPersonalDataGuard.js` (+2/−0)
- `M` `backend/lib/schoolSettings.studentCard.test.js` (+23/−2)
- `M` `backend/lib/studentAccessCards.http.pg.test.js` (+69/−1)
- `M` `backend/lib/studentAccessCards.lifecycle.pg.test.js` (+2/−2)
- `M` `backend/lib/studentAccessCards.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.resolve.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.scan.http.pg.test.js` (+2/−0)
- `M` `backend/lib/studentAccessCardsManagement.js` (+25/−2)
- `M` `backend/lib/studentCardCapabilities.js` (+2/−0)
- `M` `backend/lib/studentCardCapabilities.test.js` (+23/−2)
- `A` `backend/lib/studentCardsNfcEncoding.js` (+37/−0)
- `A` `backend/lib/studentCardsNfcEncoding.sql.test.js` (+68/−0)
- `A` `backend/lib/studentCardsNfcEncoding.test.js` (+49/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.js` (+208/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.pg.test.js` (+336/−0)
- `M` `backend/scripts/verify-student-access-cards.js` (+3/−1)
- `M` `backend/server.js` (+23/−1)
- `M` `backend/services/rbacService.js` (+2/−0)
- `A` `docs/mobile/NFC-ENC-01-REVIEW.md` (+45/−0)
- `A` `docs/mobile/NFC-ENCODING-SMOKE.md` (+77/−0)
- `A` `docs/mobile/NFC-PROG-02-REVIEW.md` (+216/−0)
- `A` `docs/mobile/NFC-PROG-03-REVIEW.md` (+207/−0)
- `A` `docs/mobile/NFC-PROG-03-UUID-REVIEW.md` (+124/−0)
- `A` `docs/mobile/NFC-RECON-02-REVIEW.md` (+63/−0)
- `M` `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` (+9/−4)
- `M` `docs/mobile/RELEASE-READINESS.md` (+5/−5)
- `M` `scripts/verify-android-release-readiness.js` (+7/−2)
- `M` `scripts/verify-school-setup-lot4-red.ts` (+61/−1)

### #915 — 73 fichiers

- `A` `.github/workflows/nfc-encoding-preprod.yml` (+134/−0)
- `M` `Mobile/app.config.js` (+0/−1)
- `M` `Mobile/app.json` (+5/−3)
- `M` `Mobile/package-lock.json` (+19/−1)
- `M` `Mobile/package.json` (+14/−3)
- `M` `Mobile/plugins/withSomafrikAndroidSecurity.js` (+15/−1)
- `A` `Mobile/plugins/withSomafrikNfcAndroid.js` (+3/−0)
- `M` `Mobile/scripts/verify-mobile-security.js` (+4/−3)
- `M` `Mobile/scripts/verify-native-prebuild.js` (+87/−3)
- `A` `Mobile/scripts/verify-student-card-nfc-apk.py` (+98/−0)
- `A` `Mobile/scripts/verify-student-card-nfc-apk_test.py` (+51/−0)
- `M` `Mobile/scripts/verify-student-card-qr.js` (+39/−6)
- `A` `Mobile/src/components/StudentCardNfcBatchControl.tsx` (+509/−0)
- `A` `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` (+145/−0)
- `A` `Mobile/src/components/StudentCardNfcScannerModal.tsx` (+414/−0)
- `M` `Mobile/src/lib/mobileUsability.ts` (+1/−0)
- `A` `Mobile/src/lib/nfcSession.test.ts` (+254/−0)
- `A` `Mobile/src/lib/nfcSession.ts` (+97/−0)
- `A` `Mobile/src/lib/nfcSessionNative.ts` (+25/−0)
- `A` `Mobile/src/lib/studentCardEnrollmentAccess.ts` (+22/−0)
- `A` `Mobile/src/lib/studentCardNfc.test.ts` (+557/−0)
- `A` `Mobile/src/lib/studentCardNfc.ts` (+300/−0)
- `A` `Mobile/src/lib/studentCardNfcBatch.test.ts` (+878/−0)
- `A` `Mobile/src/lib/studentCardNfcBatch.ts` (+618/−0)
- `A` `Mobile/src/lib/studentCardNfcBatchRoster.ts` (+87/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoderNative.ts` (+80/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.test.ts` (+256/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.ts` (+261/−0)
- `A` `Mobile/src/lib/studentCardNfcNative.ts` (+50/−0)
- `M` `Mobile/src/lib/studentCardScan.test.ts` (+3/−0)
- `M` `Mobile/src/lib/studentCardScan.ts` (+32/−0)
- `M` `Mobile/src/screens/ClassesScreen.tsx` (+2/−0)
- `M` `Mobile/src/screens/StudentDetailScreen.tsx` (+8/−0)
- `M` `Mobile/src/screens/TeacherAttendanceScreen.tsx` (+72/−1)
- `A` `Mobile/src/services/studentCardEnrollmentApi.ts` (+4/−0)
- `A` `Mobile/src/services/studentCardNfcBatchApi.ts` (+10/−0)
- `M` `Mobile/src/services/studentCardScanApi.ts` (+1/−0)
- `A` `backend/db/migrations/20261012_student_cards_nfc_encoding.sql` (+24/−0)
- `A` `backend/db/migrations/20261013_student_cards_nfc_reservations.sql` (+45/−0)
- `M` `backend/db/schema.sql` (+71/−0)
- `M` `backend/db/studentAccessCardsPgStore.js` (+76/−4)
- `M` `backend/db/studentAccessCardsSchema.js` (+2/−0)
- `A` `backend/db/studentCardsNfcReservationsSchema.js` (+9/−0)
- `A` `backend/db/studentCardsNfcSchema.js` (+30/−0)
- `M` `backend/lib/platformPersonalDataGuard.js` (+2/−0)
- `M` `backend/lib/schoolSettings.studentCard.test.js` (+23/−2)
- `M` `backend/lib/studentAccessCards.http.pg.test.js` (+69/−1)
- `M` `backend/lib/studentAccessCards.lifecycle.pg.test.js` (+2/−2)
- `M` `backend/lib/studentAccessCards.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.resolve.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.scan.http.pg.test.js` (+2/−0)
- `M` `backend/lib/studentAccessCardsManagement.js` (+25/−2)
- `M` `backend/lib/studentCardCapabilities.js` (+2/−0)
- `M` `backend/lib/studentCardCapabilities.test.js` (+23/−2)
- `A` `backend/lib/studentCardsNfcEncoding.js` (+37/−0)
- `A` `backend/lib/studentCardsNfcEncoding.sql.test.js` (+68/−0)
- `A` `backend/lib/studentCardsNfcEncoding.test.js` (+49/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.js` (+208/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.pg.test.js` (+336/−0)
- `M` `backend/scripts/verify-student-access-cards.js` (+3/−1)
- `M` `backend/server.js` (+23/−1)
- `M` `backend/services/rbacService.js` (+2/−0)
- `A` `docs/mobile/NFC-ENC-01-REVIEW.md` (+45/−0)
- `A` `docs/mobile/NFC-ENCODING-SMOKE.md` (+77/−0)
- `A` `docs/mobile/NFC-PROG-02-REVIEW.md` (+216/−0)
- `A` `docs/mobile/NFC-PROG-03-REVIEW.md` (+207/−0)
- `A` `docs/mobile/NFC-PROG-03-UUID-REVIEW.md` (+124/−0)
- `A` `docs/mobile/NFC-PROG-04-REVIEW.md` (+213/−0)
- `A` `docs/mobile/NFC-RECON-02-REVIEW.md` (+63/−0)
- `M` `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` (+9/−4)
- `M` `docs/mobile/RELEASE-READINESS.md` (+5/−5)
- `M` `scripts/verify-android-release-readiness.js` (+7/−2)
- `M` `scripts/verify-school-setup-lot4-red.ts` (+65/−1)

### #916 — 79 fichiers

- `A` `.github/workflows/nfc-encoding-preprod.yml` (+144/−0)
- `M` `Mobile/app.config.js` (+0/−1)
- `M` `Mobile/app.json` (+5/−3)
- `M` `Mobile/package-lock.json` (+19/−1)
- `M` `Mobile/package.json` (+16/−3)
- `M` `Mobile/plugins/withSomafrikAndroidSecurity.js` (+15/−1)
- `A` `Mobile/plugins/withSomafrikNfcAndroid.js` (+3/−0)
- `M` `Mobile/scripts/verify-mobile-security.js` (+4/−3)
- `M` `Mobile/scripts/verify-native-prebuild.js` (+87/−3)
- `A` `Mobile/scripts/verify-student-card-nfc-apk.py` (+124/−0)
- `A` `Mobile/scripts/verify-student-card-nfc-apk_test.py` (+66/−0)
- `M` `Mobile/scripts/verify-student-card-qr.js` (+39/−6)
- `A` `Mobile/src/components/StudentCardNfcBatchControl.tsx` (+509/−0)
- `A` `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` (+145/−0)
- `A` `Mobile/src/components/StudentCardNfcScannerModal.tsx` (+414/−0)
- `M` `Mobile/src/lib/mobileUsability.ts` (+1/−0)
- `A` `Mobile/src/lib/nfcSession.test.ts` (+254/−0)
- `A` `Mobile/src/lib/nfcSession.ts` (+97/−0)
- `A` `Mobile/src/lib/nfcSessionNative.ts` (+25/−0)
- `A` `Mobile/src/lib/studentCardEnrollmentAccess.ts` (+22/−0)
- `A` `Mobile/src/lib/studentCardNfc.test.ts` (+557/−0)
- `A` `Mobile/src/lib/studentCardNfc.ts` (+300/−0)
- `A` `Mobile/src/lib/studentCardNfcBatch.test.ts` (+878/−0)
- `A` `Mobile/src/lib/studentCardNfcBatch.ts` (+618/−0)
- `A` `Mobile/src/lib/studentCardNfcBatchRoster.ts` (+87/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoderNative.ts` (+80/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.test.ts` (+256/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.ts` (+261/−0)
- `A` `Mobile/src/lib/studentCardNfcIntegration.pg.test.ts` (+903/−0)
- `A` `Mobile/src/lib/studentCardNfcNative.ts` (+50/−0)
- `A` `Mobile/src/lib/studentCardNfcSecurity.test.ts` (+117/−0)
- `M` `Mobile/src/lib/studentCardScan.test.ts` (+3/−0)
- `M` `Mobile/src/lib/studentCardScan.ts` (+32/−0)
- `M` `Mobile/src/screens/ClassesScreen.tsx` (+2/−0)
- `M` `Mobile/src/screens/StudentDetailScreen.tsx` (+8/−0)
- `M` `Mobile/src/screens/TeacherAttendanceScreen.tsx` (+72/−1)
- `M` `Mobile/src/services/safeLogger.ts` (+14/−5)
- `A` `Mobile/src/services/studentCardEnrollmentApi.ts` (+4/−0)
- `A` `Mobile/src/services/studentCardNfcBatchApi.ts` (+10/−0)
- `M` `Mobile/src/services/studentCardScanApi.ts` (+1/−0)
- `A` `backend/db/migrations/20261012_student_cards_nfc_encoding.sql` (+24/−0)
- `A` `backend/db/migrations/20261013_student_cards_nfc_reservations.sql` (+45/−0)
- `M` `backend/db/schema.sql` (+71/−0)
- `M` `backend/db/studentAccessCardsPgStore.js` (+76/−4)
- `M` `backend/db/studentAccessCardsSchema.js` (+2/−0)
- `A` `backend/db/studentCardsNfcReservationsSchema.js` (+9/−0)
- `A` `backend/db/studentCardsNfcSchema.js` (+30/−0)
- `M` `backend/lib/platformPersonalDataGuard.js` (+2/−0)
- `M` `backend/lib/schoolSettings.studentCard.test.js` (+23/−2)
- `M` `backend/lib/studentAccessCards.http.pg.test.js` (+69/−1)
- `M` `backend/lib/studentAccessCards.lifecycle.pg.test.js` (+2/−2)
- `M` `backend/lib/studentAccessCards.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.resolve.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.scan.http.pg.test.js` (+2/−0)
- `M` `backend/lib/studentAccessCardsManagement.js` (+25/−2)
- `M` `backend/lib/studentCardCapabilities.js` (+2/−0)
- `M` `backend/lib/studentCardCapabilities.test.js` (+23/−2)
- `A` `backend/lib/studentCardsNfcEncoding.js` (+37/−0)
- `A` `backend/lib/studentCardsNfcEncoding.sql.test.js` (+68/−0)
- `A` `backend/lib/studentCardsNfcEncoding.test.js` (+49/−0)
- `A` `backend/lib/studentCardsNfcIntegration.fixture.js` (+240/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.js` (+208/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.pg.test.js` (+336/−0)
- `M` `backend/scripts/verify-student-access-cards.js` (+3/−1)
- `M` `backend/server.js` (+24/−1)
- `M` `backend/services/rbacService.js` (+2/−0)
- `A` `docs/mobile/NFC-ENC-01-REVIEW.md` (+45/−0)
- `A` `docs/mobile/NFC-ENCODING-SMOKE.md` (+77/−0)
- `A` `docs/mobile/NFC-PROG-02-REVIEW.md` (+216/−0)
- `A` `docs/mobile/NFC-PROG-03-REVIEW.md` (+207/−0)
- `A` `docs/mobile/NFC-PROG-03-UUID-REVIEW.md` (+124/−0)
- `A` `docs/mobile/NFC-PROG-04-REVIEW.md` (+213/−0)
- `A` `docs/mobile/NFC-PROG-05-PHYSICAL-RECIPE.md` (+103/−0)
- `A` `docs/mobile/NFC-PROG-05-REVIEW.md` (+246/−0)
- `A` `docs/mobile/NFC-RECON-02-REVIEW.md` (+63/−0)
- `M` `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` (+9/−4)
- `M` `docs/mobile/RELEASE-READINESS.md` (+5/−5)
- `M` `scripts/verify-android-release-readiness.js` (+7/−2)
- `M` `scripts/verify-school-setup-lot4-red.ts` (+71/−1)

### #917 — 80 fichiers

- `A` `.github/workflows/nfc-encoding-preprod.yml` (+165/−0)
- `M` `.gitleaksignore` (+7/−0)
- `M` `Mobile/app.config.js` (+0/−1)
- `M` `Mobile/app.json` (+5/−3)
- `M` `Mobile/package-lock.json` (+19/−1)
- `M` `Mobile/package.json` (+16/−3)
- `M` `Mobile/plugins/withSomafrikAndroidSecurity.js` (+15/−1)
- `A` `Mobile/plugins/withSomafrikNfcAndroid.js` (+3/−0)
- `M` `Mobile/scripts/verify-mobile-security.js` (+4/−3)
- `M` `Mobile/scripts/verify-native-prebuild.js` (+87/−3)
- `A` `Mobile/scripts/verify-student-card-nfc-apk.py` (+269/−0)
- `A` `Mobile/scripts/verify-student-card-nfc-apk_test.py` (+286/−0)
- `M` `Mobile/scripts/verify-student-card-qr.js` (+39/−6)
- `A` `Mobile/src/components/StudentCardNfcBatchControl.tsx` (+509/−0)
- `A` `Mobile/src/components/StudentCardNfcEnrollmentPanel.tsx` (+145/−0)
- `A` `Mobile/src/components/StudentCardNfcScannerModal.tsx` (+414/−0)
- `M` `Mobile/src/lib/mobileUsability.ts` (+1/−0)
- `A` `Mobile/src/lib/nfcSession.test.ts` (+254/−0)
- `A` `Mobile/src/lib/nfcSession.ts` (+97/−0)
- `A` `Mobile/src/lib/nfcSessionNative.ts` (+25/−0)
- `A` `Mobile/src/lib/studentCardEnrollmentAccess.ts` (+22/−0)
- `A` `Mobile/src/lib/studentCardNfc.test.ts` (+557/−0)
- `A` `Mobile/src/lib/studentCardNfc.ts` (+300/−0)
- `A` `Mobile/src/lib/studentCardNfcBatch.test.ts` (+878/−0)
- `A` `Mobile/src/lib/studentCardNfcBatch.ts` (+618/−0)
- `A` `Mobile/src/lib/studentCardNfcBatchRoster.ts` (+87/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoderNative.ts` (+80/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.test.ts` (+256/−0)
- `A` `Mobile/src/lib/studentCardNfcEncoding.ts` (+261/−0)
- `A` `Mobile/src/lib/studentCardNfcIntegration.pg.test.ts` (+903/−0)
- `A` `Mobile/src/lib/studentCardNfcNative.ts` (+50/−0)
- `A` `Mobile/src/lib/studentCardNfcSecurity.test.ts` (+117/−0)
- `M` `Mobile/src/lib/studentCardScan.test.ts` (+3/−0)
- `M` `Mobile/src/lib/studentCardScan.ts` (+32/−0)
- `M` `Mobile/src/screens/ClassesScreen.tsx` (+2/−0)
- `M` `Mobile/src/screens/StudentDetailScreen.tsx` (+8/−0)
- `M` `Mobile/src/screens/TeacherAttendanceScreen.tsx` (+72/−1)
- `M` `Mobile/src/services/safeLogger.ts` (+14/−5)
- `A` `Mobile/src/services/studentCardEnrollmentApi.ts` (+4/−0)
- `A` `Mobile/src/services/studentCardNfcBatchApi.ts` (+10/−0)
- `M` `Mobile/src/services/studentCardScanApi.ts` (+1/−0)
- `A` `backend/db/migrations/20261012_student_cards_nfc_encoding.sql` (+24/−0)
- `A` `backend/db/migrations/20261013_student_cards_nfc_reservations.sql` (+45/−0)
- `M` `backend/db/schema.sql` (+71/−0)
- `M` `backend/db/studentAccessCardsPgStore.js` (+76/−4)
- `M` `backend/db/studentAccessCardsSchema.js` (+2/−0)
- `A` `backend/db/studentCardsNfcReservationsSchema.js` (+9/−0)
- `A` `backend/db/studentCardsNfcSchema.js` (+30/−0)
- `M` `backend/lib/platformPersonalDataGuard.js` (+2/−0)
- `M` `backend/lib/schoolSettings.studentCard.test.js` (+23/−2)
- `M` `backend/lib/studentAccessCards.http.pg.test.js` (+69/−1)
- `M` `backend/lib/studentAccessCards.lifecycle.pg.test.js` (+2/−2)
- `M` `backend/lib/studentAccessCards.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.resolve.pg.test.js` (+1/−1)
- `M` `backend/lib/studentAccessCards.scan.http.pg.test.js` (+2/−0)
- `M` `backend/lib/studentAccessCardsManagement.js` (+25/−2)
- `M` `backend/lib/studentCardCapabilities.js` (+2/−0)
- `M` `backend/lib/studentCardCapabilities.test.js` (+23/−2)
- `A` `backend/lib/studentCardsNfcEncoding.js` (+37/−0)
- `A` `backend/lib/studentCardsNfcEncoding.sql.test.js` (+68/−0)
- `A` `backend/lib/studentCardsNfcEncoding.test.js` (+49/−0)
- `A` `backend/lib/studentCardsNfcIntegration.fixture.js` (+240/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.js` (+208/−0)
- `A` `backend/lib/studentCardsNfcLifecycle.pg.test.js` (+336/−0)
- `M` `backend/scripts/verify-student-access-cards.js` (+3/−1)
- `M` `backend/server.js` (+24/−1)
- `M` `backend/services/rbacService.js` (+2/−0)
- `A` `docs/mobile/NFC-ENC-01-REVIEW.md` (+45/−0)
- `A` `docs/mobile/NFC-ENCODING-SMOKE.md` (+77/−0)
- `A` `docs/mobile/NFC-PROG-02-REVIEW.md` (+216/−0)
- `A` `docs/mobile/NFC-PROG-03-REVIEW.md` (+207/−0)
- `A` `docs/mobile/NFC-PROG-03-UUID-REVIEW.md` (+124/−0)
- `A` `docs/mobile/NFC-PROG-04-REVIEW.md` (+213/−0)
- `A` `docs/mobile/NFC-PROG-05-PHYSICAL-RECIPE.md` (+103/−0)
- `A` `docs/mobile/NFC-PROG-05-REVIEW.md` (+246/−0)
- `A` `docs/mobile/NFC-RECON-02-REVIEW.md` (+63/−0)
- `M` `docs/mobile/PLAY-STORE-DATA-INVENTORY.md` (+9/−4)
- `M` `docs/mobile/RELEASE-READINESS.md` (+5/−5)
- `M` `scripts/verify-android-release-readiness.js` (+7/−2)
- `M` `scripts/verify-school-setup-lot4-red.ts` (+118/−1)

## Critères de clôture

| Critère | Tenue |
| --- | --- |
| Dix PR examinées | Section 1, SHAs et compares GitHub |
| Fonctions mergées conservées | Section 6. Le refus `pending` est un ajout, pas une suppression du QR |
| Conflits et dépendances | Sections 3 et 4 |
| NTAG216 P0, NTAG213 P1, 144 octets | Sections 2, 5 (#910), 6 |
| Multi-établissement et droits | Section 6. NFC-02-06 non fermé |
| Plan exécutable | Section 7 |
| Aucun code produit modifié | Ce fichier seul |
| PR Draft / HOLD | À confirmer sur la PR de ce document |
