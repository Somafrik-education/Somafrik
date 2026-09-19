# Audit branding Somafrik — icônes, logos et flavors Web + Mobile

**Statut :** AUDIT UNIQUEMENT — aucune modification d’asset, de configuration ou de code de production.  
**Date :** 2026-09-12  
**Base inspectée :** `develop` @ `d43a0b31`  
**Méthode :** lecture Git + `file` + en-têtes PNG + SHA-1 blob Git + SHA-256 + références code/config. Script existant `Mobile/scripts/verify-mobile-branding.js` exécuté **en lecture** (OK). Aucun `expo prebuild`, aucune génération d’icône, aucun changement d’arbre.

---

## 1. Résumé exécutif

Somafrik dispose déjà d’un **contrat Mobile BRANDING-V2** clair et **vert** : deux PNG racine (logomark / lockup), copies Mobile pinées par SHA, icônes launcher iOS et Android adaptive **distinctes et dézoomées**. Ce n’est **pas** un branding Expo par défaut.

En revanche, le dépôt n’a **pas une source canonique unique** pour tous les canaux :

| Usage | Identité visuelle réellement servie |
| --- | --- |
| Mobile UI / splash / launcher | **Marque actuelle** : livre ouvert + toque + stylo (logomark) ; lockup « Somafrik » + slogan *Transformer l'éducation, renforcer l'impact* |
| Web header / login / footer | **Le lockup complet** (mot + slogan) compressé dans un carré 36–112 px |
| Favicon / apple-touch | Pictogramme livre/toque/stylo, fichiers **distincts** du Mobile |
| PDF bulletins (backend) | **Ancienne identité** « école + famille » / « S » — pas le logomark actuel |
| Reliques | Logos **SchoolLink** encore versionnés sous `backend/assets/` |

Il n’existe **pas** de `productFlavors` Android. Les environnements sont des **profils EAS** + variables `EXPO_PUBLIC_*` + badge in-app. **Preview, préprod et prod partagent le même `applicationId` / bundle / nom launcher / icônes / Firebase client.** Seuls l’URL d’API et le badge diffèrent. Préprod **et** prod sont tous deux `distribution: store` (AAB). C’est le risque d’identité le plus sérieux de cet audit.

**Aucune icône de notification Android dédiée** n’est déclarée dans le plugin `expo-notifications`. **Aucun dossier `android/` ou `ios/` n’est versionné** (`gitignore`) : le rendu Play/App Store est produit au `prebuild` EAS.

Compteurs : **16 fichiers branding binaires** inventoriés ; **10 visuels marketing** Web (hors logos) ; **0 SVG** ; **0 manifeste PWA** ; **0 feature graphic Play** versionnée.

---

## 2. Architecture actuelle du branding

```
Racine dépôt (sources BRANDING-V2)
├── logo without text.png     logomark 1254² RGB  → UI Mobile
└── logo with text.png        lockup  1254² RGB  → splash Mobile + logo Web public

Mobile/assets/ (copies ou dérivés pinés)
├── somafrik-logo.png                              = logomark racine (byte-identical)
├── somafrik-splash.png                            = lockup racine (byte-identical)
├── somafrik-app-icon.png                          variante dézoomée (~50 % largeur) — Expo icon + iOS + fallback Android legacy
└── somafrik-android-adaptive-foreground.png       variante plus dézoomée (safe zone 66/108)

web/public/
├── somafrik-logo.png                              = lockup racine (byte-identical) — BrandLogo
├── somafrik-icon.png                              512² RGBA — apple-touch-icon
├── favicon.png / favicon-32.png / favicon.ico     pictogramme onglet
└── marketing/*.webp                               OG / vitrine (pas le logo)

backend/assets/   (hors contrat BRANDING-V2)
├── somafrik-logo.jpg   PNG mal nommé — identité « S + famille + école »
├── somafrik-logo.png   JPEG mal nommé — identité circulaire « famille + école »
├── schoollink-logo.png / .jpg                     ancienne marque SchoolLink
```

Garde-fous existants (lecture seule, non modifiés) :

- `Mobile/scripts/verify-mobile-branding.js` — SHA Git des 2 sources + 2 launchers + copies UI/splash ; refuse 2 SHA legacy Mobile.
- `Mobile/scripts/generate-launcher-icons.py` — générateur (Pillow) ; **non exécuté** (écrirait des assets).
- `app.config.js` **n’écrase pas** `icon` / `splash` / `adaptiveIcon` de `app.json`.

