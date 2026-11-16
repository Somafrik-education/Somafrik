# ADMIN-06A — Conformité : audit autorité, périmètre et workflows

**Statut : DRAFT / HOLD — PAS READY — PAS MERGE**

Base obligatoire : `develop@4fdc842e173c4d13121ef42cdad60762a1b4fdba`

Aucune correction fonctionnelle. Aucune migration. Aucun nouvel endpoint.
Aucun changement de `platformPersonalDataGuard.js`. Aucun élargissement Superadmin.
Aucun ajout de `reports` dans `SUPER_ADMIN_ALLOWED_VIEWS` ni de Rapports dans `SUPER_ADMIN_ALLOWED_FEATURES`.
`GET /api/audit` n’est **pas** ouvert au Superadmin.

Preuve machine : `docs/audits/evidence/admin06a-compliance-matrix.json`

## Décision à instruire (pas implémentée)

**Option A recommandée** — séparer gouvernance plateforme NON-PII (A1) et conformité établissement (A2).

Option B (pas de Conformité plateforme, onglet masqué Superadmin) reste acceptable si A1 n’a pas de source non-PII réelle.

**Option C interdite** : Superadmin sur les données de conformité établissement (journaux, demandes, exports, old/new).

---

## 1. Architecture actuelle

Conformité n’est **pas** un module métier.

```
Web  /administration          PermissionRoute view="users"
  └─ AdministrationLayout     tabs.filter(canReadView(ctx, tab.view))
       └─ /administration/conformite
            PermissionRoute view="reports"
            ReportsPage = MVP_COVERAGE (statique)
```

APIs adjacentes, hors UI Conformité :

| Route | Auth | Guard plateforme | Usage UI Conformité |
|---|---|---|---|
| `GET /api/audit` | requireAuth + requirePermission | **deny** | aucun |
| `POST /api/privacy/erasure-requests` | public (rate-limit) | — | `/suppression-compte` seulement |
| `GET /api/privacy/erasure-requests` | auth + Utilisateurs:READ | **deny** | aucun |
| `POST …/self/execute` | requireAuth | **hors liste** | aucun |
| `POST …/:requestId/execute` | auth + Utilisateurs:UPDATE | **deny** | aucun |
| `GET /api/data-export` | auth + settings READ | **deny** | aucun |
| `GET /api/v2/reports/advanced` | auth + Rapports:READ | **deny** | aucun |

Stockage : `audit_logs` (PG), `privacy_requests` (PG) + Map mémoire `FallbackRepository`.

---

## 2. Matrice rôles / routes

Légende : **A** opérationnel · **B** partiel · **C** façade · **D** interdit / inaccessible.

| Fonction | SUPER_ADMIN | COUNTRY_ADMIN | SCHOOL_ADMIN | utilisateur établissement | self |
|---|---|---|---|---|---|
| Voir Conformité | **D** onglet masqué | **C** onglet + MVP | **C** onglet + MVP | **C** si Rapports:READ sinon **D** | **D** |
| Audit logs | **D** guard | **D** guard | **D** pas Audit:READ | **D** handler si Audit:READ | **D** |
| Créer demande effacement | **B** POST public | **B** POST public | **A** | **A** page publique | **A** |
| Lister demandes | **D** | **D** | **A** JWT école | **B** si Utilisateurs:READ | **D** |
| Exécuter demande | **D** | **D** | **A** même école | **D** autre école | **A** si isSelf |
| Auto-effacement | **B** self compte plateforme | **B** | **A** | **A** | **A** |
| Export données | **D** | **D** | **A** JWT | **B** si settings READ | **D** |
| Rapports avancés | **D** guard | **D** guard | **B** agrégats globaux | **B** si Rapports:READ | **D** |
| Agrégats plateforme non-PII | **D** n’existe pas | **D** | **D** | **D** | **D** |

Preuves : `web/src/lib/permissions.ts`, `superAdminAccess.ts`, `AdministrationLayout.tsx`, `backend/server.js`, `platformPersonalDataGuard.js`, `privacyErasure.js`, `dataExportManagement.js`, `rbacService.js`.

---

## 3. Matrice données / PII

### `audit_logs` (schéma réel)

