# NFC-PROG-05 — Protocole de recette Android

13 octobre 2026. **PRÉPARÉ / NON EXÉCUTÉ.** Aucun téléphone connecté, installation
APK, lecture/écriture physique ou déploiement dans NFC-PROG-05.
Une nouvelle autorisation CTO est requise pour préparer l'environnement de
recette, sélectionner l'APK, l'installer et exécuter les scénarios suivants.

## Prérequis à contrôler lors de l'exécution autorisée

- Téléphone Android NFC supporté et activé, modèle/version OS documentés, batterie
  suffisante ; API minimale vérifiée dans apk-evidence.json. Binaire ARM64 seulement.
- Cartes NTAG213 et NTAG216 vierges NDEF, contrôlées comme inscriptibles ; cartes
  séparées pour UID utilisé, contenu étranger, lecture seule et modèle incompatible.
  Ne pas verrouiller irréversiblement une carte pour créer une fixture.
- APK preview sélectionné par CTO : HEAD exact, apkSha256 calculé sur le fichier,
  package/versionCode/versionName/SDK/signature comparés aux preuves CI. L'empreinte
  de l'archive GitHub ne remplace pas celle du fichier APK.
- Backend de recette compatible avec les HEAD #912/#914/#05 et PostgreSQL dédié,
  URL API effective préproduction ; aucun établissement/donnée de production.
- Données synthétiques : établissements A et B, administrateur scolaire autorisé,
  enseignant sans UPDATE et rôles plateforme de test ; flags carte/NFC explicites.
  Classes de 10 et 30 élèves, dont carte active A et réservation pending à reprendre.
- Capturer les états canoniques avant/après, audits, versions et compteurs. Aucun
  NDEF/token/secret, JWT, token_hash, mot de passe ou dump non assaini dans les preuves.
  Les captures écran montrent uniquement des élèves de test et messages fixes.

## Fiche de résultat à remplir, jamais préremplie PASS

| Champ | Valeur à relever |
| --- | --- |
| Exécutant / date / autorisation CTO | à renseigner |
| Téléphone / Android / NFC activé | à renseigner |
| PR / HEAD APK / apkSha256 | à renseigner |
| Package / versions / signature / SDK | à renseigner |
| HEAD Backend / migrations / base de recette | à renseigner |
| Classe / élèves de test / modèle carte | références assainies |
| Résultat | NON EXÉCUTÉ, puis PASS/FAIL/BLOQUÉ si réellement exécuté |
| Audit / état avant et après / compteurs | preuves assainies |
| Incident / reprise / action corrective | à renseigner |

## Déroulement individuel nominal

Ouvrir la fiche d'un élève de test sans carte. Choisir Programmer, présenter la
puce pour GET_VERSION/UID et contrôler la virginité NDEF. Suivre chaque demande
de retrait/représentation de **la même carte** : préflight, session d'écriture puis
nouvelle découverte pour relecture physique. Le parcours peut demander plusieurs
présentations ; ne pas supposer qu'un unique tap suffit.

Vérifier côté Backend pendant l'attente : issued/pending, expiration 30 minutes,
aucune active prématurée. Après écriture seule, ne pas conclure au succès. Après
relecture et confirmation, vérifier une seule active/encoded et audit unique. Ne
pas capturer le contenu secret de la puce. Scanner avec le lecteur existant selon
son parcours explicite ; la programmation seule ne crée aucune présence/paiement.

## Scénarios à exécuter

Tous les résultats ci-dessous sont **attendus**, aucun n'a été observé sur matériel.

