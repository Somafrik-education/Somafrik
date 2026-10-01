# ADMIN-03A — Relations : audit de périmètre et barrière données personnelles

**Statut :** DRAFT / HOLD — PAS READY — PAS MERGE  
**Lot :** AUDIT UNIQUEMENT  
**Branche :** `cursor/admin-03a-relations-scope-audit-94fc`  
**Base `origin/develop` :** `2ba3c7d75d20d2d2c0df9c0f50e9b91df124165d` (merge #858)  
**`origin/main` :** `ef8bc9517ffc94aa770743713d0f561f92a9fc1e`  
**#858 ancêtre de develop :** oui (identique)  
**Audit de référence initial :** #851  
**Migrations :** NON  
**Code métier modifié :** NON  
**`platformPersonalDataGuard` modifié :** NON  

Objectif : décider ce que doit être Administration > Relations pour SUPER_ADMIN / COUNTRY_ADMIN / SCHOOL_ADMIN **sans** élargir l’accès Superadmin aux données personnelles scolaires.

Légende des états : **A** fonction E2E réelle · **B** partielle · **C** façade UI · **D** volontairement interdite.

Machine-readable : [`evidence/admin03-relations-matrix.json`](./evidence/admin03-relations-matrix.json).

---

## 1. Architecture actuelle

Relations n’est pas un module `/api/relations`. Le canonique est le couple **CRM backoffice** + **liaison parent**.

```text
UI AdministrationLayout (onglet toujours listé)
  → /administration/relations
  → PermissionRoute view="relations"
  → EntityPage entity="relations"
      GET  clientsApi.listRelations  → GET  /api/backoffice/relations
      POST clientsApi.createRelation → POST /api/backoffice/relations
      delete Admin                   → patch local (stripClientClients, pas d’API)
UI Établissement / fiche élève
  → /etablissement/relations-parent-enfant (même EntityPage, mode parentChild)
  → parentsApi.list / link / archiveRelation
      GET    /api/parents/identity
      GET    /api/parents/relations?studentId=
      POST   /api/parents/link
      PATCH  /api/parents/relations/:relationId   (archive only)
  → requireAuth
  → requirePermission (routePermissions)
  → isPlatformPersonalDataForbidden  (AVANT some())
  → clientsService / parentLinking
  → clientsPgStore
  → PostgreSQL contact_relations (+ contacts, students, users, schools)
  → relecture UI via refresh(["relations", …])
```

**Auth :** JWT `requireAuth`.  
**Permission catalogue :** `Relations:READ|CREATE|UPDATE` ou `Gérer utilisateurs` ou jetons plateforme.  
**Guard personnel :** `SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM` refuse SUPER_ADMIN et COUNTRY_ADMIN même avec `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES` / `schoolCode` valide.  
**Scope école :** `assertSchoolScope` + `tenantScopeService.filterRows` + égalité `contact.school_code` / `student.school_id`.  
**Pas de PATCH/DELETE** sur `/api/backoffice/relations`.

Seed catalogue (`backend/data.js`) : Superadmin / Admin Pays = `-` sur Relations ; Admin School = `CRUD` ; Préfet / Secrétaire = `R`.

---

## 2. Données personnelles concernées

Sont personnelles, au sens de la barrière plateforme :

| Surface | Champs |
|---|---|
| Projection backoffice `mapRelationRow` | `fromContactName`, `toStudentName`, `fromContactId`, `toStudentId`, `relationType`, `schoolCode`, `status` |
| `GET /api/parents/relations` | + `firstName`, `lastName`, `phone`, `email`, `name` |
| `contacts` (nécessaire au rattachement) | nom, téléphone, email, adresse, `user_id` |
| `students` | identité élève |
| `users` / `user_roles` | compte PARENT créé par `POST /api/parents/link` |

Le **type de relation** relie deux personnes d’un établissement : ce n’est pas une métrique anonyme.

`GET /api/backoffice/relations` n’expose pas téléphone/email (ils restent sur `contacts` et sur la liste parents). Ce n’est pas un agrégat : les **noms** suffisent à identifier des mineurs et des responsables.

---

## 3. Matrice rôles / actions

| ACTION | SUPER_ADMIN | COUNTRY_ADMIN | SCHOOL_ADMIN | AUTRE RÔLE | API | DB | GUARD | ÉTAT |
|---|---|---|---|---|---|---|---|---|
| Ouvrir l’onglet Relations | **C** | **C** | **A** | D (sauf jeton) | GET backoffice | `contact_relations` | FORBIDDEN | UI ouverte / API 403 |
| Liste | **D** | **D** | **A** | B/D | GET `/api/backoffice/relations` | SELECT | FORBIDDEN | isolation école |
| Création | **D** | **D** | **A** | D sauf `Relations:CREATE` | POST backoffice / `parents/link` | INSERT | FORBIDDEN | persisté |
| Détail | **D** | **D** | **B** | D | même GET liste | ligne | FORBIDDEN | pas de GET `/:id` |
| Update champs | **D** | **D** | **C** | D | PATCH backoffice **absent** | — | — | incomplet |
| Delete UI Admin | **D** | **D** | **C** | D | aucune | — | strip PUT | local non persisté |
| Archive | **D** | **D** | **B** | D | PATCH `parents/relations/:id` | `status=archived` | FORBIDDEN | persisté hors Admin liste |
| Rattachement élève / responsable | **D** | **D** | **A** | D | POST create / link | FK student/contact | FORBIDDEN | |
| Téléphone / email / adresse | **D** | **D** | **A** | D | contacts + parents GET | `contacts` | FORBIDDEN | |
| Nav fiche élève | **D** | **D** | **A** | B (`Élèves:READ` / Voir enfant) | GET parents/relations | JOIN | FORBIDDEN | `studentId` requis |
| Nav Administration | **C** | **C** | **A** | D | — | — | — | TabNav non filtré |

---

## 4. Endpoints

| Méthode | Route | Auth | Permission | Guard | Service | PG | Notes |
|---|---|---|---|---|---|---|---|
| GET | `/api/backoffice/relations` | JWT | Relations:READ / Gérer utilisateurs / *PRIVILEGES | OUI | `listClientsProjection` + `filterRows` | `contact_relations` | liste |
| POST | `/api/backoffice/relations` | JWT | Relations:CREATE / … | OUI | `createRelation` → `ensureActiveParentRelation` | INSERT | persisté |
| GET | `/api/parents/identity` | JWT | Relations:CREATE / … | OUI | `lookupParentIdentity` | users/contacts | PII |
| GET | `/api/parents/relations` | JWT | Relations:READ / Élèves:READ / … | OUI | `listParentRelations` | JOIN contacts | phone/email |
| POST | `/api/parents/link` | JWT | Relations:CREATE / … | OUI | `linkParent` | contacts+users+relations | persisté |
| PATCH | `/api/parents/relations/:relationId` | JWT | Relations:UPDATE/CREATE / … | OUI | `archiveParentRelation` | `status=archived` | **pas** d’update champs |
| PATCH | `/api/backoffice/relations` | — | — | — | — | — | **ABSENT** |
| DELETE | `/api/backoffice/relations` | — | — | — | — | — | **ABSENT** |

Contournements inventoriés (tous déjà FORBIDDEN plateforme) :  
`GET/POST/PATCH /api/backoffice/contacts*`, `GET /api/students`, `GET /api/students/:id`, `GET /api/data-export`, `GET /api/audit`.

Aucun autre `app.(get|post|patch|put|delete)("/api/…relations` hors de cette liste.

---

## 5. Tables PostgreSQL

Aucune migration dans ADMIN-03A. Tables **réellement** utilisées :

### `contact_relations` (cœur)

| Colonne | Rôle |
|---|---|
| `id` UUID PK | |
| `school_id` UUID NOT NULL → `schools(id)` | tenant école |
| `country_id` UUID NOT NULL → `countries(id)` | tenant pays |
| `relation_type` TEXT default `parent_student` | type |
| `contact_id` UUID NOT NULL → `contacts(id)` | responsable |
| `student_id` UUID NOT NULL → `students(id)` | élève |
| `status` TEXT default `active` | active / archived |
| `profile_payload` JSONB | noms projetés (`fromContactName`, `toStudentName`) |
| `legacy_json_id` | legacy |
| `created_at` / `updated_at` | |

Index unique actif : `uq_contact_relations_active` sur `(school_id, contact_id, student_id)` (contrainte runtime `ensureParentLinkingConstraints`, pas recréée dans `CLIENTS_SCHEMA_SQL`).

### Liées

| Table | Lien | Données |
|---|---|---|
| `contacts` | `contact_id` | noms, phone, email, address, `user_id`, `school_id` |
| `students` | `student_id` | élève, `school_id` |
| `users` | `contacts.user_id` | compte responsable |
| `user_roles` | `user_id` + `PARENT` | accès parent, pas un rôle Administration |
| `schools` | `school_id` | tenant |
| `countries` | `country_id` | tenant |
| `audit_logs` | `create_relation` / `archive_relation` | écriture école ; lecture `GET /api/audit` FORBIDDEN plateforme |

Pas de table séparée « responsables légaux » : le responsable **est** un `contacts` de type parent, éventuellement provisionné en `users`.

---

## 6. Protections

Fichier : `backend/lib/platformPersonalDataGuard.js`.

1. **Quelles données Relations sont personnelles ?**  
   Identité des deux personnes + lien + coordonnées contact + compte parent. Voir §2.

2. **Pourquoi SUPER_ADMIN est refusé ?**  
   `isPlatformAdminPrincipal` (rôle / `roleKeys` SUPER_ADMIN ou COUNTRY_ADMIN) + route dans `SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM`. Deny **avant** `requiredPermissions.some(...)`. `ALL_PRIVILEGES`, `COUNTRY_PRIVILEGES` et un `schoolCode` valide ne passent pas.

3. **L’interdiction s’applique-t-elle à lecture / création / patch / suppression / exports ?**  
   Oui aux six routes Relations (GET liste, POST create, GET identity, GET parents, POST link, PATCH archive). Oui à `GET /api/data-export` et `GET /api/audit`. Pas de DELETE Relations à interdire (endpoint absent).

4. **Contournement indirect ?**  
   Non trouvé sur un endpoint Relations hors liste. Contacts, élèves, export et audit sont dans la même barrière. `filterRows` Superadmin sans scope école **retournerait toutes les lignes** si le deny était retiré — risque latent, aujourd’hui masqué par le 403.

5. **Fuite UI / cache / log / audit ?**  
   - UI : onglet + `canLinkParent(true)` Superadmin / Country = façade ; l’API ne renvoie pas le payload.  
   - Cache client : `relations` est stripé du `PUT` state (`stripClientClientsFromPutPayload`) — un delete Admin n’écrit pas en PG.  
   - Audit : `create_relation` / `archive_relation` enregistrent `mapRelationRow` (noms) pour l’acteur école ; Superadmin ne peut pas `GET /api/audit`.  
   - `WEB_SCHOOL_DOMAIN_FEATURES` inclut Messages mais **pas** Relations : d’où la façade, alors que Messages a déjà été fermé côté Web.

**Ne pas modifier ces protections dans ADMIN-03A.**

`assertSchoolScope` : SCHOOL_ADMIN sans code / `*` / école B → `403 TENANT_MISMATCH`. Superadmin / CountryAdmin : code vide ou `*` **autorisé** au niveau service (d’où le latent § REL-10).

---

## 7. RED / GREEN (REL-01 → REL-10)

Tests : `backend/lib/admin03aRelationsScope.audit.test.js`, `web/src/lib/admin03aRelationsScope.audit.test.ts`.  
Aucun code métier n’a été changé pour les verdir.

| ID | Scénario | Résultat | Preuve |
|---|---|---|---|
| REL-01 | SUPER_ADMIN ouvre Relations | **GREEN-FAÇADE (C)** | `canReadView=true` ; API GET 403 |
| REL-02 | SUPER_ADMIN GET PII école | **GREEN-DENY (D)** | relations + contacts + students + export + audit |
| REL-03 | SUPER_ADMIN POST | **GREEN-DENY (D)** | POST backoffice + `parents/link` |
| REL-04 | SUPER_ADMIN PATCH | **GREEN-DENY (D)** | PATCH backoffice absent ; parents PATCH 403 |
| REL-05 | SUPER_ADMIN DELETE/archive | **GREEN-DENY (D)** | DELETE absent ; archive 403 |
| REL-06 | SCHOOL_ADMIN lit son école | **GREEN (A)** | `filterRows` |
| REL-07 | SCHOOL_ADMIN crée dans son école | **GREEN (A)** | RBAC POST + `createRelation` persisté |
| REL-08 | SCHOOL_ADMIN école B | **GREEN (D)** | `assertSchoolScope` 403 |
| REL-09 | relation A depuis B | **GREEN (D)** | `filterRows` exclut A |
| REL-10 | schoolId / scope invalide | **GREEN école / LATENT plateforme** | SCHOOL_ADMIN fail-closed ; Superadmin `assertSchoolScope` ouvert **si** le guard disparaît |

Pas de test métier RED à « corriger » : l’absence de PATCH/DELETE backoffice est l’état actuel, documenté.

---

## 8. Incohérences UI / API

Administration liste **toujours** l’onglet Relations (`AdministrationLayout` — aucun filtre de rôle).  
Le parent `/administration` est `PermissionRoute view="users"` (Superadmin autorisé).  
L’enfant `/administration/relations` est `view="relations"` :

- Superadmin : `SUPER_ADMIN_ALLOWED_VIEWS` contient `relations` **et** `SUPER_ADMIN_ALLOWED_FEATURES` contient `Relations`.
- Country Admin : `canManageContactsByRole("Admin Pays")` = true → `hasBackOfficePermission(Relations)` = true, **avant** le filtre pays.
- School Admin : rôle CRM + jetons Relations.

**Verdict :** ce n’est **pas** une fonction E2E Superadmin. C’est une **façade UI** + une **erreur de filtrage par rôle** (allowlist héritée du CRM plateforme, comme Contacts). Ce n’est pas une fonctionnalité produit définie pour le Superadmin : le catalogue seed dit déjà `-`. C’est une fonction **destinée au SCHOOL_ADMIN** (et, en lecture, Préfet/Secrétaire).

Messages a été retiré du domaine Web Superadmin ; Relations n’a pas suivi.

**ADMIN-03A n’a pas masqué l’onglet.**

`canLinkParent` retourne `true` pour Superadmin / Country Admin alors que `POST /api/parents/link` est 403 — même classe d’incohérence.

---

## 9. Create / update / delete réel (post-#858)

Confirmé sur develop `2ba3c7d7` :

| Opération | Endpoint | UI | PostgreSQL |
|---|---|---|---|
| **Create** | `POST /api/backoffice/relations` + `POST /api/parents/link` | EntityPage appelle **toujours** `createRelation` (même en édition) | `ensureActiveParentRelation` INSERT / réactive |
| **Update champs** | **aucun** PATCH backoffice | formulaire peut afficher type / principal / statut | **non persisté** ; `isPrincipal` n’est pas une colonne |
| **Delete Admin** | **aucun** DELETE | `deleteEntityFromState` + audit client | **non persisté** (`relations` retiré du PUT) |
| **Archive** | `PATCH /api/parents/relations/:id` | mode parent-enfant uniquement | `status=archived` uniquement |

L’audit initial #851 reste juste : create existe ; update incomplet/absent ; delete UI Admin local.

---

## 10. Risques

1. Superadmin / Country Admin **voient** l’onglet et croient avoir un droit — 403 à l’appel.  
2. Si `SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM` était retiré, `filterRows` Superadmin sans scope école **listerait toutes les relations** (noms d’élèves/parents).  
3. `assertSchoolScope` Superadmin accepte `""` / `*` : le fail-closed n’est **pas** au service, seulement au guard.  
4. `canLinkParent` UI Superadmin = vrai : risque de CTA qui échoue, pas de fuite API.  
5. Delete Admin donne une impression de suppression persistée.  
6. Update « Parent principal » / type : UI seulement.  
7. Option C (support) recréerait un canal PII hors barrière — **interdit**.  
8. Contacts reste dans `SUPER_ADMIN_ALLOWED_FEATURES` (même famille de façade ; hors lot).

---

## 11. Options A / B / C

### OPTION A — Relations = données établissement

Superadmin n’accède pas aux personnes. Onglet visible uniquement aux rôles école autorisés (Admin School, et lecture Préfet/Secrétaire selon catalogue).

| | |
|---|---|
| Avantages | Aligne UI, seed `-`, et barrière API. Zéro nouveau endpoint. Privacy maximale. |
| Risques | Superadmin perd une façade déjà non fonctionnelle. Support école reste le canal humain. |
| Privacy | Aucun nom / téléphone / email plateforme. |
| Backend | Aucun changement de guard. Éventuel durcissement `assertSchoolScope` Superadmin (fail-closed) **sans** ouvrir la lecture. |
| UI | Filtrer `ADMINISTRATION_TABS` + retirer `relations` / `Relations` des allowlists Superadmin ; aligner `canLinkParent`. |
| Audit | Journaliser le changement de visibilité, pas un accès PII. |
| Tests | REL-01 devient D aussi côté UI ; REL-02–05 restent D ; REL-06–10 inchangés. |

### OPTION B — Métriques non personnelles Superadmin

Compteurs : nombre de relations, types, anomalies, complétude — **sans** noms / téléphones / emails.

| | |
|---|---|
| Avantages | Observatoire plateforme sans casser la barrière personnes. |
| Risques | Agrégat trop fin (école de 2 élèves) peut ré-identifier. Tentation d’ajouter un « détail ». |
| Privacy | Acceptable seulement si seuils + pas d’identifiant personne + pas d’export nominatif. |
| Backend | **Nouvel** endpoint agrégé (hors FORBIDDEN ou explicitement PLATFORM_ALLOWED). Interdit de réutiliser GET `/api/backoffice/relations`. |
| UI | Onglet Superadmin = dashboard agrégé, pas `EntityPage` personnes. |
| Audit | Chaque lecture agrégée tracée (école, pas personne). |
| Tests | Contrats : payload sans `fromContactName` / phone / email ; Superadmin toujours 403 sur les 6 routes actuelles. |

### OPTION C — Accès exceptionnel support / audit

Mécanisme explicite, fortement tracé.

**INTERDIT d’implémenter.** Conservé uniquement comme option produit à **ne pas** ouvrir dans ADMIN-03B sans mandat CTO séparé.

| | |
|---|---|
| Avantages | Debug incident nominatif. |
| Risques | Contournement structurel de `SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM`. Fuite, abus, pression support. |
| Privacy | Élevée (PII mineurs + parents). |
| Backend | Bypass ou route dédiée — **non autorisé**. |
| UI | Impersonation / vue école — **non autorisé**. |
| Audit | Même un journal parfait ne justifie pas l’ouverture ici. |
| Tests | N/A — ne pas écrire de test « vert » d’accès Superadmin PII. |

---

## 12. Recommandation technique factuelle

**Recommander A comme défaut.**

Raisons factuelles, pas produit :

- La barrière API et le seed catalogue **interdisent déjà** Superadmin / Country Admin.
- L’onglet actuel est une façade, pas un produit E2E.
- `filterRows` Superadmin est fail-**open** : tout élargissement GET Relations serait un accès multi-écoles aux noms.
- B est possible plus tard **uniquement** via un nouvel endpoint agrégé, jamais en réutilisant GET `/api/backoffice/relations`.
- C n’est pas une option d’implémentation.

ADMIN-03A ne tranche pas le wording produit ; il constate que **transformer SUPER_ADMIN en droit d’accès aux personnes serait un changement de politique privacy**, pas un « fix » d’onglet.

---

## 13. Découpage proposé ADMIN-03B

Sous réserve de décision CTO A ou B :

**Commun (quel que soit A/B)**

1. Ne pas toucher `platformPersonalDataGuard` ni les 6 routes FORBIDDEN.  
2. Aligner `canLinkParent` / `canArchiveParentRelation` sur le deny plateforme.  
3. Documenter create=oui / update champs=non / delete Admin=local.  
4. Tests de non-régression REL-02–10.

**Si A**

5. Retirer `relations` et `Relations` des allowlists Superadmin (web + mobile).  
6. Filtrer l’onglet Administration pour les rôles école autorisés (ne pas le laisser à Superadmin / Country).  
7. Optionnel : fail-closed `assertSchoolScope` Superadmin **sans** ouvrir la lecture.

**Si B**

8. Nouvel endpoint agrégé (counts / types / anomalies) sans PII, scoped, audité.  
9. UI Superadmin dédiée — **pas** `EntityPage entity="relations"`.  
10. Contrats payload : interdiction de noms / phone / email / ids personnes.

**Hors 03B sauf mandat séparé**

- PATCH champs Relations.  
- DELETE persisté (préférer archive déjà existante).  
- Option C.  
- Documents / Conformité / RBAC ADMIN-01/02.  
- Élargissement Contacts Superadmin.

---

## Interdictions respectées

- `platformPersonalDataGuard` inchangé  
- Pas d’accès personnel Superadmin  
- Pas de bypass support  
- Pas de migration  
- Pas de nouvel endpoint métier  
- Pas de PATCH/DELETE Relations implémenté  
- Pas de Documents / Conformité / ADMIN-01/02  
- Pas de production / `main`  
- Pas de refactor opportuniste
