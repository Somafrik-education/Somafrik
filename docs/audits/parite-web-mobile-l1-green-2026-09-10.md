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

## Contrôles non verts sans régression de ce lot

1. `verify:mobile-usability` atteint tous ses sous-tests puis échoue sur une assertion historique
   exigeant directement `toLocaleString("fr-FR")` dans `PaymentReceiptCard.tsx`. Ce fichier utilise
   déjà `formatFinanceAmount` sur la base et n'est pas modifié par le Lot 1.
2. Le `typecheck` racine valide la syntaxe Backend, puis ne peut pas lancer le typecheck Web car
   les dépendances `web/node_modules` ne sont pas installées dans l'environnement. Aucun fichier Web
   ou Backend n'est modifié. Le typecheck Mobile est vert.

Ces deux points ne justifient aucune correction hors périmètre L1.

## Limites volontaires

- aucune relance d'impayé sur Mobile ;
- aucun encaissement depuis l'écran Impayés ;
- aucun cache offline du ledger ; hors-ligne est présenté comme indisponible ;
- aucune modification de l'endpoint, de PostgreSQL ou des règles serveur.

Preuve machine : `docs/audits/evidence/parite-l1-green-verify.json`.
