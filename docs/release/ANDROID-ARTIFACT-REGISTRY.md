# Registre des artefacts Android — Somafrik

Source : PARITE-WEB-MOBILE-RECOVERY-01, LOT 2 (suite de l'audit #1193, issue #1192).

## Règles

1. **Un binaire distribué = une ligne de ce registre.**
   - Colonnes : commit, versionCode, versionName, profil, SHA-256, signature, canal.
   - Un binaire absent du registre est **non traçable** et ne doit pas être utilisé pour une recette ni un GO.
2. **Provenance embarquée.** Depuis le LOT 2, chaque APK/AAB embarque `extra.buildProvenance` (commit, branche, profil, canal, origine du versionCode) dans `assets/app.config`.
   - Contrôle : `scripts/verify-android-artifact-provenance.js <apk|aab> --expect-sha <sha40>`.
   - Le contrôle refuse un binaire sans provenance ou issu d'un autre commit.
3. **versionCode.**
   - **EAS** : compteur distant (`appVersionSource: remote`), seule source pour les AAB destinés au Play Store.
   - **Builds locaux et CI hors EAS** : valeur statique `ANDROID_VERSION_CODE` (`Mobile/config/releaseEnvironments.js`, actuellement 25). Elle peut être surchargée par `SOMAFRIK_ANDROID_VERSION_CODE`.

   Le versionCode **seul n'identifie pas un binaire** : seul le couple *commit + SHA-256* fait foi. « v25 » ne doit plus être employé comme identifiant.
4. **Signature de test.** Un binaire signé « Android Debug » n'est jamais distribuable sur un canal Play ; le vérificateur le refuse.
5. **Aucune publication Play Store** n'est faite par ces workflows : le canal « EAS production » signifie un AAB construit, non soumis.

## Entrées connues

| # | Artefact | Commit | versionCode (source) | versionName | Profil | SHA-256 | Signature | Construit par | Canal |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `somafrik-production.aab` (EAS run #2) | `e223e30e9e195dabff01e66a81afdf0164486dc2` | 24 (EAS distant) | 1.2.1 | production | `988a45d3322d574a5cbd4f3620152e465a7544639d67476bf58a5dea963fbf28` | clé d'upload EAS (non relevée) | GitHub Actions `eas-production-aab.yml` #2, 2026-11-17 20:09 UTC | Non soumis (distribution **NON VÉRIFIÉE**) |
| 2 | `somafrik-production.aab` (EAS run #3) | `e223e30e9e195dabff01e66a81afdf0164486dc2` | 27 (EAS distant) | 1.2.1 | production | `e236ddcf356b1d3ebad48b2da5c944db40c234f01a8b5aeeedcca0bd8359fd89` | clé d'upload EAS (non relevée) | GitHub Actions `eas-production-aab.yml` #3, 2026-11-17 22:15 UTC ; artefact 14378610942 | Non soumis (distribution **NON VÉRIFIÉE**) |
| 3 | Build(s) EAS versionCode 25 / 26 | **inconnu** | 25 / 26 (EAS distant) | ? | ? | ? | ? | Hors GitHub Actions : le compteur passe de 24 à 26 entre les runs #2 et #3 | **NON TRAÇABLE** : à identifier sur la console EAS par le CTO |
| 4 | `somafrik-auth-mobile-01-preprod.apk` | `99cb7915190dfc11dc1d21742df7507bb21b789f` | 25 (app config) | 1.2.1 | preview | `86379992b22ee3170c5d7592213789740008026e8fe9906ff2346071e5188347` | Android Debug (test) | Build local Gradle arm64, 2026-11-16 | Test interne uniquement, sans provenance embarquée (antérieur au LOT 2) |

Les APK de reproduction x86_64 construits pour l'émulateur ne sont pas des artefacts de distribution et ne figurent pas ici.

## Ajouter une entrée

```bash
node scripts/verify-android-artifact-provenance.js <fichier.apk|.aab> --expect-sha <commit> \
  --channel "<canal réel>" [--version-code <versionCode EAS>] --registry android-artifact-registry.jsonl
```

Puis reporter la ligne JSON produite dans le tableau ci-dessus, dans le même lot que la décision de distribution.