| Champ | Classification |
|---|---|
| `id` | plateforme non-PII |
| `school_id` | donnée établissement |
| `user_id` | donnée personnelle (identifiant interne) |
| `action` | plateforme non-PII (verbe) |
| `entity_type` / `entity_id` | établissement ; peut pointer un élève / contact |
| `old_value` / `new_value` JSONB | **potentiellement sensible** |
| `ip_address` / `user_agent` | potentiellement sensible |
| `created_at` | non-PII |

Projection `getAuditLogs` : `school_code`, `user_code`, `actor` = `first_name` + `last_name` (**PII**).

Contenu observé dans `old_value` / `new_value` :

| Source | Présent | Absent / redacted |
|---|---|---|
| `hydrateUser` / `mapUserRow` | email, phone, first/last name, identifier, userId | — |
| `mapContactRow` | email, phone, parent/contact | — |
| `mapSchoolDocumentAuditValue` | studentId, title | **pas** storageKey |
| `mapRelationAuditValue` | fromContactId, toStudentId | pas de nom |
| `sanitizeRbacAuditValue` | — | jwt, token, password, pin, secret |
| export snapshot | firstName élèves / enseignants | password / PIN / token strippés |

**Conséquence** : un journal plateforme **ne peut pas** réutiliser `audit_logs` tel quel. Il faut une projection non-PII séparée (compteurs, actions, school_id sans old/new, sans actor nominatif).

### `privacy_requests`

`identifier`, `contact_email`, `role_label`, `user_id`, `actor_user_id` = PII établissement. Inaccessible plateforme (guard + `schoolCode === "*"`).

### data-export

Domaines : `schoolSettings`, `students`, `classes`, `teachers` (+ `audit` seulement si Superadmin, qui ne peut pas exporter). Payload **PII** (noms). Secrets strippés.

### advanced reports

Agrégats (moyennes, totaux, counts). Pas de nom/email. **Mais** requêtes **globales non scopées** (toutes écoles). Ce n’est pas un contrat non-PII plateforme : c’est une fuite d’agrégats multi-tenant si un rôle école atteint la route.

---

## 4. Workflows privacy

| Étape | Route | Contrat réel |
|---|---|---|
| Création | `POST /api/privacy/erasure-requests` | public, rate-limit ; JWT optionnel ; type forcé `erasure`, status `pending` |
| Lecture | `GET /api/privacy/erasure-requests` | JWT école concret ; `listPrivacyRequests({ schoolCode })` |
| Exécution admin | `POST …/:requestId/execute` | `assertCanExecuteSchoolErasure` : plateforme **403** ; autre école **403** |
| Auto-effacement | `POST …/self/execute` | crée + exécute pour `principal.sub` ; hors guard |
| Anonymisation | `anonymizeAccountFields` | status DELETED, nom « Anonymisé », email/phone/password/PIN vidés |
| Sessions | `executePrivacyErasure` | révocation sessions cible |
| Dossier scolaire | réponse `schoolRecordsRetained: true` | notes / présences / paiements conservés |
| Isolation | list + execute | schoolCode JWT |

Règle **à conserver** : SUPER_ADMIN / COUNTRY_ADMIN ne doivent pas exécuter l’effacement d’un compte école.

UI Administration Conformité **n’orchestre aucun** de ces workflows.

---

## 5. `audit_logs`

Chaîne `GET /api/audit` :

```
HTTP requireAuth
  → platformPersonalDataGuard   SUPER / COUNTRY → 403 PLATFORM_PERSONAL_DATA_DENIED
  → requirePermission           catalogue Audit:READ | ALL_PRIVILEGES | COUNTRY_PRIVILEGES
                                (canAccess re-applique le guard : plateforme false)
  → handler                     n’accepte que SUPER / Admin Pays
  → tenantScope + getAuditLogs  JOIN schools/users, old/new JSONB
```

Contradiction prouvée (C06A-AUD-01→04) :

- Le guard refuse la plateforme.
- Le handler refuse tout le reste.
- **Aucun profil typique n’obtient 200.**

Ne pas « réparer » en ouvrant le Superadmin sur le journal personnel des établissements.

---

## 6. data-export