**Il n’y a pas de SVG canonique.** Toute la chaîne est PNG (ou JPEG mal étendu).

---

## 3. Inventaire Mobile

### 3.1 Configuration

| Fichier | Rôle branding |
| --- | --- |
| `Mobile/app.json` | `name: Somafrik`, `slug: somafrik`, `scheme: somafrik`, `icon`, `splash`, `android.adaptiveIcon`, `package: com.somafrik.app`, `ios.bundleIdentifier: com.somafrik.app`, `version: 1.2.1`, `versionCode: 13` |
| `Mobile/app.config.js` | Overlay runtime : `DISPLAY_NAMES[profile]`, package/bundle **identiques**, API, badge, `googleServicesFile` si présent. **Ne touche pas** icon/splash/adaptiveIcon |
| `Mobile/eas.json` | 4 profils `development` / `preview` / `preproduction` / `production` — **aucune icône par profil** |
| `Mobile/config/releaseEnvironments.js` | Source unique IDs / URLs / badge |
| `Mobile/package.json` | `generate:launcher-icons`, `verify:mobile-branding` |
| `Mobile/google-services.json` | 1 projet Firebase, 1 `package_name: com.somafrik.app` |
| `Mobile/android/**`, `Mobile/ios/**` | **absents du Git** (gitignore) — générés EAS/prebuild |

### 3.2 Assets Mobile et références réelles

| Asset | Référencé par | Utilisé ? |
| --- | --- | --- |
| `Mobile/assets/somafrik-app-icon.png` | `app.json` `expo.icon` | **Oui** — icône iOS + fallback launcher Android / Play |
| `Mobile/assets/somafrik-android-adaptive-foreground.png` | `app.json` `android.adaptiveIcon.foregroundImage` | **Oui** |
| — `backgroundColor: #FFFFFF` | `app.json` adaptiveIcon | **Oui** — pas de `backgroundImage` |
| — `monochromeImage` | — | **Absent** |
| `Mobile/assets/somafrik-splash.png` | `app.json` `splash.image` (`contain`, fond `#FFFFFF`) | **Oui** |
| `Mobile/assets/somafrik-logo.png` | `WelcomeScreen`, `LoginScreen`, `RoleSelectionScreen` (`require(...)`) | **Oui** — UI in-app |
| Icône notification | plugin `expo-notifications` : seulement `color: #1d4ed8` + channel | **Non fournie** |
| Favicon Expo Web | pas d’`expo.web.favicon` | N/A (web produit ≠ Expo web) |
| `schoollink-logo.png` sous `Mobile/assets/` | gate `verify-mobile-release-readiness` exige l’absence | **Absent** (OK) |

Écrans UI logo : Welcome (logomark + texte « Somafrik » à côté), Login, RoleSelection. Le splash natif est le **lockup** (mot + slogan).

### 3.3 Ce que produira EAS / `expo prebuild` (sans l’exécuter)

D’après Expo SDK 54 + `app.json` actuel :

- **iOS** : AppIcon générée depuis `somafrik-app-icon.png` (carré, RGB, pas de coins cuits).
- **Android adaptive** : foreground = PNG dédié (carré blanc opaque + pictogramme centré et petit) ; background = couleur blanche ; pas de calque monochrome (icônes thématiques Android 13 : repli système).
- **Android legacy / Play high-res** : dérivé de `expo.icon` (`somafrik-app-icon.png`).
- **Notification small icon** : non déclaré → comportement Expo par défaut (souvent une silhouette générique ou un traitement médiocre du launcher couleur). **Risque P1.**
- Dossier `android/app/src/main/res/mipmap-*` : **non auditable dans Git**.

`app.json` `ios.supportsTablet: false` est **écrasé** par `app.config.js` (`true`) — hors branding, noté pour éviter une confusion de config.

---

## 4. Inventaire Web

### 4.1 Surfaces HTML / composant

