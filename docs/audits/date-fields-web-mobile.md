# Audit CTO — Dates Web / Mobile

## Décision

Somafrik applique un contrat unique pour les dates visibles par l'utilisateur : **JJ-MM-AAAA**.

- UI : `JJ-MM-AAAA` (ex. `17-09-2026`)
- date civile API / PostgreSQL : `YYYY-MM-DD`
- horodatage technique : ISO 8601
- une date civile n'est jamais convertie implicitement en UTC
- les heures métier restent affichées après la date lorsqu'elles sont nécessaires

L'inventaire exhaustif généré par la CI se trouve dans `docs/audits/date-fields-web-mobile.generated.md`.

## Résultat de l'audit statique

| Périmètre | Résultat |
|---|---:|
| Fichiers candidats contenant des usages de date | 189 |
| Web | 126 |
| Mobile Expo / React Native | 63 |
| Inputs / surfaces calendrier natives détectées | 19 |
| Violations directes D1 / D7 après correction | 0 |

## Anomalies traitées

| Classe | Constat | Traitement |
|---|---|---|
| D1 | Affichages / placeholders avec séparateur `/` ou format non uniforme | Contrat `JJ-MM-AAAA` centralisé |
| D4 | Web et Mobile avaient des formatteurs locaux différents | Helpers équivalents `dates.ts` sur les deux plateformes |
| D5 | Parsing civil susceptible de passer par des conversions implicites | Conversion par composantes année/mois/jour |
| D6 | Risque de changement de jour pour une date civile ISO | Les chaînes `YYYY-MM-DD` sont traitées comme dates civiles, pas comme timestamps UTC |
| D7 | `Intl.DateTimeFormat` / `toLocaleDateString` dupliqués dans plusieurs écrans | Remplacement par les helpers centralisés pour les dates utilisateur |
| D8 | JavaScript pouvait normaliser une date impossible (`29-02-2027` -> mars) | Validation stricte des composantes calendaires Web et Mobile |

## Composants et dépendances

### Web

Le composant calendrier existant `web/src/components/ui/DatePicker.tsx` est réutilisé. Son contrat interne reste `YYYY-MM-DD` afin de conserver la compatibilité avec les formulaires/API, tandis que son affichage utilisateur est `JJ-MM-AAAA`.

Aucune nouvelle bibliothèque de calendrier n'est nécessaire. `date-fns` était déjà présent dans le projet mais le contrat de date civil est volontairement centralisé dans `web/src/lib/dates.ts` pour éviter les conversions de fuseau implicites.

### Mobile

Aucune nouvelle dépendance native n'est ajoutée. Le contrat est centralisé dans `Mobile/src/lib/dates.ts`; les calendriers/écrans existants conservent leur navigation native ou métier et passent par les helpers communs pour les dates complètes visibles.

## API publique des dates

Les deux plateformes disposent du même contrat conceptuel :

- `formatDateForDisplay()`
- `formatDateTimeForDisplay()`
- `isValidDisplayDate()`
- `parseDisplayDate()`
- `toApiDate()`
- `fromApiDate()`
- `DISPLAY_DATE_HINT = "JJ-MM-AAAA"`

## Exceptions légitimes

Ne sont pas considérés comme des affichages `JJ-MM-AAAA` :

- libellés de navigation calendrier tels que `Septembre 2026` ;
- noms de fichiers techniques utilisant une date ISO ;
- timestamps ISO persistés / transportés sans affichage direct ;
- clés et calculs internes nécessitant `Date` ou epoch.

## Tests contractuels

Les tests Web et Mobile couvrent notamment :

- `2026-09-17` -> `17-09-2026` ;
- `2026-01-05` -> `05-01-2026` ;
- zéros initiaux ;
- `29-02-2028` valide ;
- `29-02-2027` invalide ;
- `31-02-2026` invalide ;
- `32-13-2026` invalide ;
- valeurs vides / nulles / invalides ;
- date ISO seule ;
- timestamp ISO ;
- conversion `JJ-MM-AAAA` -> `YYYY-MM-DD` ;
- absence de décalage de jour pour une date civile.

## Gate de non-régression

`.github/workflows/date-ui-contract.yml` exécute :

1. le contrôle / refactor déterministe du contrat de date ;
2. la validation stricte des dates civiles ;
3. la régénération de l'inventaire ;
4. le scanner statique Web / Mobile ;
5. les tests contractuels Web ;
6. les tests contractuels Mobile ;
7. le build Web ;
8. le typecheck Mobile.

Toute réintroduction d'un format utilisateur divergent détectable fait échouer la gate.
