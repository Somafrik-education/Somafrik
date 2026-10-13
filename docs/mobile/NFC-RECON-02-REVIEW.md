# NFC-RECON-02 — candidat Android NTAG213/216

**DRAFT / HOLD — DIFF CTO REQUIS — NO READY — NO MERGE — NO PRODUCTION.**

Branche de validation : `codex/nfc-recon-02-android-ntag213-216`, créée depuis le HEAD contrôlé de #908 `c3db71cbaa6e77e761576d439562336c4d6791e6`. Base develop contrôlée : `1bdd302e8ab228d6aaf0bfea3078d9b8361efe1f`. Le lecteur provient de #891 `b2aaa6151468b9398b1644299f4bdc081ccb050c` (merge-base `72aea41b15f234afc867530f6728a3a239d1914f`). Les branches et PR #891/#908 ne sont pas modifiées. Le HEAD candidat et les diffs complets sont ceux de la nouvelle PR ; aucun SHA de candidat n'est inventé dans ce document avant le commit.

## Résolution et garanties

| Conflit | Résolution |
|---|---|
| Mobile/app.json | Configuration Android de #908 : une dépendance `react-native-nfc-manager@4.0.0-beta.10`, plugin dédié `withSomafrikNfcAndroid`, permission NFC. Pas de plugin générique ajoutant NFC iOS. |
| verify-mobile-security.js | Politique Android de #908 conservée ; aucune permission audio, localisation, galerie large, contacts ou appels ajoutée. |
| verify-native-prebuild.js | Contrôles Android renforcés de #891 : NFC accordé et non supprimé, toutes les features facultatives, compileSdk/minSdk vérifiés. Absence de NFC iOS contrôlée dans les plists et tous les entitlements générés. |
| schoolSettings.studentCard.test.js | Union des assertions pertinentes des deux branches : fail-closed, droits scolaires inchangés, plugin Android dédié et permissions sensibles bloquées. |

Les capacités `studentCardNfcEnabled` et les gates du lecteur sont conservées. Les scripts de vérification exécutent les tests QR, NFC lecteur, encodage et sessions. Le gate LOT 4 déclare exactement les nouveaux fichiers de session et ce rapport dans le périmètre Carte Élève existant ; les interdictions backend/RBAC hors périmètre restent testées.

`nfcSessionNative.ts` possède un seul gestionnaire partagé par les deux adaptateurs. Une lease exclusive couvre les appels natifs ; un second propriétaire est refusé. La cancellation attend la fin des opérations en vol avant handoff, refuse leurs résultats obsolètes et ne permet pas au cleanup d'une ancienne lease d'annuler la nouvelle. Une cancellation native échouée garde le matériel réservé jusqu'à une reprise de fermeture réussie. La nouvelle découverte après écriture/verrouillage conserve la même propriété jusqu'à la fermeture finale.

Les erreurs `isEnabled()` sont propagées en échec : aucune découverte ni écriture après un probe rejeté. Le lecteur est Android uniquement. Le modal invalide les opérations obsolètes au background/unmount et conserve son verrou local jusqu'à la fin de l'opération annulée. Les tokens restent volatils et ne sont pas loggés, placés en outbox ou stockés.

## Contrat commun et périmètre

Les deux modèles utilisent le même NDEF Text `somafrik:card:<publicId.secret>`. Un test utilise le codec NDEF installé pour encoder puis décoder les records des deux modèles à travers le lecteur réel. Le record prend 87 octets (90 avec TLV/terminateur), compatible avec NTAG213 et NTAG216. GET_VERSION/UID, contrôle de capacité et relecture par nouvelle découverte viennent de #908 ; le lecteur vient de #891.

**Les règles métier Présences restent celles de #891.** Le scan unitaire continue à pointer immédiatement via le moteur canonique. Le multi-scan avec revue et validation finale, la finance autonome et le transport ne sont pas implémentés dans ce candidat. Les fichiers/services de présence canoniques ne sont pas réécrits. Aucun GO produit pour l'appel collectif.

L'UID et le verrouillage ne sont pas des protections cryptographiques contre le clonage. L'état SQL locked est une observation client habilité. La révocation et le scope/RBAC serveur restent nécessaires. Les cartes non formatées NDEF sont refusées ; l'UID historique reste réservé après révocation.