| Surface | Fichier | Asset |
| --- | --- | --- |
| Favicon any | `web/index.html` | `favicon.ico` |
| Favicon 32 | idem | `favicon-32.png` |
| Favicon 192 | idem | `favicon.png` |
| Apple touch | idem | `somafrik-icon.png` (512²) |
| Logo applicatif | `BrandLogo` ← `SOMAFRIK_LOGO_URL` | `web/public/somafrik-logo.png` (**lockup**) |
| Header app | `Sidebar.tsx`, `MobileNavDrawer.tsx` | BrandLogo |
| Login | `LoginPage.tsx` — `h-14 w-14` | BrandLogo **sans** `showText` |
| Vitrine header | `MarketingHeader.tsx` — `showText` + image lockup | mot « Somafrik » **doublé** (bitmap + texte) |
| Footer vitrine | `MarketingFooter.tsx` | BrandLogo `onDark` |
| Pages légales | `LegalPages.tsx` | BrandLogo |
| OG / Twitter | `index.html` + `marketingContent.ts` | **screenshot dashboard** `somafrik-dashboard-etablissement.webp` — pas le logo |
| `theme-color` / `background-color` | `index.html` | **Absents** |
| Manifest PWA / icônes 192+512 maskable | — | **Absents** |
| `SOMAFRIK_ICON_URL` | `web/src/lib/brand.ts` | **Export mort** (aucun import) |

### 4.2 Assets Web

Voir tableau qualité §6. `web/src/assets/somafrik-login-background.png` **n’est plus référencé** (`LoginPage` fond uni `#1e3a5f` ; test `loginBackground.asset.test.ts`).

Aucun fichier `manifest.webmanifest` / `site.webmanifest`. Aucun `.svg` dans le dépôt.

Couleur marque Web : Tailwind `brand.DEFAULT = #1d4ed8` — alignée sur `expo-notifications.color`.

---

## 5. Matrice des environnements / flavors

**Il n’y a pas de `productFlavors` Gradle ni d’`applicationIdSuffix`.** La différenciation Mobile est 100 % **profil EAS + extra Expo + badge**.

| Élément | Dev | Preview / QA | Préprod | Prod |
| --- | --- | --- | --- | --- |
| App name launcher | Somafrik | Somafrik | Somafrik | Somafrik |
| Android package | `com.somafrik.app` | **idem** | **idem** | **idem** |
| iOS bundle ID | `com.somafrik.app` | **idem** | **idem** | **idem** |
| Expo slug / scheme | `somafrik` / `somafrik` | idem | idem | idem |
| Version / versionCode | 1.2.1 / 13 (source ; store `autoIncrement`) | idem | AAB store + autoIncrement | AAB store + autoIncrement |
| Artefact EAS | APK dev client | APK internal | **AAB store** | **AAB store** |
| API (EAS `env`) | locale / `EXPO_PUBLIC_API_URL_DEV` | `https://api-preprod.somafrik.app` | `https://api-preprod.somafrik.app` | `https://api.somafrik.app` |
| Icône / splash / adaptive | **mêmes 3 PNG** | **mêmes** | **mêmes** | **mêmes** |
| Badge environnement | « Développement · V2.0 » | « Preview QA · V2.0 » | « Préproduction · V2.0 » | **aucun** |
| Firebase client | `Mobile/google-services.json` unique (`project_id: somafrik-12424`, package `com.somafrik.app`) | **partagé** | **partagé** | **partagé** |
| `GoogleService-Info.plist` iOS | **absent du dépôt** | absent | absent | absent |
| Demo mode | autorisé si `EXPO_PUBLIC_DEMO_MODE` | interdit par `app.config.js` | interdit | interdit |

Commentaire explicite dans `releaseEnvironments.js` : *« Nom launcher identique partout. L'environnement se distingue par le badge in-app. »* — choix produit, pas un oubli de nommage.

### Web (hors EAS)

| | Dev | Préprod Web | Prod Web |
| --- | --- | --- | --- |
| Front | Vite local | `https://preprod.somafrik.app` (Render static) | `https://somafrik.app` (Vercel `main`) |
| API documentée | `localhost:5000` | **Deux hôtes coexistent dans le dépôt** : `https://api-preprod.somafrik.app` (Mobile/EAS) vs `https://somafrik-api-preprod.onrender.com` (`web/.env.example`, `.env.preproduction.example`, `docker-compose.preprod.yml`) | `https://api.somafrik.app` |
| Favicon / logo | **identiques** tous environnements | identiques | identiques |
| Comptes démo | `VITE_SHOW_DEMO_ACCOUNTS=true` (exemple) | prévu false | prévu false |

