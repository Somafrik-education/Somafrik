# Développement Mobile rapide — Docker Core + Expo local

## Objectif

Valider les corrections Mobile sans générer un APK/AAB à chaque itération.

La boucle locale officielle utilise :

- PostgreSQL 16 dans Docker ;
- Backend Somafrik dans Docker, en mode API-only ;
- Expo/Metro directement sur le PC ;
- Expo Go sur téléphone physique ou émulateur Android.

Aucun appel EAS et aucun build Gradle n'est exécuté par cette boucle.

## Démarrage Windows

Depuis la racine du dépôt :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\mobile-local-expo.ps1
```

Au premier lancement, l'image `somafrik-backend-local:dev` est construite. Aux lancements suivants, elle est réutilisée et le code backend est monté depuis le dépôt.

Options :

```powershell
# Réseau Wi-Fi qui bloque le mode LAN Expo
powershell -ExecutionPolicy Bypass -File scripts\mobile-local-expo.ps1 -Tunnel

# package.json/package-lock backend modifié : reconstruire l'image
powershell -ExecutionPolicy Bypass -File scripts\mobile-local-expo.ps1 -RebuildBackend

# Repartir avec une base PostgreSQL locale vide
powershell -ExecutionPolicy Bypass -File scripts\mobile-local-expo.ps1 -ResetDb
```

## Vérifications

Le script attend que cette URL réponde `200` avant de lancer Expo :

```text
http://127.0.0.1:5000/api/health
```

Sur un téléphone physique, le script affiche aussi l'URL LAN à tester dans le navigateur du téléphone, par exemple :

```text
http://192.168.1.25:5000/api/health
```

`Mobile/.env.local` est généré localement et est ignoré par Git. Le script ne modifie ni `Mobile/eas.json`, ni un profil preview/préproduction/production.

## Docker seul

```powershell
# Première construction / dépendances backend modifiées
docker compose -f docker-compose.local.yml build backend

# Démarrer uniquement PostgreSQL + Backend
docker compose -f docker-compose.local.yml up -d postgres backend

# Logs backend
docker compose -f docker-compose.local.yml logs -f backend

# Arrêt sans effacer PostgreSQL
docker compose -f docker-compose.local.yml down

# Reset complet de la base locale
docker compose -f docker-compose.local.yml down -v
```

## Quand un APK/AAB redevient obligatoire

Le build natif est un gate de release, pas un gate de chaque correction fonctionnelle. Il est requis avant une release Android et lorsqu'un changement touche notamment `android/`, la configuration Expo/EAS, les permissions Android, les plugins Expo, le SDK ou une dépendance native.

Les changements TypeScript/React Native, API, RBAC et écrans métier peuvent être validés d'abord avec cette boucle Docker Core + Expo local, puis par CI/Security.
