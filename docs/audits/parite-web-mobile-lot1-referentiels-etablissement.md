# LOT 1 — Référentiels / établissement (PARITY-018, 019, 029, 037)

Cadrage CTO `#5733953521` sur PR #704. Base `develop@e3c874b9`.

## Matrice LOT 1

| ID | Décision | Statut LOT 1 |
|---|---|---|
| **PARITY-018** | Plateforme Web-only intentionnel | Documenté + tests de frontière |
| **PARITY-019** | Paramètres avancés Web-only intentionnel | Documenté + 6 cartes Mobile classifiées |
| **PARITY-029** | Setup établissement après login — **à corriger** | Mobile aligne le contrat Web |
| **PARITY-037** | Catalogue pédagogique école — **contrat unique** | `GET/PUT /education-reference/*` canonique |

Hors périmètre : LOT 2, fiche élève, relations parents, finance, pédagogie notes/bulletins, communication, migration DB, AdminCrud / Menu / PlatformNotifications.

---

## PARITY-018 — Plateforme = Web-only

Ne pas restaurer les écrans Mobile L0. Superadmin / Admin Pays opèrent sur Web.

| Workflow | Web | Mobile live |
|---|---|---|
| Pays | `/pays` | absent |
| Établissements (console) | `/etablissements` | absent |
| Abonnements plateforme | `/abonnements/*` | absent |
| Référentiels pédagogiques **nationaux** | `/referentiels-pedagogiques` | absent (`education_reference.appliesMobile: false`) |
| Matrice RBAC | `/administration/permissions` | `PermissionsScreen` orphelin, non monté |

`SchoolSelector` sur Accueil = changement de contexte, pas un CTA `/pays` ou `/etablissements`.

Ne pas remonter : `AdminCrudScreen`, `MenuScreen`, `PlatformNotificationsScreen`, `PermissionsScreen`.

Preuve machine : `Mobile/src/lib/pariteLot1PlatformSettingsBoundary.test.ts` + suite L0 existante.

---

## PARITY-019 — Paramètres avancés = Web-only

Le hub Web (`SettingsHubPage`, 15 cartes) n’est **pas** recopié dans Expo.

### 6 cartes Mobile (`ConfigurationScreen`) — toutes opérationnelles

| Carte | Route | Classification |
|---|---|---|
| Profil établissement | `EstablishmentProfile` | Quotidien — **garder** |
| Configuration de l'établissement | `SchoolSetup` | Quotidien — **garder** |
| Année scolaire | `SchoolYearSettings` | Quotidien — **garder** |
| Structure pédagogique | `SchoolPedagogicalStructure` | Activation **école** — **garder** (CRUD national = Web) |
| Rôles disponibles | `SchoolAssignableRoles` | Lecture seule — **garder** (pilotage droits = Web) |
| Utilisateurs | `Users` | Quotidien — **garder** |

Aucun CTA mort parmi ces 6 cartes. Aucun nouvel écran paramètres Mobile dans ce lot.

### Web-only (volontaire)

Sécurité, données/export, documents, design bulletin, notifications de politique, apparence, intégrations, mon abonnement, politique abo pays, graphiques dashboard, rôles et droits (pilotage).

---

## PARITY-029 — Setup après login (corrigé)

Source unique : `GET /api/v2/school-setup/status`.

| Règle | Contrat |
|---|---|
| Auto-open | `shouldAutoOpenSchoolSetupWizard` : Admin School / `school_admin`, `status === NOT_STARTED`, pas `mustChangePassword`, pas dismiss session |
| Teacher / parent / student | pas d’auto-open |
| `mustChangePassword` | secret d’abord, puis le même gate |
| Plus tard | RAM session, reset au login (comme Web) |
| Pas de boucle | auto-open au login uniquement, pas à chaque focus Accueil |
| Fail-soft | API KO → Accueil + CTA configuration visible |
| Widget reprise | `NOT_STARTED` / `IN_PROGRESS` sur Accueil et Hub Scolarité |

---

## PARITY-037 — Catalogue pédagogique école (corrigé)

Périmètre : niveaux / filières / groupes + activation école. Hors sujet : matières `/v2/subjects`, cours `/courses`, années, CRUD national.

**Autorité store :** `educationReferencePgStore.getSchoolCatalog(schoolCode)` — un seul DTO.

**Contrat HTTP canonique (Web + Mobile) :**

- `GET /api/education-reference/catalog` (`?schoolCode=` optionnel, `assertSchoolAccess`)
- `PUT /api/education-reference/school-activation` (idem)

**Alias déprécié (backend only, aucun nouveau consommateur) :**

- `GET/PUT /api/backoffice/establishments/:schoolCode/education-reference/{catalog,school-activation}`
- En-tête `Deprecation: true` + `Link` successor-version

Les deux GET historiques doivent renvoyer le **même JSON** pour le même `(principal, schoolCode)`.