### Situations de partage d’identité (à décider CTO)

1. **Préprod store + Prod store = même `com.somafrik.app`.** Un AAB préprod envoyé sur la piste production Play **remplace** l’app prod. Pas de suffixe `.preprod`.
2. **APK preview** : même package → **désinstalle / remplace** l’app prod sur un téléphone.
3. **FCM** : un seul projet / un seul `google-services.json` → tokens push non isolés par flavor.
4. **Preview Mobile et préprod Mobile** ciblent **la même API** `api-preprod.somafrik.app` (volontaire) mais le **Web préprod** est encore documenté sur l’hôte Render historique.

---

## 6. Assets réellement utilisés — fiche qualité

Légende transparence : RGB = fond blanc **cuit** (pas de canal alpha). RGBA = alpha présent.

### 6.1 Sources canoniques Mobile BRANDING-V2

| Chemin | Type | Px | Ratio | α | Poids | Usage | Env | Source | Conformité approx. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `logo without text.png` | PNG RGB | 1254×1254 | 1:1 | non | 840 Ko | Logomark (livre, toque, stylo) | tous | **Canonique mark** `gitBlobSha fd536beb…` | OK comme master UI ; pas un SVG ; marges importantes autour du pictogramme |
| `logo with text.png` | PNG RGB | 1254×1254 | 1:1 | non | 1005 Ko | Lockup + slogan *Transformer l'éducation, renforcer l'impact* | tous | **Canonique lockup** `0ac5e3ff…` | OK splash / print ; **trop chargé** pour un favicon ou un header 40 px |

Le script `verify-mobile-branding.js` **valide** ces SHA (exécution 2026-09-12 : OK).

### 6.2 Dérivés / copies Mobile

| Chemin | Type | Px | α | Poids | Usage | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `Mobile/assets/somafrik-logo.png` | PNG RGB | 1254² | non | 840 Ko | UI in-app | **Copie byte-identical** du mark |
| `Mobile/assets/somafrik-splash.png` | PNG RGB | 1254² | non | 1005 Ko | Splash `contain` | **Copie byte-identical** du lockup |
| `Mobile/assets/somafrik-app-icon.png` | PNG RGB | 1254² | non | 247 Ko | Expo `icon` / iOS | Variante **dézoomée ~50 %** ; pas de coins arrondis cuits ; pas de transparence (App Store OK) ; SHA `1b97e3d1…` |
| `Mobile/assets/somafrik-android-adaptive-foreground.png` | PNG RGB | 1254² | non | 151 Ko | Adaptive foreground | Encore plus petit (bounding circle contrat ≤ 42 %, padding ≥ 28 %) ; SHA `94f800bd…` ; fond blanc opaque |

Contrôle Android (contrat script, non re-généré ici) : logo **dans** viewport 72/108 **et** safe zone 66/108 ; plus dézoomé que iOS. Crop rond OEM : **risque faible** (plutôt pictogramme petit / « faible présence » = P2).

### 6.3 Web utilisés

| Chemin | Type | Px | α | Poids | Usage | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `web/public/somafrik-logo.png` | PNG RGB | 1254² | non | 1005 Ko | BrandLogo partout | **Copie du lockup** — slogan illisible à 36–56 px ; **≠** logomark Mobile |
| `web/public/somafrik-icon.png` | PNG RGBA | 512² | oui | 140 Ko | apple-touch | Pictogramme seul ; α peut se peindre en noir sur vieux iOS |
| `web/public/favicon.png` | PNG RGBA | 192² | oui | 26 Ko | favicon 192 | Pictogramme plus cadrage serré |
| `web/public/favicon-32.png` | PNG RGBA | 32² | oui | 1,4 Ko | favicon 32 | Lisibilité limite ; toujours livre/toque/stylo |
| `web/public/favicon.ico` | ICO | 16+32+48 | oui | 4,7 Ko | favicon any | 3 frames PNG |

### 6.4 Backend (PDF bulletins) — utilisés

`backend/services/bulletinPdfRenderer.js` résout dans l’ordre `somafrik-logo.jpg` puis `.png`.

