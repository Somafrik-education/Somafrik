# Somafrik — APK Preview Android (Expo / EAS)

PR Draft uniquement. **Aucun `eas submit`. Aucun upload Google Play. Aucun merge Ready.**

Render héberge l’API et le Web. Le Mobile Preview est distribué via Expo/EAS et ne constitue pas un service Render.

Cible :

```text
Somafrik
   ↓
APK Android Preview (distribution interne)
   ↓
Expo / EAS
   ↓
installation directe sur téléphone Android
   ↓
https://somafrik-api-preprod.onrender.com
   ↓
PostgreSQL préproduction
```

## Contrat Preview

| Champ | Valeur |
| ----- | ------ |
| Profil EAS | `preview` |
| Distribution | `internal` |
| Plateforme | Android |
| Artefact | **APK** (`buildType: apk`) |
| Nom affiché | **Somafrik** |
| Badge | **Preview QA** (jamais en production) |
| Package | `com.somafrik.app` |
| Slug Expo | `somafrik` |
| projectId Expo | `47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5` (existant, ne pas inventer) |
| API | `https://somafrik-api-preprod.onrender.com` |
| HTTPS only | oui |
| Demo credentials / PIN | interdits |
| API production | interdite |
| localhost / `127.0.0.1` / `10.0.2.2` / `192.168.*` | interdits |

Fail-closed : si le profil `preview` est mal configuré, `app.config.js` et `verify:mobile-preview-apk` échouent.

Le package Android est **le même** que Production (`com.somafrik.app`). Android refuse d’installer deux APK du même package signés différemment. Désinstaller l’app Play / production **avant** d’installer l’APK Preview. L’environnement Preview se distingue par le badge in-app **Preview QA**, pas par le nom launcher.

## CNG

`Mobile/android/` est gitignoré. EAS régénère le natif au build (`npx expo prebuild`). Ne pas committer `android/` ni un `*.apk`.

`EXPO_PUBLIC_DEMO_PIN` est **omis** de `eas.json` (EAS CLI 22 refuse une chaîne vide). Le PIN démo n’est pas « désactivé par `""` » : il n’est tout simplement pas injecté.

## Prérequis humains (EAS)

Si l’environnement Cursor / CI n’est pas connecté à Expo :

```text
EAS_AUTH_REQUIRED
BLOCKED_EAS_AUTH
```

Action humaine obligatoire (aucun identifiant n’est inventé dans le dépôt) :

```bash
cd Mobile

eas login
eas whoami
eas project:info

eas build --platform android --profile preview
```

Si EAS demande un keystore Android pour le Preview : **EAS-managed credentials**. Ne pas créer ni committer de `*.jks` / `credentials.json`.

Interdit :

```text
eas submit
Google Play Production upload
Google Play Internal upload
publication Production
secret de signature dans Git
```

Équivalent npm (même commande) :

```bash
cd Mobile
npm run build:preview
```

## 1. Récupérer le lien EAS

Après `eas build --platform android --profile preview` :

1. Le CLI affiche l’URL du build (expo.dev / eas).
2. Compte Expo autorisé sur le projet `somafrik` (`47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5`).
3. Page du build : profil `preview`, plateforme Android, artefact APK, distribution internal.

Ne pas coller dans une PR publique une URL d’artifact nécessitant un cookie / token privé.

## 2. Télécharger l’APK

Sur la page EAS du build **finished** : bouton de téléchargement de l’APK.

Transfert possible : lien EAS ouvert sur le téléphone, câble, ou partage interne de l’équipe QA (pas Play Store).

## 3. Autoriser l’installation Android

Sur le téléphone :

1. Paramètres → Sécurité / Applications → sources inconnues / installer des apps inconnues.
2. Autoriser le navigateur (Chrome) **ou** l’application Fichiers utilisée pour ouvrir l’APK.
3. Confirmer l’avertissement Android (sideload).

## 4. Installer l’APK Preview

1. Désinstaller toute app `com.somafrik.app` déjà présente (Play / autre signature).
2. Ouvrir l’APK téléchargé → Installer.
3. Le lanceur doit afficher **Somafrik** (pas « Somafrik QA » ni « Somafrik Préprod »).
4. Au lancement, le badge **Preview QA** doit être visible.

## 5. Vérifier l’API préprod

Contrôles attendus :

- Nom : Somafrik
- Badge : Preview QA
- Login : identifiants **préproduction** uniquement (pas de PIN démo, pas de comptes production)
- L’app ne doit pas joindre `https://api.somafrik.app`
- Preuve repo / CI : `npm run verify:mobile-preview-apk` échoue si `preview` pointe vers production, HTTP, localhost ou LAN

Render (`somafrik-api-preprod` + `somafrik-web-preprod`) reste l’hébergement API/Web. L’APK n’ajoute **pas** de service Render Mobile.

## 6. Relancer une build Preview

```bash
cd Mobile

eas login
eas whoami
eas project:info

eas build --platform android --profile preview
```

Attendre le statut **finished**, retélécharger l’APK, réinstaller (désinstaller d’abord si la signature interne a changé).

Credential Android Preview : laisser EAS gérer le keystore. Ne pas recycler le keystore Play dans Git.

## Gates automatisés

```bash
npm --prefix Mobile run typecheck
cd Mobile && npx expo-doctor
npm --prefix Mobile run verify:mobile-preview-apk
npm run verify:mobile-release-readiness
```

`verify:mobile-preview-apk` inspecte `eas.json`, `expo config` preview, le bundle Metro, le prebuild Android CNG, et sonde `eas project:info`.

`BLOCKED_EAS_AUTH` n’est émis **que** pour une vraie absence d’authentification (`Not logged in`, compte Expo requis, `eas login` / `EXPO_TOKEN`). Tout autre échec (`project not found`, permission denied, projectId inattendu, erreur réseau / CLI) **fait échouer** le gate.

Pour une validation de release où l’auth EAS est obligatoire (y compris l’absence d’auth) :

```bash
SOMAFRIK_REQUIRE_EAS_AUTH=1 npm --prefix Mobile run verify:mobile-preview-apk
```

Sans cette variable, CI Cursor sans `eas login` peut rester vert sur le reste du contrat Preview, tout en affichant explicitement `BLOCKED_EAS_AUTH` — ce n’est pas un skip d’erreur projet.

## L10 — Smoke RC1 (après APK finished)

Décision CTO L9 : **GO APK RC1**, chantier métier **fermé**. L10 produit l’APK Preview et le smoke téléphone ; il ne rouvre pas NFC, Mobile Money, GRANT/REVOKE, ni la création Élève / Classe / Paiement.

Protocole (Admin School, Directeur / Préfet, Enseignant, réseau / outbox, Web-only jamais présentés comme écriture réussie) :

[L10-APK-RC1-SMOKE.md](./L10-APK-RC1-SMOKE.md)

Statut d’ouverture (EAS auth, SHA L8) : [mobile-l10-apk-rc1-status-2026-08-21.md](../audits/mobile-l10-apk-rc1-status-2026-08-21.md)

Le vert `verify:mobile-preview-apk` n’est pas un GO terrain. `BLOCKED_EAS_AUTH` dans cette VM = action humaine `eas login`, pas un skip projet.
