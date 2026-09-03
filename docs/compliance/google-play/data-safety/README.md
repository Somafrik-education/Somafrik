# Google Play — Sécurité des données

Ce dossier est la source de vérité versionnée pour la déclaration **Sécurité des données** de l’application Android Somafrik dans Google Play Console.

## Fichiers

- `somafrik_google_play_data_safety.csv` : fichier à importer dans **Play Console → Contenu de l'application → Sécurité des données → Importer depuis le fichier CSV**.
- `generate_data_safety_csv.py` : générateur déterministe du CSV. Les réponses métier doivent être modifiées dans ce script puis le CSV doit être régénéré.

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

## État déclaré au 3 septembre 2026

- collecte de données : **oui** ;
- chiffrement en transit : **oui** ;
- auto-création de compte par l’utilisateur dans l’application : **non** ;
- comptes créés/provisionnés par l’établissement ou Somafrik ;
- demande de suppression : `https://somafrik.app/suppression-compte` ;
- aucune finalité publicité/marketing déclarée ;
- notifications Android : token Expo Push, collecte facultative car dépendante de l’autorisation de notification.

> Important : ce fichier est une déclaration de conformité, pas une configuration runtime. Toute modification doit être basée sur le comportement réel de la version Android publiée.