| ID | Action | Résultat attendu / preuve |
| --- | --- | --- |
| R01 | Individuel NTAG213 vierge | NDEF canonique, relecture fraîche, une active et audit unique |
| R02 | Individuel NTAG216 vierge | mêmes invariants ; capacité validée avant write |
| R03 | Présenter NTAG215/ISO-DEP/MIFARE Classic ou autre incompatible | refus explicite, zéro réservation/write/activation |
| R04 | Carte avec NDEF étranger ou puce lecture seule vierge | refus, contenu préservé, aucune rotation automatique |
| R05 | Retirer la carte pendant écriture puis reprendre | erreur contrôlée, état canonique d'abord ; relecture ou rewrite consentie seulement |
| R06 | Substituer une autre puce après write | refus UID/contenu ; première réservation non activée |
| R07 | Double présentation / doubles clics / lecteur lancé pendant encode | une session seulement ; pas de doublon ni passage prématuré au suivant |
| R08 | Réservation expirée dans une fixture de recette préparée séparément | refus confirm/retry, révocation/audit expiry ; aucun renouvellement implicite |
| R09 | Couper le réseau avant/après issue, write ou confirm | compteur prudent, GET canonique ; même reservation UUID ; pas de nouvelle réservation/write/rotation automatique |
| R10 | Simuler response perdue après commit avec outil de recette autorisé | PG active, Mobile non confirmé ; reprise par relecture, audit unique |
| R11 | Remplacer A par B, interrompre puis reprendre | A active avant confirm B et après échec ; une seule active après bascule, historique lié |
| R12 | Batch 10 avec actifs/pending puis erreur au 4e | sélection automatique exclut actifs/pending ; reprise/remplacement explicites ; erreurs incluses dans restantes |
| R13 | Batch 30, erreur au 11e après 10 réussites | total30/programmed10/remaining20/errors1 ; reprise11 sans rewrite implicite puis jusqu'à30 |
| R14 | Pause avant réservation / pendant write / durant confirm, puis reprise | état pausing jusqu'à fin/annulation sûre, aucune nouvelle opération ; callbacks tardifs sans incrément/suivant |
| R15 | Ignorer l'élève puis poursuivre / reprendre l'ignoré | erreur conservée dans restantes ; opération suivante après nettoyage natif uniquement |
| R16 | Android Retour / terminer / arrière-plan / changement d'écran | annulation sûre ; pas de session transférée avant libération |
| R17 | Arrêt forcé puis relancement | reload canonique, resélection explicite, pending/active vérifiables ; aucun ancien actif compté automatiquement |
| R18 | NFC désactivé avant ouverture ou en cours | message fixe, aucune activation ni session concurrente |
| R19 | UID déjà utilisé/révoqué | refus historique, aucun recyclage par réémission |
| R20 | Compte B, sans UPDATE, Superadmin ou Admin Pays | refus canonique ; aucune donnée élèves externes, carte ou audit modifié |
| R21 | Désactiver flag / déconnexion / changement d'établissement pendant batch | fail-closed, données masquées, callbacks invalidés ; pas de réussite locale |
| R22 | Transfert de classe avant dernier GET | élève retiré bloqué ; race GET/POST résiduelle selon décision CTO documentée |
| R23 | Révoquer une carte encodée puis tenter lecture/confirm | capability refusée selon état canonique, aucune résurrection |
| R24 | QR, présence et finance existants | non-régression ; aucun déclenchement automatique par l'encodage |

## Invariants et diagnostic

- Total = programmées + restantes ; erreurs sous-ensemble des restantes, en cours 0/1.
- Une réussite exige active/encoded ou active/locked confirmée par Backend après
  relecture. UID/modèle corrects ne constituent pas une preuve d'authentification forte.
- Une rotation est toujours une intention consentie, avec UUID de retry distinct
  de celui de réservation ; TTL inchangé, secret jamais journalisé.
- En cas d'état incertain, arrêter la file et consulter les cartes canoniques.
  Ne pas répéter Programmer ni écraser une puce pour « débloquer » la session.
  Nettoyage natif échoué : aucune session suivante ; redémarrage éventuel documenté.
- Le transport, les impayés et le multi-scan restent hors périmètre.

Pour le timing, relever séparément préparation, latence API, temps entre
présentations, écriture/relecture radio, erreurs et reprise. Les mesures 10/30/50
du rapport d'intégration sont locales et **ne prédisent pas** le débit sur Android.

La validation CTO des preuves et incidents est requise après cette future recette.
**DRAFT / HOLD — DIFF CTO REQUIS — NO READY — NO MERGE.**
