# P0 sécurité — Isolation Parent / Présences (diagnostic RED)

Date de sonde : 2026-09-09, 21:52 UTC
Branche : `cursor/parent-attendance-isolation-red-d98a`
Décision : **STOP après diagnostic RED.** Aucune correction fonctionnelle. Pas de Ready. Pas de merge.

Mandat CTO : un compte Parent ne doit jamais voir le roster nominatif ni les statuts Présent / Absent / Retard des camarades. Le serveur est l’autorité. Le filtrage UI n’est pas la sécurité.

## 0. Ce que la capture prouve déjà

Un compte **Parent** (« papa Maeve ») voit en préprod :

- la liste nominative de **2ème A** ;
- les statuts **Présent / Absent / Retard** des autres enfants ;
- les **KPI globaux de classe** (taux / présents / absents / retards) ;
- le bouton **Changer de classe** ;
- un écran d’**appel** (roster complet), pas « Mes enfants → présence de l’enfant ».

Ce n’est pas acceptable. Ce document sépare **le défaut observé en préprod** de **ce que `develop` prétend garantir**.

## 1. SHA exacts

### 1.1 `develop`

| Fait | Valeur |
| --- | --- |
| `origin/develop` HEAD | `1f0ff39aa02bd0adb09dd4cadfeb9cec4caaca82` |
| Message | Merge PR #572 (catalogue utilisateurs plateforme), 2026-09-09 23:05:58 +0200 |
| #570 notifications (`5069f602…`) | ancêtre de ce HEAD |

Aucun workflow GitHub de déploiement n’est branché sur ce SHA. Un merge `develop` ≠ préprod à jour.

### 1.2 Web préprod — `https://preprod.somafrik.app`

Sonde 2026-09-09 21:52 UTC :

| Signal | Valeur |
| --- | --- |
| `Last-Modified` `index.html` | **2026-09-09 21:14:06 UTC** |
| `etag` HTML | `W/"38d3c292ec923062982db3e16e381813"` |
| Bundle principal | `/assets/index-xYtRenRs.js` (~230 082 octets) |
| Chunk Présences | `/assets/PresencesPage-BfynsNOx.js` (14 441 octets) |

Empreinte de `PresencesPage-BfynsNOx.js` :

| Marqueur | Présent ? |
| --- | --- |
| `Changer de classe` | **1** |
| `Taux de présence` | **1** |
| `Tous présents` | **1** |
| `Enregistrer l'appel` | **1** |
| `Appel —` | **1** |
| `classStudentsApi` | **1** |
| `Mes enfants` | **0** |
| `Parent` (branche de rôle) | **0** |

Verdict Web préprod : c’est **le même écran d’appel** que `develop` (`PresencesPage.tsx`). Aucune UI Parent. Un `Last-Modified` 21:14 UTC prouve un redéploiement Web, **pas** que le SHA soit `1f0ff39a`. `docs/render.md` exige encore `RENDER_WEB_DEPLOYED_SHA` collé depuis Render.

### 1.3 API préprod — SHA **inconnu**

`GET https://somafrik-api-preprod.onrender.com/api/health` :

```json
{
  "status": "ok",
  "database": "postgresql",
  "version": "1.0.0",
  "attachments": { "ready": true, "required": true, "configured": true, "writable": true }
}
```

Aucun champ `commit` / `sha` / `git`. **Impossible** d’affirmer que l’API préprod exécute `1f0ff39a`. Le JWT de `papa Maeve` n’est pas disponible dans cet environnement : les 4 endpoints n’ont **pas** été rejoués en live contre préprod.

## 2. Où la fuite apparaît réellement

Quatre surfaces, à distinguer.

### 2.1 Endpoint fautif n°1 — `GET /api/classes` (**fuite confirmée sur `develop@1f0ff39a`**)

`backend/server.js` :

```js
res.json(scopeSchoolClassesForPrincipal(req.principal, rows));
```

`scopeSchoolClassesForPrincipal` (`backend/lib/classStudentsAuthz.js`) filtre Super Admin, rôles établissement, puis **Enseignant**. Pour un **Parent**, la fonction tombe dans `return rows` : **toutes les classes de l’école**, avec `students` = effectif d’inscription (ex. 4).

Conséquences :

