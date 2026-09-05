# Google Play — Sécurité des données

Ce dossier est la source de vérité versionnée pour la déclaration **Sécurité des données** de l’application Android Somafrik dans Google Play Console.

## Fichiers

- `somafrik_google_play_data_safety.csv` : fichier **versionné** à importer dans **Play Console → Contenu de l'application → Sécurité des données → Importer depuis le fichier CSV**.
- `CURRENT.sha256` : empreintes SHA-256 du CSV (CRLF d’import Play, et équivalent LF).
- `generate_data_safety_csv.py` : générateur déterministe du CSV. Les réponses métier doivent être modifiées dans ce script puis le CSV doit être régénéré **et** `CURRENT.sha256` recalculé.
- `audit-aab-v20-2026-09-05.md` : réaudit du binaire Android production v20 réellement construit.

## Règle de maintenance

La déclaration doit être réauditée et le CSV régénéré dès qu’une évolution modifie les pratiques de données de l’application, notamment :

- ajout ou retrait d’un champ personnel (nom, e-mail, téléphone, identifiant, adresse, etc.) ;
- ajout ou retrait de données scolaires, financières, messages, documents, photos ou pièces jointes ;
- ajout ou retrait d’un SDK de télémétrie, crash reporting, analytics, publicité ou marketing ;
- modification des notifications push ou des identifiants d’appareil ;
- modification de l’authentification, de la création/provisionnement des comptes ou du parcours de suppression ;
- modification du chiffrement en transit, des prestataires techniques ou des mécanismes de partage de données ;
- modification de la politique de confidentialité ou de la page de suppression de compte.

Google Play exige que la déclaration reste exacte et complète pendant toute la durée de publication de l’application.

## Procédure de mise à jour

1. Auditer le code Mobile, Backend et les SDK/dépendances réellement embarqués dans la version Android candidate.
2. Mettre à jour les réponses dans `generate_data_safety_csv.py`.
3. Régénérer :

```bash
python3 docs/compliance/google-play/data-safety/generate_data_safety_csv.py
```

4. Vérifier que le fichier contient **783 lignes** (1 en-tête + 782 réponses du modèle actuellement utilisé).
5. Comparer le CSV avec un export récent de Google Play Console avant import. Si Google a fait évoluer son modèle, repartir du nouvel export et adapter le générateur.
6. Importer le CSV dans Play Console puis relire l’aperçu de la fiche Store avant envoi.
7. Avant tout merge de la PR de mise à jour, effectuer un **diff GitHub indépendant** et vérifier qu’aucune réponse de conformité n’a changé sans justification.

## État déclaré au 5 septembre 2026

Le candidat Android production a été réaudité : AAB v20, EAS build `5998c352-cefe-4d95-b86d-ceceac7b1d2b`, package `com.somafrik.app`, source `main@17a9bfbad8a19bcf1c4a29e5dd56fe91759c09f6`. L’audit final est consigné dans `audit-aab-v20-2026-09-05.md`.

- collecte de données : **oui** ;
- chiffrement en transit : **oui** ;
- auto-création de compte par l’utilisateur dans l’application : **non** ;
- comptes créés/provisionnés par l’établissement ou Somafrik ;
- demande de suppression : `https://somafrik.app/suppression-compte` ;
- aucune finalité publicité/marketing déclarée ;
- notifications Android : token Expo Push, collecte facultative car dépendante de l’autorisation de notification ;
- aucun changement des réponses CSV requis par l’audit du binaire v20.

Avant envoi Google Play : importer le CSV puis relire l’aperçu généré dans Play Console afin de détecter une éventuelle évolution du modèle Google ou une divergence d’interface.

> Important : ce fichier est une déclaration de conformité, pas une configuration runtime. Toute modification doit être basée sur le comportement réel de la version Android publiée.