| Chemin | Type réel | Px | Usage | Identité |
| --- | --- | --- | --- | --- |
| `backend/assets/somafrik-logo.jpg` | **PNG** 1254² RGB, 1025 Ko | PDF (prioritaire) | Ancien lockup **S + famille + école** + slogan |
| `backend/assets/somafrik-logo.png` | **JPEG** 1024², 125 Ko | PDF (fallback) | Autre variante **famille + école circulaire** + slogan |

Ces fichiers **ne matchent aucun SHA BRANDING-V2**. Les bulletins parents peuvent donc afficher une **marque différente** de l’app Mobile/Web.

---

## 7. Assets suspects / orphelins

| Chemin | Statut | Détail |
| --- | --- | --- |
| `web/src/assets/somafrik-login-background.png` | **Orphelin** | 1448×1086 RGB, 1,9 Mo ; Login n’importe plus l’image ; mockup interne `preprod.somafrik.app` + mug au logomark actuel |
| `backend/assets/schoollink-logo.png` | **Relique** | PNG 1254² — « SchoolLink / Connecter l’éducation à l’avenir » |
| `backend/assets/schoollink-logo.jpg` | **Relique** | JPEG 1254², même famille SchoolLink |
| `SOMAFRIK_ICON_URL` | **Code mort** | Déclaré, jamais importé |
| Noms `logo without text.png` / `logo with text.png` | Fragile | Espaces dans le nom racine |
| Extensions backend inversées | Suspect | `.jpg` est PNG, `.png` est JPEG |
| SHA legacy Mobile `053d6532…` / `526c8ee4…` | Bloqués par le garde-fou | Anciens launchers, plus présents en fichiers nommés |

Aucun `icon.png` / `splash.png` Expo default dans `Mobile/assets/`.

Marketing `web/public/marketing/**` (10 WebP) : preuves produit / OG, pas des logos. Non orphelins (index.html + `marketingContent.ts`).

---

## 8. Écarts Web ↔ Mobile

| Sujet | Mobile | Web | Écart |
| --- | --- | --- | --- |
| Logo in-app | **Logomark** (sans mot) + mot en texte (Welcome) | **Lockup** bitmap (mot + slogan) dans un carré | P1 — deux grammaires |
| Splash / hero | Lockup plein écran, légitime | Login : lockup 56 px | P1 — lockup mal employé |
| Favicon / apple-touch | N/A natif | Pictogramme RGBA dédié | OK d’avoir un fichier séparé ; **pas** généré depuis le launcher Mobile |
| Couleur | Notifications `#1d4ed8` | Tailwind brand `#1d4ed8` | Cohérent |
| Slogan | Splash : *Transformer l'éducation…* ; Welcome : « ERP scolaire mobile… » | `SOMAFRIK_TAGLINE = "ERP scolaire SaaS"` ; lockup PNG = slogan institutionnel | **Trois libellés** |
| PWA | N/A | Pas de manifest | Web seulement |
| PDF | N/A | N/A | Backend ≠ Web/Mobile |

Header vitrine : `BrandLogo showText` **et** lockup déjà lettré → « Somafrik » en double.

---

## 9. Écarts Preview ↔ Préprod ↔ Production

| Sujet | Constat |
| --- | --- |
| Icônes / splash / nom | **Identiques** — distinction visuelle = badge (sauf prod) |
| Package / bundle | **Identiques** — collision install et collision Play |
| API Mobile preview vs préprod | **Même host** `api-preprod.somafrik.app` |
| API Web préprod documentée | Host Render `somafrik-api-preprod.onrender.com` **≠** host Mobile |
| Firebase | **Un** client Android, **pas** de plist iOS |
| Store | Préprod **et** prod = AAB `distribution: store` |

Pas d’icône « QA orange » / « préprod ». Un utilisateur ne peut pas distinguer les APK/AAB par le launcher.

---

## 10. Classification CTO

### P0

| ID | Constat | Pourquoi P0 |
| --- | --- | --- |
| P0-1 | Préprod EAS et Prod EAS : **même** `com.somafrik.app`, **même** nom, **tous deux** `distribution: store` (AAB) | Un upload Play sur la mauvaise piste publie la **mauvaise API** sous l’identité prod |
| P0-2 | Preview APK = même `applicationId` que prod | Remplace l’app prod sur device ; même icône |

