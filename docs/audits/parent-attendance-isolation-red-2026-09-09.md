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

## 3. Matrice RED exécutée sur `1f0ff39a`

Fichiers (aucun correctif de production) :

| Fichier | Résultat |
| --- | --- |
| `backend/lib/classStudentsAuthz.parentIsolation.red.test.js` | 2 RED / 9 suites |
| `backend/services/tenantScopeService.parentIsolation.red.test.js` | 2 RED / 5 cas |
| `backend/lib/parentAttendanceIsolation.http.pg.test.js` | **8 RED / 21** |
| `web/src/pages/PresencesPage.parentIsolation.red.test.tsx` | **4 RED / 4** |

### 3.1 Authz unitaire

| Cas | Statut | Lecture |
| --- | --- | --- |
| P0-1 roster Maeva seule (principal en mémoire) | PASS | `scopeClassStudentsForPrincipal` filtre si `role=Parent` + `studentIds` = `student_code` |
| P0-2 / P0-3 / P0-4 / P0-6 roster / P0-7 / P0-8 | PASS | le garde-fou unitaire existe |
| Parent `GET /classes` sans 2ème B ni `students: 4` | **RED** | `scopeSchoolClassesForPrincipal` ignore Parent → catalogue école |
| `roleKeys: ["PARENT"]` sans `role` | **RED** | `return rows` → roster complet |

### 3.2 TenantScopeService

| Cas | Statut |
| --- | --- |
| Enfant lié conservé | PASS |
| Parent `studentIds: []` → 0 | PASS |
| Inter-établissement | PASS |
| Camarade **sans matricule** (className passthrough) | **RED** — Aisha passe |
| Ligne catalogue `{ className, students }` | **RED** — 2 lignes / 0 attendu |

### 3.3 HTTP PostgreSQL (JWT mint `role=Parent`, `studentIds: ["STU-MAEVA"]`)

Fixture : Maeva + Aisha/Jean/Luc (présent / absent / retard / présent), Sibling en 2ème B, élève école B.

| ID | Endpoint | Statut | Corps observé |
| --- | --- | --- | --- |
| P0-1-classes | `GET /api/classes` | **RED** | **2ème A (`students: 4`) + 2ème B** |
| P0-1-roster | `GET /api/classes/CLS-2A/students` | **RED** | **403** `classe hors périmètre` — Maeva absente |
| P0-1-presences | `GET /api/presences` | **RED** | **`[]`** — Maeva absente |
| P0-3 | `GET /api/students/STU-AISHA/presences` | PASS | `[]` (pas de fuite Aisha) |
| P0-4 | `GET /api/classes/CLS-2B/students` | PASS | 403 / pas Sibling |
| P0-2-roster / roster-b / presences | idem 2 enfants | **RED** | 403 roster, `[]` présences |
| P0-2-classes | `GET /api/classes` | **RED** | effectif 4 + 2ème B |
| P0-5 | `attendanceId` Aisha via liste | PASS | pas dans `[]` |
| P0-6-classes | Parent sans enfant | **RED** | **les 2 classes de l’école** |
| P0-6-roster / présences | Parent sans enfant | PASS | 403 / `[]` |
| P0-7 | Enseignant | PASS | 2ème A seulement |
| P0-8 | Admin School | PASS | roster 4 + présences A, jamais B |
| P0-9 | Parent école B | PASS | pas de données A |

**Cause racine HTTP (develop, pas préprod)** : le filtre Parent unitaire passe, mais le **chemin HTTP** (`hydrateParentPrincipal` + `listClassStudents` / `listSchoolStudents` dont `id = student_code`) **ne rattache pas** le JWT `studentIds: ["STU-MAEVA"]` à l’élève. Résultat fail-closed trop fort pour *son* enfant (403 / `[]`) et **trop faible** pour le catalogue (`GET /classes` = toute l’école).

Ce n’est **pas** le comportement de la capture (roster nominatif + statuts mixtes). La capture exige un `GET /classes/:classCode/students` qui **renvoie les camarades**. Sur `1f0ff39a` ce handler **refuse** le Parent (403). Donc :

- soit l’API préprod **n’est pas** `1f0ff39a` (SHA inconnu) ;
- soit le JWT `papa Maeve` a un `role` non reconnu comme Parent → `return rows` (fuite roster) ;
- soit les `studentIds` préprod matchent *tous* les `student_code` (très improbable).

Sans Bearer `papa Maeve`, on ne tranche pas. On sait déjà que **develop ne démontre pas** l’isolation : le Parent ne lit pas Maeva, et il lit le catalogue de classes.

### 3.4 UI Web

4/4 RED : cartes 2ème A / 2ème B, **Changer de classe**, KPI, camarades (Aisha) via deep-link `attendanceId`, source sans `Mes enfants`. Identique au chunk préprod `PresencesPage-BfynsNOx.js`.

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

- **Endpoint fautif certain sur develop** : `GET /api/classes` — Parent reçoit 2ème A (`students: 4`) + 2ème B. C’est l’autorité des cartes « Changer de classe ».
- **Chemin HTTP Parent cassé sur develop** : `GET /api/classes/:classCode/students` → **403** et `GET /api/presences` → **`[]`** malgré `studentIds: ["STU-MAEVA"]`. Le Parent ne voit pas son enfant. Unitaire OK, HTTP KO (hydratation / clés d’identité).
- **Endpoint fautif pour la capture nominative préprod** : `GET /api/classes/:classCode/students` qui a **renvoyé les camarades**. Ce n’est **pas** le 403 de `1f0ff39a`. Donc API préprod ≠ ce HEAD, **ou** JWT `role` non-Parent (`return rows`).
- **Cause racine UI** : `PresencesPage` n’a pas de mode Parent. Chunk préprod = écran d’appel (`Changer de classe`, `Taux de présence`, pas `Mes enfants`).
- **SHA préprod API** : inconnu. **SHA develop** : `1f0ff39aa02bd0adb09dd4cadfeb9cec4caaca82`.
- **JWT `papa Maeve`** : non rejoué.

Pas de Ready. Pas de merge. Pas d’évolution fonctionnelle Présences tant que le P0 n’est pas vert.