- le Web hydrate `state.classes` depuis cet endpoint ;
- `buildPresenceClassCards` n’a **aucun** filtre Parent ;
- l’écran affiche les cartes de classe (« 2ème A · 4 élève(s) ») et **Changer de classe**.

C’est déjà suffisant pour reproduire une partie de la capture **sans** fuite de roster.

### 2.2 Endpoint n°2 — `GET /api/classes/:classCode/students` (**contrat présent sur develop, non prouvé en préprod**)

Le handler appelle `scopeClassStudentsForPrincipal` puis `resolveAuthorizedStudentForPrincipal`.

Pour `role === "Parent"` (libellé exact / contenant « parent ») :

- le roster est réduit aux élèves dont une clé (`id`, `publicId`, `matricule`, `studentCode`) est dans `principal.studentIds` ;
- si le filtre est vide → **403** « classe hors périmètre ».

`mapStudentRow` pose `id = publicId = matricule = student_code`. Un JWT Parent qui porte `studentIds: ["STU-MAEVA"]` **doit** donc ne renvoyer que Maeva **sur le code actuel**.

La capture nominative + statuts mixtes exige que **cet endpoint ait renvoyé les camarades** (le Web ne lit le roster que via `classStudentsApi.list`). Causes possibles, par ordre de vraisemblance :

1. **API préprod antérieure** à `scopeClassStudentsForPrincipal` (SHA inconnu).
2. **JWT `role` non reconnu comme Parent** (`role` vide, seul `roleKeys: ["PARENT"]`) → la fonction **retombe sur `return rows`** (roster complet). Test RED dédié.
3. **`studentIds` JWT vides** + hydratation enfants qui échoue : develop actuel doit alors **403**, pas le roster. Si préprod n’a pas ce garde-fou, fuite.
4. Passe-plat `TenantScopeService` : `className && !studentId && !matricule → true` pour **tous** les parents. Nocif si une ligne roster n’a pas de `matricule`.

JWT live `papa Maeve` : **non testé ici**.

### 2.3 Endpoint n°3 — `GET /api/presences` (**fail-closed Parent si le rôle est reconnu**)

Sur develop :

- `TenantScopeService.filterRows(students)` puis intersection des présences ;
- Parent / Élève sans élève scopé → `presenceListStaysStudentScoped` → `[]` ;
- `mapAttendance.studentId = student_code`.

Si le rôle n’est **pas** détecté comme Parent, le filtre « student-scoped » saute et l’établissement entier peut passer (après le scope école). Les statuts mixtes de la capture collent à une **fuite présences** ou à l’UI qui pose « Présent » par défaut (`rollCallInitialStatus`) dès que le roster a fuité.

### 2.4 Endpoint n°4 — `GET /api/students/:id/presences`

`resolveAuthorizedStudentForPrincipal` → élève non autorisé → **`[]` (200), pas 403**. Les données ne fuitent pas si le resolveur est correct, mais ce n’est pas un refus explicite. Un `attendanceId` étranger n’a pas de `GET /presences/:id` : l’accessibilité se joue sur la liste et sur cet endpoint.

### 2.5 UI Web — **pas une autorité, mais elle aggrave**

`web/src/pages/PresencesPage.tsx` est un **seul** écran d’appel pour tous les rôles :

- cartes depuis `state.classes` (donc `GET /api/classes`) ;
- roster depuis `GET /classes/:classCode/students` uniquement ;
- KPI calculés sur ce roster ;
- « Changer de classe », « Tous présents », « Enregistrer l’appel » si `canUpdate`.

Aucune branche `role === "Parent"`. Le chunk préprod le confirme (`Parent: 0`, `Mes enfants: 0`).

### 2.6 Principal JWT `studentIds`

`getPrincipalStudentIds` : Parent = clés des `user.children` (uuid, studentId, publicId, matricule, studentCode), jamais `users.id`.

`hydrateParentPrincipal` ne s’exécute que si `principal.role === "Parent"` **exactement**. Un jeton `parent_student` / `role` manquant n’est pas réhydraté.

Sans JWT `papa Maeve`, on ne peut pas dire si préprod mint `studentIds` vides, des UUID seuls, ou les `student_code`.

## 3. Matrice des tests P0 (contrat)

Fichiers RED (aucun correctif de production) :