## CI #908 — divergence expliquée

Contrôle REST au SHA exact `c3db71cbaa6e77e761576d439562336c4d6791e6` :

- `check-runs?filter=latest`, pagination complète : **42 checks, tous success**.
- `check-runs?filter=all` : **43 checks : 42 success, 1 failure historique**.
- L'échec historique est `finance-f8`, job [114981113359](https://github.com/Somafrik-education/Somafrik/actions/runs/38300236518/job/114981113359), terminé le 12 octobre 2026 à 19:55:31 UTC.
- Le même workflow, même SHA, tentative 2, est SUCCESS : job [114984160016](https://github.com/Somafrik-education/Somafrik/actions/runs/38300236518/job/114984160016), terminé à 19:59:25 UTC.
- Les 27 runs Actions au SHA exact sont SUCCESS. Les suites Render et Cursor ont zéro check-run et sont queued : elles ne doivent pas être comptées comme des tests exécutés.

La synthèse HTML rouge observée correspond au jeu contenant l'ancien échec ; elle ne contredit pas les dernières conclusions réussies. Aucun nouveau run #908 n'a été déclenché, aucun check neutralisé. La cause détaillée de l'échec initial ne peut pas être déduite des seules conclusions ; les logs redirigés sont soumis à un autre domaine réseau. Le statut du nouveau candidat doit être vérifié indépendamment, à son propre HEAD.

## Vérifications et preuves exigées

- `npm --prefix Mobile run verify:student-card-mobile` : QR, lecteur, nouvelles sessions et guards.
- `npm --prefix Mobile run test:student-card-nfc-encoding` ; `typecheck` ; `verify:mobile-security`.
- Tests unitaires backend cartes/settings/capabilities/présence/finance/encodage ; schéma et HTTP sur PostgreSQL 16 isolé, sans production.
- `verify-student-access-cards`, LOT 4, Android release readiness, tests du vérificateur APK.
- `verify:mobile-native-aab` : prebuild/inspection des trois profils Android, contrôle d'absence NFC iOS ; la génération seule n'est pas une compilation APK.
- Workflow NFC existant de la nouvelle PR : PostgreSQL puis APK preview ARM64 au HEAD exact. Conserver ses résultats et son artifact ; un artifact d'une autre SHA ne valide pas ce candidat.

Les tests de sessions couvrent les deux adaptateurs derrière un pont simulé, l'exclusion de propriétaires, résultats tardifs, attente de cancellation et d'écriture, startup partagé/retry, quarantine après erreur, rediscovery et fail-closed. Ils ne prouvent aucune lecture physique.

## Smoke préparatoire proposé — aucun verrouillage irréversible

Prévoir 10 NTAG213 et 5 NTAG216 de test, téléphone Android NFC et backend préproduction compatible avec le candidat et sa migration. Utiliser des élèves/établissements de recette et les droits effectifs requis. Capturer modèle/Android, version/signature et SHA256 de l'APK, HEAD Mobile/backend, état du schéma, alias de cartes et résultats sans données personnelles ni capability.

Tester les deux modèles : NDEF vierge, UID/GET_VERSION, association, écriture, retrait/représentation/relecture, substitution entre phases, doublon UID/élève, autre tenant, cartes incompatibles/illisibles, NDEF étranger, retrait pendant opération, perte réseau et reprise, révocation, NFC éteint/absent, background/verrouillage du téléphone, annulation et alternance NTAG213/216. Vérifier que chaque carte demeure inscriptible. Annuler tout dialogue de lock : **aucune commande makeReadOnly pendant ce smoke**.

Le lecteur d'appel actuel écrit une présence ; ne pas le présenter comme une collecte provisoire. Tester la lecture/résolution seule via l'adaptateur existant dans une instrumentation approuvée. La campagne de 30 élèves et zéro écriture avant validation appartient au lot NFC-FIX-03 ultérieur.

**Smoke physique NOT_RUN** tant que téléphone, cartes, APK candidat et backend compatible ne sont pas réunis. Le candidat reste HOLD même si les tests logiciels et la CI passent. Aucun Ready/Merge sans diff GitHub indépendant CTO.

NFC-RECON-02 — DRAFT / HOLD — DIFF CTO REQUIS — NO MERGE.