*Le package prod lui-même (`com.somafrik.app`) n’est pas « faux ». Le risque est le **partage d’identité** entre tracks.*

### P1

| ID | Constat |
| --- | --- |
| P1-1 | Pas d’icône notification Android monochrome dédiée (`expo-notifications` sans `icon`) |
| P1-2 | Pas de `monochromeImage` adaptive (Android 13+ themed icons) |
| P1-3 | Web `BrandLogo` sert le **lockup 1 Mo** au lieu du logomark ; slogan/mot illisibles et parfois doublés |
| P1-4 | PDF bulletins : **ancienne identité** (famille/école ou S) ≠ marque livre/toque/stylo |
| P1-5 | Reliques SchoolLink encore dans `backend/assets/` |
| P1-6 | Firebase Android unique partagé preview/préprod/prod ; **pas de config iOS** versionnée |
| P1-7 | Duplication Web/Mobile du logo (lockup vs mark) → divergence future si on ne met à jour qu’un côté |
| P1-8 | Documentation API préprod Web (Render) vs Mobile (`api-preprod.somafrik.app`) |

### P2

| ID | Constat |
| --- | --- |
| P2-1 | Aucun SVG canonique |
| P2-2 | Noms de fichiers racine avec espaces |
| P2-3 | Extensions JPEG/PNG inversées côté backend |
| P2-4 | Fond blanc cuit (pas d’alpha) sur mark/lockup/launchers — OK splash, moins flexible sur fond sombre |
| P2-5 | Adaptive Android très dézoomé : sûr au crop, **faible présence** launcher |
| P2-6 | `somafrik-login-background.png` orphelin (1,9 Mo) |
| P2-7 | Pas de `theme-color`, pas de PWA, pas d’icône 512 maskable |
| P2-8 | `SOMAFRIK_ICON_URL` mort ; apple-touch avec alpha |
| P2-9 | Pas de feature graphic Play 1024×500 dans le dépôt |
| P2-10 | Trois formulations de slogan / sous-titre |
| P2-11 | Copies byte-identical (3 chemins pour le lockup, 2 pour le mark) sans génération build-time |

**Hors P0 visuel store :** l’icône launcher **actuellement pinée** (livre/toque/stylo, dézoomée) est cohérente avec BRANDING-V2 et **n’est pas** un branding Expo default.

---

## 11. Recommandations (sans implémentation dans ce lot)

1. **Figer 5 rôles d’asset non interchangeables** (voir §12) et un dossier `brand/` unique.
2. **Décider CTO** : garder un seul `com.somafrik.app` (badge only) **ou** suffixer preview/préprod (`.preview` / `.preprod`) avant tout nouvel AAB store préprod.
3. Web : `BrandLogo` petite taille → **logomark** ; lockup réservé splash / papier / footer large.
4. Backend PDF : pointer le lockup BRANDING-V2 ; retirer SchoolLink et les JPEG/PNG mal nommés.
5. Ajouter une **notification icon** 96×96 blanc-sur-alpha ; ne jamais réutiliser le launcher couleur.
6. Optionnel adaptive `monochromeImage`.
7. PWA + `theme-color: #1d4ed8` + apple-touch sans alpha sur fond blanc.
8. Aligner la doc API préprod Web sur l’hôte réellement utilisé par Mobile, ou l’inverse, mais un seul host canonique.
9. Ne pas lancer `generate-launcher-icons.py` sans re-piner les SHA du garde-fou.

---

## 12. Proposition de source canonique de branding

**Master (à créer au lot 1, pas dans cet audit) :**

| Rôle | Contenu | Format cible | Ne doit pas |
| --- | --- | --- | --- |
| 1. Logo complet institutionnel | Livre + toque + stylo + mot **Somafrik** + slogan *Transformer l'éducation, renforcer l'impact* | SVG + PNG large (actuel `logo with text.png`) | Être l’app icon ni le favicon |
| 2. Logomark / pictogramme | Livre + toque + stylo **sans mot** | SVG + PNG (actuel `logo without text.png`) | Contenir le slogan |
| 3. App icon | Logomark **dézoomé**, fond uni `#FFFFFF`, carré, **sans** coins cuits | PNG 1024–1254 (iOS + Android legacy) + foreground adaptive plus padded | Contenir « Somafrik » |
| 4. Favicon | Pictogramme très cadré, 32 / 16 / ICO / 192 | PNG+ICO (éventuel SVG `rel=icon`) | Être le lockup |
| 5. Notification icon | Glyphe **blanc** (silhouette livre/toque) fond transparent | PNG alpha, pas de couleur | Être le logo bleu |