- `assertDataExportRead` : plateforme **403** même avec ALL_PRIVILEGES.
- Admin School : `schoolCode` **JWT uniquement** (query client ignoré).
- Snapshot REPEATABLE READ ; domaines settings / students / classes / teachers.
- `includeAudit` câblé Superadmin — **mort** car Superadmin ne passe pas `assertDataExportRead`.
- Audit de l’export : `action=export_school_data` dans `audit_logs`.
- Web `canReadView("dataExport")` : school admin only ; plateforme denied.

Un export plateforme n’est **pas** acceptable du seul fait de `ALL_PRIVILEGES`.

---

## 7. Advanced reports

- Source : `repository.getAdvancedReportsV2()` (PG : grades/payments/attendance/exams + counts globaux ; mémoire : seed).
- Retour : agrégats academic / financial / attendance / exams / global.
- Tenant scope : **aucun** (`_req` ignoré, pas de WHERE school).
- PII nominative : non. Agrégats : oui, **cross-tenant**.
- Cache : `cacheService.remember("v2:reports:advanced")` TTL **30 s**.
- Guard : **rester dans le deny**. Ne pas retirer.
- Rôles réellement autorisés côté RBAC : Rapports:READ (SCHOOL_ADMIN par défaut) — la route est donc **B** pour l’école et **D** pour la plateforme.

ReportsPage **ne consomme pas** cette API.

---

## 8. UI réelle

- Route produit : `/administration/conformite` (legacy `/rapports` → redirect).
- `ReportsPage` : tableau `MVP_COVERAGE` (constantes marketing / couverture MVP). Zéro fetch.
- Superadmin : entre dans Administration (`view="users"` autorisé) mais **l’onglet Conformité est masqué**.
- Country Admin : exception `feature !== "Rapports"` dans `canReadView` → voit l’onglet façade.
- School Admin + rôles avec `Rapports:READ` : même façade.
- Enseignant / Parent / Élève : pas `Rapports:READ` → pas d’onglet.
- `/confidentialite` : politique statique + lien suppression.
- `/suppression-compte` : mailto + POST public `erasure-requests`. Pas de données privées exposées. La page dit clairement que la demande est « en attente » et n’efface pas le dossier scolaire.

---

## 9. Contradictions

1. **`GET /api/audit` injoignable** : guard vs handler (constat central).
2. **Onglet « Conformité » ≠ conformité** : Country / School voient une couverture MVP, pas les demandes / exports / journaux.
3. **Catalogue RBAC vs deny** : `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES` listés sur `/api/audit`, `/api/data-export`, `/api/v2/reports/advanced` ; le guard gagne.
4. **`includeAudit` Superadmin** dans l’export : code mort.
5. **Advanced reports** : RBAC école ouvre des agrégats **globaux**.
6. **Schéma `privacy_requests`** : `rejected` / `access` / `rectification` existent en CHECK ; le runtime ne crée que `erasure` / `pending` → `processed`.
7. Copy AdministrationLayout : « conformité de la plateforme » alors que la page est une façade locale.

---

## 10. Dead routes / façades

| Surface | État |
|---|---|
| `/administration/conformite` | façade `MVP_COVERAGE` |
| `/rapports` | redirect vers la façade |
| `GET /api/audit` | dead pour tous les profils typiques |
| `GET /api/v2/reports/advanced` | vivante pour Rapports:READ école, **non consommée** par ReportsPage, scope faux |
| `includeAudit` export Superadmin | mort |
| statuts `rejected` / types `access`/`rectification` | schéma seulement |

---

## 11. Risques

| Risque | Gravité | Note |
|---|---|---|
| Réparer `/api/audit` en donnant le journal école au Superadmin | **P0** | Option C. Interdit. |
| Réutiliser `audit_logs.old/new` comme journal plateforme | **P0** | PII (email, phone, noms, studentId). |
| Advanced reports globaux pour un JWT école | **P1** | agrégats multi-tenant. Hors correction 06A. |
| Country Admin voit « Conformité » et croit à un module réel | **P2** | façade. |
| POST public erasure sans identité forte | **P2** | déjà rate-limité ; exécution reste école. |
| Self-erasure plateforme | **P2** | hors guard ; n’exécute pas un compte école tierce. |

