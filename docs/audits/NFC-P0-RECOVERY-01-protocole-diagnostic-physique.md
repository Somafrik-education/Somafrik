# NFC-P0-RECOVERY-01 — Protocole de diagnostic physique en lecture seule

**Statut : DRAFT / HOLD — PRÉPARÉ / NON EXÉCUTÉ.** Exécution soumise à autorisation CTO écrite.
Objectif : attribuer à **chaque carte rejetée** une catégorie A-G démontrée, sans aucune écriture sur la puce et sans mutation de base de données.

## 1. Interdictions absolues

| Interdit | Raison |
| --- | --- |
| Ouvrir Somafrik en mode programmation/encodage pendant le diagnostic | Le parcours peut écrire et réserver un UID |
| Utiliser un onglet *Write*, *Format*, *Erase*, *Protect*, *Lock*, *Set password*, *Other* d'une application NFC | Écriture ou verrouillage, parfois irréversible |
| Saisir ou essayer un mot de passe NTAG (PWD_AUTH) | Compteur d'échecs possible ; interdiction CTO |
| Photographier ou copier le texte NDEF complet | Il contient le secret de la carte |
| Exporter un rapport de scan complet hors du registre restreint | Il contient le NDEF et l'UID |
| Exécuter une requête SQL autre que `inventory-readonly.sql` | Aucune mutation autorisée |
| Conclure E ou F sur la seule base d'un message de Somafrik | Le message `NFC_FOREIGN` couvre 8 situations |

## 2. Rôles

| Rôle | Responsabilité |
| --- | --- |
| Opérateur | Manipule les cartes et le téléphone de diagnostic, remplit le registre |
| Témoin | Vérifie chaque étape et cosigne le registre |
| Détenteur des accès base | Exécute Q1/Q7/Q8 en `READ ONLY`, sur liste d'UID fournie par l'opérateur |
| CTO | Autorise l'exécution, valide les catégories, décide toute suite |

## 3. Matériel

- **Téléphone de diagnostic dédié**, sur lequel Somafrik n'est **pas** installé (ou est fermé de force).
- Application **NXP TagInfo** (éditeur des puces NTAG), utilisée **uniquement** en scan.
- Un second téléphone NFC d'un autre fabricant, pour confirmer une carte « muette ».
- Enveloppes ou sachets numérotés, et une feuille de chaîne de garde.
- Accès au registre restreint, construit à partir de `evidence/nfc-p0-recovery-01/registre-cartes-rejetees.template.csv` et **conservé hors Git**.

## 4. Préparation

1. Rassembler **toutes** les cartes rejetées, y compris celles jugées « perdues ».
2. Attribuer à chacune un numéro d'inventaire (INV-001…) sur sachet, sans rien coller sur la zone d'antenne.
3. Pour chaque carte, recueillir auprès des utilisateurs : date approximative, téléphone utilisé (TEL-xx), message exact affiché, nombre de tentatives, et si le bouton « Verrouiller définitivement » a été vu ou utilisé.
4. Réaliser la vérification des téléphones (`NFC-P0-RECOVERY-01-provenance-apk.md`, §2) **avant** le diagnostic des cartes.

## 5. Mode opératoire par carte (lecture seule)

Une carte à la fois. La sortir de son sachet, faire le relevé, la remettre aussitôt.

| Étape | Action TagInfo (Scan) | Relevé dans le registre |
| --- | --- | --- |
| 5.1 | Approcher la carte, attendre la fin du scan | Scan réussi : oui/non. Si non, voir §6 |
| 5.2 | Section *IC Information* | Fabricant, type d'IC (NTAG213/215/216 ou autre), réponse GET_VERSION |
| 5.3 | Section *ID* | UID (7 octets ; commence par `04` pour NXP) |
| 5.4 | Section *Memory*, page 02 | Octets de verrouillage statiques (octets 2-3 ; `00 00` = aucun) |
| 5.5 | Page 03 | Capability Container : `E1 10 12 00` = NTAG213 lecture/écriture ; 4e octet = `0F` = **lecture seule NDEF** ; `00 00 00 00` = non formatée |
| 5.6 | Page 28h (40) | Verrouillage dynamique (`00 00 00` attendu) |
| 5.7 | Page 29h (41), 4e octet = AUTH0 | `FF` = pas de mot de passe ; autre valeur = protection à partir de cette page |
| 5.8 | Page 2Ah (42) | ACCESS (protection lecture, compteur) |
| 5.9 | Section *NDEF* | **Classe seulement** : vide / `somafrik:card` / URL / texte / autre / illisible. Pour `somafrik:card:`, noter **uniquement les 22 caractères** qui suivent le préfixe (`publicId`, non secret) et la longueur totale |
| 5.10 | Rescanner une seconde fois | Résultats identiques : oui/non |

