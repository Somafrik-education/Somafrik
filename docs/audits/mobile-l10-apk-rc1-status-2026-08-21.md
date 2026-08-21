# L10 — APK RC1 Android : statut d’ouverture

Date : 2026-08-21  
Branche : `cursor/mobile-l10-apk-rc1-d0b9`  
Base : `develop` @ `53457556796f779b699f76b1cf88da5b666281e6` (merge L8 #291)

Mode : **ouverture L10**. Aucune modification métier. Aucun `eas submit`. Aucun upload Play.

---

## 1. Décision d’entrée

CTO L9 : **GO APK RC1**. Chantier fonctionnel **fermé**.

Contrat figé :

- APK test terrain, pas parité Web totale, pas production ;
- 0 P0 / 0 P1 connus à l’audit L9 ;
- hors blocage : NFC, Mobile Money, GRANT/REVOKE Mobile, création Élève / Classe / Paiement Mobile ;
- NO-GO immédiat : crash, login impossible, mauvaise préprod, 401/403 incohérent, cross-tenant, faux succès d’écriture, corruption.

Protocole téléphone : [docs/mobile/L10-APK-RC1-SMOKE.md](../mobile/L10-APK-RC1-SMOKE.md).  
Contrat build : [docs/mobile/PREVIEW-APK.md](../mobile/PREVIEW-APK.md).

---

## 2. Ce que cette VM a exécuté

| Contrôle | Résultat |
| -------- | -------- |
| SHA base L8 | `53457556796f779b699f76b1cf88da5b666281e6` |
| `npm --prefix Mobile run verify:mobile-preview-apk` | **OK** (contrat Git + expo config + bundle + prebuild CNG) |
| `eas whoami` / `eas project:info` | **`BLOCKED_EAS_AUTH`** — `Not logged in`, `EXPO_TOKEN` absent |
| `eas build --platform android --profile preview` | **non lancé** (fail-closed : pas d’identifiants inventés) |
| Smoke téléphone Admin School / Directeur / Enseignant | **non exécutable** dans cette VM Cloud |

Le gate Preview reste vert **sans** auth EAS, et affiche explicitement :

```text
BLOCKED_EAS_AUTH
EAS_AUTH_REQUIRED
```

`SOMAFRIK_REQUIRE_EAS_AUTH=1` ferait échouer le même gate : c’est le mode « auth obligatoire », pas le mode CI Cursor.

---

## 3. Identifiants Preview (existants, non inventés)

| Champ | Valeur |
| ----- | ------ |
| Profil | `preview` |
| Distribution | `internal` |
| `buildType` | `apk` |
| Nom | Somafrik QA |
| Badge | Preview QA |
| Package | `com.somafrik.app` |
| Slug | `somafrik` |
| projectId | `47b217aa-3d96-4d50-a9f5-fc0ec8a3cef5` |
| API | `https://somafrik-api-preprod.onrender.com` |

---

## 4. Action humaine pour produire l’APK

Sur une machine déjà autorisée sur le projet Expo `somafrik` :

```bash
cd Mobile
eas login
eas whoami
eas project:info
eas build --platform android --profile preview
```

Puis : attendre **finished**, télécharger l’APK, désinstaller `com.somafrik.app`, installer **Somafrik QA**, exécuter [L10-APK-RC1-SMOKE.md](../mobile/L10-APK-RC1-SMOKE.md).

Keystore Preview : **EAS-managed**. Ne pas committer `*.jks` / `credentials.json`.

---

## 5. CI `develop` au moment de l’ouverture L10

Merge L8 `53457556` :

| Workflow | Statut observé |
| -------- | -------------- |
| Admin User Creation E2E | **success** |
| CI | **in_progress** |
| Security | **in_progress** |

Le HEAD fonctionnel équivalent (#291 `8666cc2f`) était 10/10 SUCCESS avant merge. L10 n’attend pas un correctif métier ; le smoke téléphone reste le juge RC1.

---

## 6. Verdict L10 (cette itération)

| Livrable | État |
| -------- | ---- |
| Périmètre RC1 figé (docs) | **fait** |
| Protocole smoke 3 rôles + NO-GO + Web-only | **fait** |
| Contrat Preview APK (gate) | **OK** |
| Build EAS installable | **`BLOCKED_EAS_AUTH`** |
| Smoke téléphone réel | **bloqué** (pas d’APK, pas de device) |

**Pas de GO terrain.**  
**Pas de NO-GO produit** : aucun P0/P1 nouveau ; le blocage est d’authentification Expo, pas un défaut métier.

STOP métier. Reprendre uniquement après `eas login` humain + APK **finished**.