Sources Git actuelles à promouvoir comme masters PNG (en attendant SVG) :

- Mark : `logo without text.png` (`fd536beb…`)
- Lockup : `logo with text.png` (`0ac5e3ff…`)
- Launchers : déjà dérivés et pinés ; régénérer uniquement via `generate-launcher-icons.py` + mise à jour SHA.

**À retirer du rôle « Somafrik actuel » :** identités famille/école, « S » illustré, SchoolLink.

---

## 13. Lots de correction proposés (PR distinctes)

Conformément à la recommandation de découpage :

### Lot A — Source canonique (aucune ID store)

- Dossier `brand/` (ou équivalent) + README des 5 rôles.
- Optionnel : SVG mark + lockup.
- Remplacer les copies Web/Mobile/PDF pour qu’elles **dérivent** des masters (ou restent des copies pinées, mais une seule vérité).
- Nettoyage SchoolLink + fichiers mal nommés backend.
- Alignement slogan.
- **Interdit dans ce lot :** package ID, EAS profiles, Firebase, Play.

### Lot B — Mobile Android / iOS

- Notification icon + plugin `expo-notifications.icon`.
- `monochromeImage` si validé visuellement.
- (Décision P0) suffixe package preview/préprod **ou** documentation playbooks « never promote preprod AAB to production track ».
- Ne pas `prebuild --clean` dans une PR métier.

### Lot C — Web / favicon / PWA

- BrandLogo : logomark aux tailles `md`/`login` ; lockup seulement `hero`.
- Favicon / apple-touch générés depuis le pictogramme (fond opaque pour touch).
- `theme-color`, manifest 192/512, retirer l’orphelin login-background.
- Ne pas toucher aux IDs Mobile.

### Lot D (optionnel, si le CTO veut l’isoler du lot A)

- Bulletins PDF uniquement.

---

## 14. Google Play — assets vs attentes (lecture seule)

| Attendu Play | Dans le dépôt | Verdict |
| --- | --- | --- |
| Icône app 512 / high-res | Source 1254² RGB carrée `somafrik-app-icon.png` → Expo génère les densités au build | **Conforme comme source** ; artefact final non versionné |
| Launcher adaptive | Foreground dédié + `#FFFFFF` | **Conforme contrat BRANDING-V2** (safe zone) ; présence visuelle plutôt faible |
| Feature graphic 1024×500 | **Absent** | **Manquant** |
| Captures store | `docs/user-guides/assets/mobile/*.png` (guides, pas fiche Play) | **Douteux / hors fiche** — ne pas les prendre pour des assets Play |
| Data safety | `docs/compliance/google-play/...` | Hors logo (inventaire données) |

Aucune fiche Play n’a été modifiée.

---

## 15. iOS (lecture seule)

| Critère | Constat |
| --- | --- |
| Source carrée | Oui 1254² |
| Coins arrondis cuits | Non |
| Transparence | Non (RGB) — compatible store |
| Qualité | PNG net, pictogramme lisible une fois masqué (contrat 50 % largeur) |
| Splash | Lockup `contain` fond blanc |
| Nom | « Somafrik » tous profils |
| Bundle | `com.somafrik.app` tous profils |
| Push config | Pas de `GoogleService-Info.plist` dans Git |

Rien n’a été envoyé à App Store Connect.

---

## 16. Preuves de non-régression audit

Commandes de lecture exécutées :

- `git ls-files` (png/svg/ico/jpg/webp, android/, ios/)
- `file` sur les 16 binaires branding
- inspection IHDR PNG + SHA-1 blob + SHA-256
- `node Mobile/scripts/verify-mobile-branding.js` → `OK: BRANDING-V2`
- `rg` favicon, adaptiveIcon, splash, BrandLogo, google-services, productFlavors

**Fichiers de production / assets : 0 modifié.**  
**Diff attendu de la PR d’audit : un seul fichier — celui-ci.**
