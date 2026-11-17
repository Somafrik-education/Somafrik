# E2E-PREPROD-GLOBAL-01 — Injection sécurisée des identifiants et exécution réelle (proposition)

**Statut : proposition soumise au GO CTO. Rien n'est activé.** Aucun fichier `.github/workflows` n'est ajouté par cette PR documentaire.

## 1. Pourquoi une méthode dédiée

Plusieurs voies sont exclues :
- **Le chat et GitHub :** ils ne doivent jamais contenir de mot de passe (mandat §5).
- **La session Claude :** elle ne peut injecter qu'**un en-tête HTTP par hôte**, via le proxy. La connexion Somafrik transmet les identifiants dans le **corps** de `POST /api/login` : ce canal ne convient pas, et un seul en-tête ne couvrirait pas neuf rôles.
- **Les variables d'environnement de l'environnement cloud :** elles sont stockées en clair et sont interdites pour les secrets.

## 2. Méthode proposée : workflow manuel dans un environnement GitHub protégé

1. **Environnement GitHub `preprod-e2e`.** Relecteur obligatoire : le CTO. Exécution limitée à `develop`. Secrets par rôle :
   - `E2E_SUPERADMIN_LOGIN` / `_PASSWORD` ;
   - même chose pour `COUNTRY_ADMIN`, `SCHOOL_ADMIN_BI`, `SCHOOL_ADMIN_CD`, `PREFET`, `SECRETAIRE`, `ENSEIGNANT`, `COMPTABLE`, `PARENT` et `ELEVE`.
2. **Données fictives dédiées**, préfixées `E2E-` :
   - deux établissements, Burundi et RDC ;
   - classes, élèves, enseignants et obligations fictives.

   Elles sont créées par les scénarios eux-mêmes via l'interface, **jamais supprimées** (mandat §9), et marquées pour un nettoyage ultérieur sur GO.
3. **Suite Playwright** (Chromium), organisée par identifiant `E2E-NNN`. Pour chaque scénario, elle :
   - se connecte avec le rôle requis ;
   - exécute l'action dans l'interface ;
   - capture la requête et la réponse API concernées, **expurgées** (JWT, cookies, en-têtes `Authorization`, adresses e-mail et numéros masqués) ;
   - recharge la page pour vérifier la persistance ;
   - rejoue l'opération avec un rôle non autorisé.
4. **Preuves :**
   - artefacts GitHub Actions (traces, captures horodatées, journal JSON) avec une rétention de 90 jours ;
   - SHA de l'API lu sur `/api/health` au début et à la fin du run, et run invalidé s'il change en cours de route ;
   - un rapport par scénario au format de la fiche du mandat §5.
5. **Garde-fous :**
   - le workflow refuse de démarrer si l'URL cible ne correspond pas à `*-preprod.somafrik.app` ou `preprod.somafrik.app` ;
   - débit limité ;
   - aucune requête DELETE en dehors des scénarios d'archivage prévus ;
   - pas de test de charge sans paramètre explicite.

Squelette, non actif :

```yaml
name: E2E preprod (manual)
on:
  workflow_dispatch:
    inputs:
      scope: { description: "IDs E2E (ex. E2E-001..E2E-050)", required: true }
jobs:
  e2e:
    runs-on: ubuntu-latest
    environment: preprod-e2e          # relecteur CTO obligatoire
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22.12.0" }
      - run: npm ci && npx playwright install chromium
      - name: Garde de cible
        run: test "$E2E_WEB_URL" = "https://preprod.somafrik.app" && test "$E2E_API_URL" = "https://api-preprod.somafrik.app"
        env: { E2E_WEB_URL: https://preprod.somafrik.app, E2E_API_URL: https://api-preprod.somafrik.app }
      - name: Scénarios
        run: npx playwright test e2e/preprod --grep "${{ inputs.scope }}" --trace on
        env:
          E2E_SCHOOL_ADMIN_BI_LOGIN: ${{ secrets.E2E_SCHOOL_ADMIN_BI_LOGIN }}
          E2E_SCHOOL_ADMIN_BI_PASSWORD: ${{ secrets.E2E_SCHOOL_ADMIN_BI_PASSWORD }}
          # … un couple par rôle
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: e2e-preprod-${{ github.sha }}, path: e2e-results/, retention-days: 90 }
```

## 3. Mobile

- **Matériel :** un APK Preview (`EXPO_PUBLIC_API_URL=https://api-preprod.somafrik.app`) installé sur un appareil physique, ou sur un émulateur avec accélération matérielle.
- **Exécution :** scénarios manuels ou Maestro, avec enregistrement vidéo, SHA de l'APK et SHA de l'API.
- **Limite connue :** l'émulateur de la CI Hermes sert aux preuves natives (stockage hors connexion, SQLCipher). Sans comptes de test, il ne couvre pas les parcours fonctionnels.

## 4. PostgreSQL et Render (lecture seule)

- **PostgreSQL :** un rôle `readonly` sur la base de préproduction, utilisé depuis un poste autorisé ou depuis le workflow, pour les requêtes de comptage (dont celles de #1178).
- **Render :** une clé API Render valide, pour lire les SHA déployés et la présence de `SOMAFRIK_E2E` sans afficher aucune valeur. La clé actuellement enregistrée est refusée (401).

## 5. Décisions attendues du CTO

1. GO pour créer l'environnement GitHub `preprod-e2e` et ses secrets (création par le propriétaire du dépôt).
2. GO pour une PR séparée ajoutant la suite Playwright et le workflow manuel. C'est de l'outillage de recette, pas une fonctionnalité.
3. Fourniture d'un rôle PostgreSQL en lecture seule et d'une clé Render valide.
4. Mise à disposition d'un appareil Mobile ou d'un APK Preview.
