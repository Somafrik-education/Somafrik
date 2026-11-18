# E2E-PREPROD-GLOBAL-01 — Rapport final CTO

**Recommandation : HOLD / NO-GO.** La recette E2E est très incomplète : 124 scénarios sur 125 sont BLOCKED, et un P1 reste ouvert (#1178). Ce rapport ne constitue **pas** une autorisation de déploiement (#720).

## 1. Chiffres

| Indicateur | Valeur |
|---|---|
| Fonctionnalités inventoriées (`develop@93f98e44`) | **497** entrées : 347 routes API, 108 routes Web, 42 écrans Mobile. 15 domaines, 0 non classée |
| Scénarios E2E | **125** |
| PASS | **1** (E2E-009, préproduction, sans authentification) |
| FAIL | 0 |
| BLOCKED | **124** |
| NOT APPLICABLE | 0 |
| Couverture Web réelle (parcours UI) | **0 %** |
| Couverture Mobile réelle | **0 %** |
| Couverture sécurité non authentifiée | 334 / 334 routes protégées → 401 |
| Vérifications PostgreSQL de préproduction | 0 (BLOCKED) |

## 2. Blocages restants

| Code | Blocage | Levée attendue |
|---|---|---|
| BLK-AUTH | Pas de comptes de test pour les 9 rôles et les deux établissements fictifs. Aucun canal sûr dans la session : le login passe par le corps de requête, la session ne peut injecter qu'un en-tête par hôte | Workflow manuel dans un environnement GitHub protégé `preprod-e2e` (`PROPOSITION-INJECTION-IDENTIFIANTS.md`), sur GO CTO |
| BLK-RENDER | Clé API Render refusée (401, deux essais) | Clé Render valide |
| BLK-PG | Pas de rôle PostgreSQL de préproduction en lecture seule | Rôle `readonly` |
| BLK-MOBILE | Pas d'appareil ou d'émulateur exploitable (pas de KVM), pas d'APK Preview relié à la préproduction | Appareil ou émulateur, et APK Preview |
| BLK-PERM | — | **Levé** le 2026-11-17 par l'autorisation CTO |

## 3. Sécurité et isolation

- **[E2E préprod]** Aucune route protégée n'est accessible sans jeton (334 / 334 → 401). La route de diagnostic est absente.
- **[Code]** 12 routes sans `requireAuth`, toutes justifiées. 44 routes authentifiées relèvent d'un contrôle applicatif sans entrée RBAC : elles doivent être couvertes par l'E2E authentifié.
- **Ouvert :**
  - **R-01, P1, #1178 :** intégrité multi-tenant en base ;
  - **R-02, P2 :** `SOMAFRIK_E2E` en préproduction, non vérifié.

## 4. Versions testées

- **API préprod :** `93f98e44746607ba53c6997d76bbf1e126601e85`, lu sur `/api/health` le 2026-11-17 à 12:14 UTC.
- **Web préprod :** au moins `93f98e44` (empreinte du bundle, libellé de #1183). Le SHA exact n'est pas exposé.
- **Non-régression locale :** `develop@763d9bd8`.
- **Mobile :** aucun APK testé.

## 5. Anomalies

**P0 : 0. P1 : 1 (R-01). P2 : 2 (R-02 à vérifier, R-04). P3 : 1 (R-03).** Détail dans `ANOMALIES-P0-P3.md`.

## 6. Liens vers les preuves

`REGISTRE-PREUVES.md`, fichiers `preuves/*`, runs CI cités.

## 7. Décisions CTO attendues

1. GO pour l'environnement `preprod-e2e` et pour une PR séparée « outillage E2E » (suite Playwright et workflow manuel).
2. Une clé Render valide et un rôle PostgreSQL en lecture seule.
3. Un appareil ou un émulateur avec l'APK Preview.
4. Une décision sur R-01 (#1178) : correction avant GO, ou acceptation explicite du risque.

`E2E-PREPROD-GLOBAL-01 — DRAFT / HOLD — STOP / NO MERGE / NO DEPLOY.`