---

## 12. Recommandation A ou B

**Option A** — à instruire pour ADMIN-06B.

**A1. Conformité plateforme NON-PII** (Superadmin, éventuellement Country en agrégat pays) :

Visible uniquement :

- fonctionnalité d’effacement disponible OUI/NON
- endpoint opérationnel OUI/NON
- politique confidentialité publiée OUI/NON
- suppression compte disponible OUI/NON
- nombre agrégé de demandes **par état** SI réellement non-PII (counts, pas identifier/email)
- santé des mécanismes (routes up, guard en place)

Jamais : nom, email, téléphone, élève, parent, userId personnel, contenu old/new, document scolaire.

**A2. Conformité établissement** (SCHOOL_ADMIN et rôles habilités, tenant JWT) :

- liste / exécution des demandes d’effacement de **son** école
- export données de **son** école
- journal établissement **si** un contrat school-only est décidé (ce n’est pas `GET /api/audit` actuel)

**Option B** si A1 n’a pas de source honnête aujourd’hui : ne pas inventer un tableau de gouvernance. Garder l’onglet masqué Superadmin (`canReadView` déjà false). Conformité uniquement établissement, plus tard.

Option B est le **minimum sûr** (déjà vrai pour Superadmin). Option A est le **contrat produit** dès qu’on affiche quelque chose au Superadmin.

**Option C = interdite.**

---

## 13. Périmètre exact ADMIN-06B

ADMIN-06B (si autorisé) pourra :

1. Figer le contrat Option A (A1 projection non-PII **nouvelle**, A2 UI établissement branchée sur privacy/export existants).
2. Ou appliquer Option B : aucun A1 ; éventuellement retirer l’exception Country `Rapports` pour ne plus montrer une façade.
3. Décider du sort de `GET /api/audit` **sans** l’ouvrir à la plateforme :
   - le laisser dead, ou
   - le recabler **école-only** (`Audit:READ` + JWT concret) pour A2,
   - créer une projection non-PII **séparée** pour A1 (table ou vue counts).
4. Ne pas retirer `GET /api/v2/reports/advanced` du deny. Un recable tenant serait un chantier distinct.
5. Ne pas donner aux platform admins `privacy_requests` établissement.
6. Ne pas modifier le guard pour élargir Superadmin.
7. Migration : **NON** sauf si A1 exige une table de projection dédiée (alors 06B le dira explicitement). 06A : **NON**.

Hors 06B : Documents, Relations, Users, RBAC moteur, production, `main`.

---

## Tests C06A-01 → C06A-15

Caractérisation de l’**état réel** (donc GREEN). Pas injectés dans `verify:functional-rbac`.

| ID | Résultat attendu / réel |
|---|---|
| C06A-01 | ReportsPage = MVP_COVERAGE, pas d’API |
| C06A-02 | Superadmin `canReadView("reports")` = false |
| C06A-03 | Country Admin = true (façade) |
| C06A-04 | School Admin = true ; Enseignant = false |
| C06A-05 | GET /api/audit Superadmin 403 guard |
| C06A-06 | GET /api/audit Country 403 guard |
| C06A-07 | GET /api/audit School Admin 403 RBAC |
| C06A-08 | audit_logs peut porter PII établissement |
| C06A-09 | plateforme ne peut pas exécuter erasure école |
| C06A-10 | isolation list privacy par schoolCode |
| C06A-11 | self-erasure ≠ execute admin |
| C06A-12 | data-export = JWT école, PII, plateforme 403 |
| C06A-13 | advanced reports globaux + deny plateforme |
| C06A-14 | /confidentialite + /suppression-compte cohérents |
| C06A-15 | pas d’endpoint plateforme non-PII canonique |

C06A-AUD-01→04 : même chaîne `/api/audit` détaillée par couche.

---

## Interdit respecté

- Pas de modification `platformPersonalDataGuard.js`
- Pas d’ajout `reports` / Rapports Superadmin
- Pas d’ouverture `GET /api/audit` Superadmin
- Pas d’accès privacy établissement Superadmin
- Pas de suppression de données, pas de migration, pas de dashboard, pas de refactor
- Pas de `main`, pas de production