Si une lecture de page échoue alors que l'UID est lu : noter « protégée à partir de la page X » et **s'arrêter** pour cette carte.

## 6. Carte qui ne répond pas

1. Rescanner en déplaçant la carte (centre ou bord du dos du téléphone, selon le modèle).
2. Essayer le second téléphone.
3. Si aucune réponse sur deux téléphones : catégorie **F (défectueuse) présumée**, à garder pour expertise. Ne pas jeter la carte.

## 7. Croisement avec la base (en lecture seule)

Le détenteur des accès exécute `inventory-readonly.sql` (transaction `READ ONLY`, terminée par `ROLLBACK`) :

- **Q1** avec l'UID → état de la ligne, motif, encodage.
- **Q7** avec l'identifiant de carte retourné par Q1 → historique en liste blanche.
- **Q8** avec l'UID → éligibilité à une reprise (protocole de récupération §3.1).
- **Comparaison du `publicId`** relevé en 5.9 avec celui de la ligne : correspondance oui/non (le `publicId` est visible dans l'application, il n'est pas secret).

Aucune donnée d'élève n'est restituée par ces requêtes.

## 8. Classification

| Observation (5.x + Q1/Q8) | Catégorie | Récupération (protocole de récupération) |
| --- | --- | --- |
| CC R/W, NDEF `somafrik` même `publicId`, ligne `active` | **A** | Aucune écriture ; chercher la couche fautive |
| CC R/W, NDEF `somafrik` même `publicId`, ligne `issued` vivante | **A** | Parcours `resume` existant |
| CC R/W, NDEF `somafrik` même `publicId`, ligne `revoked/nfc_reservation_expired`, Q8 tout vrai | **B** | **R1** : reprise sans écriture (après PR-1/PR-2) |
| Idem, une condition Q8 fausse | **B** bloquée | Décision CTO au cas par cas |
| CC R/W, NDEF vide, ligne `revoked/nfc_reservation_expired`, Q8 tout vrai | **D** | **R2** : reprise avec écriture consentie |
| CC R/W, NDEF vide, UID absent de la base | **D** vierge | Encodage normal ; si rejet, vérifier modèle et UID (5.2/5.3) |
| CC R/W, NDEF `somafrik` d'un **autre** `publicId` ou UID ≠ ligne | **G** | Suspicion de copie ; investigation |
| CC R/W, NDEF `somafrik:` mal formé ou illisible | **C** | Réparation contrôlée, mandat distinct |
| CC R/W, URL ou contenu fournisseur | **C** | Effacement contrôlé, mandat distinct |
| CC `00 00 00 00` (non formatée) | **D** non formatée | PR-6, décision CTO |
| NTAG215, UID ≠ `04…`, IC non NXP | Hors spécification | Non détruite ; politique matérielle à décider |
| AUTH0 ≠ `FF` et pages protégées | **E** | Aucune action sans mot de passe documenté |
| CC 4e octet = `0F`, ou bits de lock posés (pages 2/40) | **F** verrouillée | Irréversible ; documenter |
| Aucune réponse sur 2 téléphones | **F** défectueuse présumée | Conserver pour expertise |
| Résultats incohérents entre scans ou téléphones | **G** | Investigation |

## 9. Livrables du diagnostic

1. Registre complet (une ligne par carte), cosigné par l'opérateur et le témoin.
2. Synthèse chiffrée par catégorie et par téléphone d'origine.
3. Liste des cartes **B/D éligibles** à R1/R2 après livraison de PR-1/PR-2.
4. Captures d'écran recadrées (pages 2, 3, 40-42), **sans** NDEF ni nom.

## 10. Critères d'arrêt immédiat

- Une application propose ou lance une écriture : arrêter, consigner, prévenir le CTO.
- Une carte change d'état entre deux scans : catégorie G, prévenir le CTO.
- Une requête SQL retourne une erreur de droits ou tente d'écrire : arrêter.

**NFC-P0-RECOVERY-01 — DRAFT / HOLD — DIAGNOSTIC À VALIDER PAR LE CTO.**
