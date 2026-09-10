# #577 — Lot 0 Mobile vert (hygiène et navigation fail-closed)

**Date :** 2026-09-10  
**Base RED d’origine :** `a24b5ae3157b27a8f52bbc93fb725b08654d98cc` (Draft #578)  
**Base PR de validation :** `develop@ec2b232e8cb0e6aae27ddac5b1b99a3c9c3596c3`  
**Branche :** `feat/577-l0-mobile-hygiene`  
**Périmètre :** Lot 0 uniquement  
**Backend / API / PostgreSQL / RBAC métier :** non touchés  
**Ready / merge :** interdits sans validation CTO

## Résultat TDD

| Étape | Résultat |
|---|---:|
| Baseline L0 avant correction | 0 vert / 12 rouges |
| Lot 0 après correction | 12 verts / 0 rouge |
| TypeScript Mobile | vert |

Le test causal reste `Mobile/src/lib/pariteL0Hygiene.red.test.ts`. Le script de
recette du lot est `npm --prefix Mobile run test:parite-l0-green`.

## Corrections L0

- Retrait des entrées Mobile plateforme non prises en charge : établissements,
  abonnements, notifications plateforme, droits par rôle et audit.
- Retrait des KPI Pays/Établissements et des CTA qui ouvraient `AdminCrud`.
- Retrait de `AdminCrud`, Documents, Rapports, Audit, Permissions et
  PlatformNotifications du graphe live Mobile.
- Conservation des écrans canoniques Users, Teachers, Students, Classes,
  Payments et Announcements.
- Suppression des cartes `SchoolManagement` sans destination canonique et des
  CTA `AdminCrud` du `MenuScreen` historique.
- Retrait des faux écrans Documents/Rapports/Audit fondés sur le cache local.
- KPI Accueil : rôle et libellé accessibles.
- Ajout du viewport de recette 430 dp.
- Le bouton Notifications du header ne peut plus ouvrir la messagerie plateforme
  Web-only ; la boîte interne établissement reste disponible.

## Non-régression ciblée

Verts : sécurité Mobile, RBAC live, faux writes, UX V1, vérité des données Accueil,
route map canonique, identité des rôles, permissions live, alignement CTA/RBAC,
data truth, résilience réseau, cache/offline L1, hydratation des présences,
taux de présence classe et scaffold/runtime E2E.

Les smoke tests natifs Android restent explicitement `BLOCKED` sans appareil ou
prébuild Android ; leurs vérificateurs contractuels sortent 0 comme prévu.

Trois contrôles historiques échouent sur des assertions déjà rouges à la base et
sur des fichiers inchangés par L0 :

- `verify:mobile-usability` attend encore un `toLocaleString("fr-FR")` direct,
  alors que `PaymentReceiptCard` utilise déjà `formatFinanceAmount` ;
- `verify:mobile-domain-hydration` attend une ancienne forme d'appel direct à
  `/backoffice/announcements` ;
- `verify:mobile-form-fields` signale le `TextInput` préexistant de
  `InternalNotificationsScreen`.

Ces écarts ne sont pas corrigés dans ce lot afin de respecter le périmètre.

## État du Lot 1

Le métier L1 n'est pas implémenté : 9 écarts sur 10 restent rouges. `L1-10` est
devenu vert uniquement parce que le viewport partagé 430 dp est une exigence L0
et L1. Aucun client unpaid, KPI ledger ou traitement 401/403 n'a été ajouté ici.

Preuve structurée :
`docs/audits/evidence/parite-l0-green-verify.json`.

## Gouvernance de validation

La PR #580 a été retargetée vers `develop` sans changement runtime afin que les
PR Gates GitHub s'exécutent sur le vrai diff `develop → HEAD`. La preuve RED de
#578 reste dans l'historique du HEAD ; aucun test n'est supprimé ou désactivé.
