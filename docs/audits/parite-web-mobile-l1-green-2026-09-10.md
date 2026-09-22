# #577 — Lot 1 Impayés : rouge → vert Mobile

**Base exacte :** `develop@b0bcc27799cc43bab74c7c1f23279b8897b5a5a8`

**Branche :** `feat/577-l1-unpaid-parity`

**Périmètre :** Lot 1 uniquement — vérité du KPI et de la consultation « Impayés ».

**Backend / PostgreSQL / routes serveur / RBAC serveur :** non modifiés.

**Statut :** Draft obligatoire ; aucun Ready ni merge dans cette passe.

## Décision appliquée

La surface Mobile conserve « Impayés » et consomme le ledger canonique déjà exposé par
`GET /api/backoffice/finance/unpaid`, conformément à la recommandation CTO de la #578.

- « Impayés » désigne les élèves ayant des obligations ouvertes, jamais les reçus `pending`.
- La valeur est le nombre d'élèves uniques renvoyés par le ledger.
- Le détail est une route Mobile dédiée, en lecture seule.
- Le gate UI est `Impayés:READ`, distinct de `Paiements:READ`.
- Le header `X-Somafrik-School-Code` existant couvre cette route école.
- Une réponse résiduelle d'une autre école est filtrée côté présentation (défense en profondeur).
- Les réponses 401, 403, hors-ligne et erreur ne deviennent jamais une réussite numérique `0`.
- Une requête devenue obsolète après changement de scope ne peut pas remplacer le nouvel état.

## Preuve TDD

| Étape | Résultat |
|---|---:|
| Base rouge `pariteL1UnpaidKpi.red.test.ts` | **1 vert / 9 rouges** |
| Après implémentation | **10 verts / 0 rouge** |
| Nouveau contrat ledger/tenant/RBAC | **vert** |
| Contrat UX Finance issu de la maquette V7 | **rouge puis vert** |
| TypeScript Mobile | **vert** |

Le cas L1-10 était déjà vert sur la base : le viewport 430 dp avait été livré au Lot 0.
Les neuf écarts fonctionnels L1-01…L1-09 étaient encore rouges avant cette passe.

Commande verte :

```bash
npm run test:parite-l1-green
```

## Surfaces livrées

| Surface | Comportement |
|---|---|
| Accueil Comptable | KPI « Impayés » issu du ledger ; ouvre `Unpaid` |
| Paiements | carte « Impayés » issue du ledger ; aucune dépendance à `paymentStats.pending` |
| Impayés | écran de synthèse et liste des élèves concernés, lecture seule |
| Drawer Comptable | entrée `Impayés`, masquée sans `Impayés:READ` |
| Client API | `getUnpaidLedger()` dans `services/api.ts` uniquement |

## Correctif UX après smoke physique

Le smoke Expo Go a confirmé la vérité du KPI après le correctif serveur #584, puis a exposé
deux écarts de présentation et un défaut financier critique :

- les résumés de Paiements restaient surdimensionnés par rapport à la maquette validée ;
- les paiements récents n'utilisaient pas les cartes compactes dépliables ;
- le résumé Impayés additionnait des montants CDF et USD sous une seule devise.

Le test `pariteL1FinanceUx.test.ts` a d'abord été enregistré rouge. Le passage vert apporte :

- le résumé Paiements en deux colonnes à 390/430 dp, replié à 360 dp ;
- des cartes de paiement et d'impayé compactes, accessibles et dépliables ;
- les détails et actions secondaires uniquement dans la zone dépliée ;
- les totaux Impayés regroupés par devise, sans conversion ni addition inventée ;
- la conservation des données métier : référence, moyen, libellés, non-imputé, période,
  retard, montants attendu/payé/dû et échéance.

Commits distants de preuve :

- RED : `cf218a178e06e929bb631044e9e2405c316bd42d` ;
- GREEN : `072b1bbca95aa8e2e7e9c16ff6a7b7e9d2377aaf`.

### Clarification après rapprochement Web/Mobile — Oscar Mukwege

Le reçu `PAY-0015` confirme `30 000 CDF` reçus, `30 000 CDF` imputés et `0 CDF`
non imputé. Avec l'encaissement de novembre de `20 000 CDF`, le ledger des créances
ouvertes expose correctement `180 000 CDF` attendus, `50 000 CDF` alloués et
`130 000 CDF` restants.

Le calcul et les données sont conservés. Seul le libellé Mobile ambigu `Montant payé`
devient `Montant alloué aux impayés ouverts`.

- RED libellé : `cc50dbe0c5ee8ed4c2516bc390136998a8ab3c20` ;
- GREEN libellé : `cb43c0696c2495306911f0e942c7562e92fffcee`.

## Non-régressions exécutées

| Contrôle | Résultat |
|---|---:|
| `test:parite-l0-green` | 12/12 vert |
| `verify:mobile-security` | vert |
| `verify:mobile-rbac-live` | vert |
| `verify:mobile-canonical-route-map` | vert |
| `verify:mobile-cta-rbac-alignment` | vert |
| `verify:mobile-home-data-truth` | vert |
| `verify:mobile-ux-v1` | vert |
| `verify:mobile-live-permissions-refresh` | vert |
| `verify:mobile-data-truth` | vert |
| `verify:mobile-network-resilience` | vert |
| `verify:mobile-no-false-writes` | vert |
| `verify:mobile-school-scope-transport` | vert |
| `verify:mobile-l1-offline-reads` | vert (smoke physique non disponible, déjà signalé par le vérificateur) |
| `verify:mobile-canonical-role-identity` | vert |
| `test:form-fields` | vert |
| `verify:mobile-ui-e2e-scaffold` | vert |
| `internalNotificationsC4.test.ts` | vert |
| `pariteL1FinanceUx.test.ts` | vert |
| `financeCurrency.test.ts` | vert |
| Tests Web Finance UX | 81/81 vert |
| Runtime E2E Mobile | 41/41 vert |

## Contrôles non verts sans régression de ce lot

1. Dans ce runtime géré, les wrappers qui lancent `npx tsx` échouent avant leurs assertions sur
   `listen EPERM /tmp/tsx-*/…pipe`. Les mêmes fichiers de tests ont été exécutés directement avec le
   chargeur Node `tsx` et sont verts. La CI GitHub reste l'autorité pour les commandes officielles.
2. `verify:finance-rbac` valide ses 10 tests mémoire puis s'arrête faute de `DATABASE_URL`. Aucun
   backend, schéma PostgreSQL ou contrat RBAC n'est modifié par ce correctif UX.

Ces deux points ne justifient aucune correction hors périmètre L1.

## Limites volontaires

- aucune relance d'impayé sur Mobile ;
- aucun encaissement depuis l'écran Impayés ;
- aucun cache offline du ledger ; hors-ligne est présenté comme indisponible ;
- aucune modification de l'endpoint, de PostgreSQL ou des règles serveur.

Preuve machine : `docs/audits/evidence/parite-l1-green-verify.json`.