| Fichier | Cas |
| --- | --- |
| `backend/lib/classStudentsAuthz.parentIsolation.red.test.js` | P0-1 à P0-8 + catalogue classes Parent + `roleKeys` sans `role` |
| `backend/services/tenantScopeService.parentIsolation.red.test.js` | passe-plat `className`, Parent vide, inter-établissement |
| `backend/lib/parentAttendanceIsolation.http.pg.test.js` | les 4 endpoints, fixture Maeva + 3 camarades + statuts distincts |
| `web/src/pages/PresencesPage.parentIsolation.red.test.tsx` | UI Parent attendue |

Les cas qui **doivent être RED sur `1f0ff39a`** (lecture statique) :

| ID | Contrat | Cause racine actuelle |
| --- | --- | --- |
| P0 GET /classes | Parent ne voit pas 2ème B ni `students: 4` | `scopeSchoolClassesForPrincipal` ignore Parent |
| TenantScope className | ligne classe-seule → 0 | `filterByRoleOwnership` `className && !studentId && !matricule` |
| roleKeys sans role | roster → 403 | `isParentOrStudentRole("")` faux → `return rows` |
| UI Parent | pas de Changer de classe / KPI / camarades | `PresencesPage` unique écran d’appel |

Les cas que **develop prétend déjà tenir** (à confirmer par l’exécution HTTP) :

| ID | Contrat attendu sur develop si JWT `role=Parent` + `studentIds` peuplés |
| --- | --- |
| P0-1 roster / présences | Maeva seule |
| P0-3 / P0-5 | Aisha / `PRES_AISHA` inaccessibles |
| P0-4 | `CLS-2B` → 403 ou [] |
| P0-6 présences | Parent sans enfant → `[]` |
| P0-7 | Enseignant borné à ses affectations |
| P0-8 | Admin School = classe complète, jamais école B |
| P0-9 | Parent école B ≠ données école A |

Tant qu’un test JWT réel `papa Maeve` n’a pas été rejoué sur les 4 URLs préprod, **le problème n’est pas clos**.

## 4. Confinement immédiat préprod (recommandé, non implémenté)

Tant que cette matrice n’est pas verte **et** que le JWT `papa Maeve` n’a pas été prouvé :

1. **Désactiver l’entrée Parent « Appels & présences »** (`/presences` dans `web/src/lib/constants.ts`, vue `presences`) — confinement UX seulement.
2. **Côté API (autorité)** : refuser `GET /api/classes`, `GET /api/classes/:classCode/students`, `GET /api/presences` pour `role` Parent / `roleKeys` PARENT tant que le P0 n’est pas vert. Fail-closed, pas un filtre UI.
3. Coller `RENDER_WEB_DEPLOYED_SHA` et `RENDER_API_DEPLOYED_SHA` (contrat `docs/render.md`).
4. Rejouer les 4 GET avec le Bearer de `papa Maeve` et archiver les corps.

Ce confinement n’est **pas** dans cette PR : le mandat est STOP après RED.

## 5. Après ce P0 — même règle partout

Dès que Présences est vert, appliquer le **même contrat** (tests RED d’abord) à :

- **Notes** — `GET /api/notes`, `GET /api/students/:id/notes` ;
- **Bulletins** — `GET /api/students/:id/report` (+ PDF) ;
- **Paiements** — `GET /api/students/:id/payments` et listes finance.

Invariant unique : un Parent ne voit que ses enfants. Zéro camarade, zéro fallback établissement, zéro fuite inter-établissement.

## 6. Décision

- **Endpoint fautif certain sur develop** : `GET /api/classes` via `scopeSchoolClassesForPrincipal` (Parent = catalogue école).
- **Endpoint fautif certain pour la capture nominative** : `GET /api/classes/:classCode/students` **en préprod** (le Web n’a pas d’autre source de roster). Sur develop le garde-fou existe **si** `role` est Parent et `studentIds` correspondent aux `student_code`.
- **Cause racine UI** : `PresencesPage` n’a pas de mode Parent ; le chunk préprod est cet écran d’appel.
- **SHA préprod API** : inconnu. **SHA develop** : `1f0ff39aa02bd0adb09dd4cadfeb9cec4caaca82`.
- **JWT `papa Maeve`** : non rejoué.

Pas de Ready. Pas de merge. Pas d’évolution fonctionnelle Présences tant que le P0 n’est pas vert.
