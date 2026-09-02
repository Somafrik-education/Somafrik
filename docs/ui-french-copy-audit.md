# Audit P1 — francisation des interfaces utilisateur

Base auditée : `develop@1a60633dc0cadbb2a65ba3dc69228a861c76c793`.

## Règle

Les valeurs techniques restent canoniques dans le code et les API (`Teachers`, `school_admin`, `active`, `READ`, `CREATE`, `UPDATE`, `DELETE`, etc.). Seule leur présentation à l'utilisateur est francisée.

Termes techniques acceptés lorsqu'ils sont nécessaires : PostgreSQL, API, RBAC, JWT, QR, NFC, URL, PDF, Expo, Android, iOS, Somafrik, Mobile Money et codes système explicitement présentés comme techniques.

## Écarts corrigés

| Zone | Avant | Après |
| --- | --- | --- |
| Mobile — en-tête Enseignants | `Teachers` | `Enseignants` |
| Mobile — cycle de vie Enseignants | `GRANT/REVOKE`, `Web-only` | `attribution et retrait des droits`, `uniquement sur le Web` |
| Mobile — matrice RBAC | `Admin School` affiché brut | `Administrateur d’établissement` |
| Mobile — statuts métier | `active`, `pending`, etc. affichés bruts | `Actif`, `En attente`, etc. |
| Mobile — actions CRUD | `Creer` | `Créer` |
| Web — matrice RBAC | `CREATE / READ / UPDATE / DELETE` | `Création / Lecture / Modification / Suppression` |
| Web — rôles et portées | `role_key`, `scope`, statuts techniques exposés | libellés métier français ; code technique conservé comme tel |
| Web — recherche globale | rôle technique brut | libellé de rôle français |
| Web — couverture produit | `Dashboards`, `Super Admin` | `Tableaux de bord`, `Super administrateur` |

## Garde-fou

`scripts/verify-ui-french-copy.js` inspecte les copies utilisateur dans `Mobile/src` et `web/src`, hors tests, et bloque notamment le retour de :

- noms de modules anglais (`Teachers`, `Students`, `Payments`, `Settings`, `Dashboard`, etc.) ;
- actions fonctionnelles anglaises (`Save`, `Cancel`, `Delete`, `Create`, etc.) ;
- statuts anglais exposés (`Active`, `Pending`, `Archived`, etc.) ;
- `GRANT/REVOKE` et `Web-only` ;
- en-têtes CRUD anglais dans la matrice Web.

Le workflow `UI French Copy` exécute deux gates : `CI / verify:ui-french-copy` et `Security / verify:ui-french-copy`.

## Hors périmètre

- Aucun changement des routes, enums, clés JSON, noms de colonnes ou contrats API.
- Aucun changement du BackOffice legacy.
- Aucun remplacement aveugle des identifiants techniques internes.
