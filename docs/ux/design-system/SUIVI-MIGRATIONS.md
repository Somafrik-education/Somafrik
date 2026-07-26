# Suivi officiel des migrations Design System

**Légende :** ✅ Migré / stabilisé · ⏳ Planifié / différé · 🔒 Verrouillé (hors périmètre jusqu’à validation CTO) · 📋 Audit livré (UI non migrée)

Mettre à jour ce tableau à chaque PR de migration ou de stabilisation.

## Suivi granulaire (D3+)

| Module | Sous-périmètre | Statut | Layout | Legacy restant |
|--------|----------------|--------|--------|----------------|
| Infra | D2.7 EntityPage — chrome liste | ✅ | `ListLayout` via `EntityListShell` | Handlers / modales |
| Infra | D2.8a — Colonnes EntityPage | ✅ | — | `entityColumns.tsx` |
| Infra | D2.8b — Options formulaire | ✅ | — | `entitySelectOptions.ts` |
| Infra | D2.8c — Noyau CRUD | ✅ | — | `entityCrudCore.ts` (sans workflows métier) |
| Infra | D2.8d1 — Affectations enseignants | ✅ | — | `teacherAssignmentWorkflow.ts` |
| Infra | D2.8d2 — Contacts & Comptes | ✅ | — | `contactAccountWorkflow.ts` |
| Infra | D2.8d3 — Relations parent-enfant | ✅ | — | `parentChildRelationWorkflow.ts` |
| Infra | D2.8d4 — Paiements | ✅ | — | `paymentWorkflow.ts` |
| Infra | D2.8e — Nettoyage final | ✅ | — | Assembleur EntityPage (modales UI conservées) |
| Élèves | Fiche / workspace | ✅ | `RecordLayout` | StatusBadge ; nav onglets custom |
| Élèves | Liste (D3.1b) | ✅ | `ListLayout` via `EntityListShell` | Modales/colonnes EntityPage |
| Classes métier | D3.2a — Audit / verrouillage | ✅ | — | [AUDIT](./AUDIT-D3.2-classes.md) · tag `d3.2a` · **D3.2 clos** |
| Classes métier | Fiche Classe | 🔒 | `RecordLayout` (cible) | **Fiche absente** (prérequis produit) |
| Classes métier | D3.2b — Liste | ✅ | `ListLayout` via `EntityListShell` | Modales EntityPage ; pas de fiche |
| Classes métier | D3.2c — Membres / élèves | ✅ | `ListLayout` via `EntityListShell` | classScope EntityPage ; modales |
| Classes config | Structure (D2.5) | ✅ | `FormLayout` | Monolithe `ConfigurationPage` |
| Enseignants | D3.3 — Liste | ✅ | `ListLayout` via `EntityListShell` | Modales/colonnes EntityPage ; pas de fiche |
| Enseignants | Fiche | 🔒 | `RecordLayout` (cible) | Fiche absente |
| Parents / Responsables | D3.4a — Audit / verrouillage | ✅ | — | [AUDIT](./AUDIT-D3.4-parents.md) · décisions CTO §10 |
| Parents / Responsables | Surface admin canonique | ✅ | — | **Parents & élèves** (pas de nouvelle liste) |
| Parents / Responsables | Fiche Parent | 🔒 | `RecordLayout` (cible) | **Aucune fiche dans D3.4** |
| Parents / Responsables | D3.4b — Contrat d’identité / convergence | ✅ | — | [CONTRAT](./CONTRAT-D3.4b-identite-parents.md) · tag `d3.4b` |
| Parents / Responsables | Liste Parents | 🔒 | — | Non retenue |
| Parents / Responsables | Chrome DS Parents | 🔒 | — | Aucun D3.4c automatique |
| Présences | D3.5a — Audit / verrouillage | ✅ | — | [AUDIT](./AUDIT-D3.5-presences.md) · décisions CTO §10 |
| Présences | Surface / contrat données | ✅ | — | `/presences` + mobile ; journée ; enum 4 ; PG canonique |
| Présences | D3.5b — Contrat & persistance canonique | ✅ | — | [CONTRAT](./CONTRAT-D3.5b-presences.md) · tag `d3.5b` |
| Présences | Onglet fiche Élève | 🔒 | — | Hors D3.5 |
| Présences | Chrome DS / ToolLayout | 🔒 | `ToolLayout` (cible) | Après stabilisation métier · pas de D3.5c |
| Notes / Évaluations | D3.6a — Audit / verrouillage | ✅ | — | [AUDIT](./AUDIT-D3.6-notes.md) · décisions CTO §11 |
| Notes / Évaluations | Surface / contrat données | ✅ | — | `/notes` + mobile ; eval×élève ; PG cible ; UNIQUE school+eval+student |
| Notes / Évaluations | D3.6b — Contrat & persistance canonique | ✅ | — | [CONTRAT](./CONTRAT-D3.6b-notes.md) · tag `d3.6b` |
| Notes / Évaluations | D3.6c — Migration écrans | ⏳ | `ToolLayout` | [RAPPORT](./RAPPORT-D3.6c-notes-toollayout.md) · `/notes` · pas de D3.7 |
| Notes / Évaluations | Onglet fiche Élève « Résultats » | 🔒 | — | Hors D3.6c |
| Bulletins | D3.7 | 🔒 | — | Après Notes stabilisées · publication ≠ bulletin · pas en parallèle |

## Suivi consolidé

| Module | Statut | Layout | Design System | Legacy restant |
|--------|--------|--------|---------------|----------------|
| Profil établissement | ✅ | `FormLayout` | 100 % | — |
| Hub Paramètres | ✅ | `DashboardLayout` | Badge + layout | — |
| Placeholders paramètres | ✅ | — | `ComingSoonState` | — |
| Année scolaire | ✅ | `FormLayout` | UI DS | Monolithe partagé |
| Structure — Niveaux / Filières / Classes config / Matières | ✅ | `FormLayout` | UI DS | Monolithe partagé |
| Rôles et droits | ✅ | `FormLayout` | ForbiddenState… | Checkboxes natives |
| Salles (planning) | ✅ | — | `ComingSoonState` | — |
| Sécurité | ✅ | `ListLayout` | Table DS | PrintButton |
| Données & sauvegarde | ✅ | `DashboardLayout` | Confirm + Toast DS | — |
| Politique abonnement pays | ✅ | `FormLayout` | 100 % | — |
| Marketplace | ✅ | — | `ComingSoonState` | — |
| Toast provider (`main.tsx`) | ✅ | — | DS runtime | Re-export ui |
| Modal / Confirm | ✅ | — | DS runtime | Re-export ui |
| Table | ✅ | — | DS runtime | Re-export ui |
| EntityPage — chrome liste (D2.7) | ✅ | `ListLayout` | patterns `entity-list` | Handlers / modales |
| EntityPage — colonnes (D2.8a) | ✅ | — | `entityColumns` | — |
| EntityPage — options select (D2.8b) | ✅ | — | `entitySelectOptions` | — |
| EntityPage — noyau CRUD (D2.8c) | ✅ | — | `entityCrudCore` | — |
| EntityPage — affectations (D2.8d1) | ✅ | — | `teacherAssignmentWorkflow` | Modale UI reste EntityPage |
| EntityPage — contacts & comptes (D2.8d2) | ✅ | — | `contactAccountWorkflow` | Modales UI restent EntityPage |
| EntityPage — relations parent-enfant (D2.8d3) | ✅ | — | `parentChildRelationWorkflow` | Picker UI reste EntityPage |
| EntityPage — paiements (D2.8d4) | ✅ | — | `paymentWorkflow` | Modales UI restent EntityPage / QuickPaymentModal |
| EntityPage — nettoyage final (D2.8e) | ✅ | — | assembleur | Modales UI restent EntityPage |
| Documents / bulletins | ⏳ | — | 0 % | Page legacy |
| Graphiques dashboard | ⏳ | — | 0 % | Chart + panel |
| Shell `ParametresLayout` | ⏳ | ad hoc | 0 % | Shell module |
| PromptDialog | ⏳ | — | 0 % | ui legacy |
| DataTable | ⏳ | — | 0 % | ui legacy |
| Élèves — fiche / workspace | ✅ | `RecordLayout` | Fiche DS | StatusBadge ; onglets |
| Élèves — liste | ✅ | `ListLayout` | D3.1b `StudentsListPage` | Modales EntityPage |
| Classes (module métier) | ✅ clos | `ListLayout` | D3.2a–c (tag `d3.2a`) | Fiche absente 🔒 ; modales EntityPage |
| Enseignants | ✅ / ⏳ | `ListLayout` | Liste D3.3 | Fiche absente ; modales EntityPage |
| Parents / Responsables | ✅ / 🔒 | — | D3.4a + D3.4b clos (`d3.4b`) | Liste / fiche / chrome DS 🔒 |
| Présences | ✅ / 🔒 | — | D3.5a/b clos (`d3.5b`) | Chrome DS / ToolLayout 🔒 · pas de D3.5c |
| Notes | ✅ / ⏳ | `ToolLayout` | D3.6a/b/c clos (`d3.6c`) | `/notes` ToolLayout ; Résultats 🔒 ; Bulletins D3.7 🔒 |
| Sync / outbox | ⏳ | — | SYNC-01/02/03 ✅ · RBAC-ADMIN-01 classes/enseignants | SYNC-04 (SAVEPOINT / GRADE_*) encore isolé |
| Finance (opérations) | 🔒 | — | 0 % | Oui |
| RH | 🔒 | — | 0 % | Oui |

## Notes

- D2.6 : coexistence via **re-exports** `components/ui/{Toast,Modal,ConfirmDialog,Table,PagePlaceholder}` → `@/design-system`.
- D3.1 : fiche Élèves migrée (`RecordLayout`).
- D3.1b : liste Élèves — `StudentsListPage` → EntityPage — [RAPPORT](./RAPPORT-D3.1b-liste-eleves.md).
- D3.2 : audit historique — [RAPPORT](./RAPPORT-D3.2-classes.md).
- D3.2a : audit / verrouillage post-D2.8e — [AUDIT](./AUDIT-D3.2-classes.md) · [RAPPORT](./RAPPORT-D3.2a-audit-classes.md). Tag clôture D2.8e : `d2.8e` @ `4a5684b8`.
- D3.2 **clos** — tag `d3.2a` @ `045ef54e` (merge PR #59). Suite roadmap : instruction CTO explicite (candidats 🔒 : Parents / Responsables, Présences, Notes, Finance, RH ; ou fiche Classe produit).
- D2.7 : chrome EntityPage — [AUDIT](./AUDIT-D2.7-entitypage.md) · [ARCHITECTURE](./ARCHITECTURE-D2.7-entitypage.md) · [RAPPORT](./RAPPORT-D2.7-entitypage.md).
- D3.2b : liste Classes — [RAPPORT](./RAPPORT-D3.2b-liste-classes.md).
- D3.3 : liste Enseignants — [RAPPORT](./RAPPORT-D3.3-enseignants.md).
- D3.4a : audit / verrouillage Parents — [AUDIT](./AUDIT-D3.4-parents.md) · [RAPPORT](./RAPPORT-D3.4a-audit-parents.md). Tag : `d3.4a`. **D3.3 = Enseignants** · **D3.4 = Parents**.
- D3.4b : contrat identité Parents — [CONTRAT](./CONTRAT-D3.4b-identite-parents.md) · [RAPPORT](./RAPPORT-D3.4b-identite-parents.md). Tag `d3.4b` @ `f442ce90`. Contrat actif : `fromContactId = contact.id` · `user.contactId = contact.id`. **Pas de D3.4c automatique** (liste / fiche / chrome DS / EntityPage 🔒).
- D3.5a : audit / verrouillage Présences — [AUDIT](./AUDIT-D3.5-presences.md) · [RAPPORT](./RAPPORT-D3.5a-audit-presences.md). Tag : `d3.5a`.
- D3.5b : contrat + persistance Présences — [CONTRAT](./CONTRAT-D3.5b-presences.md) · [RAPPORT](./RAPPORT-D3.5b-presences-persistence.md). Tag `d3.5b` @ `b533652c`. PG UNIQUE · upsert · pas ToolLayout / Notes · **pas de D3.5c**.
- D3.6a : audit / verrouillage Notes — [AUDIT](./AUDIT-D3.6-notes.md) · [RAPPORT](./RAPPORT-D3.6a-audit-notes.md). Tag `d3.6a` @ `8885cd92`.
- D3.6b : contrat + persistance Notes — [CONTRAT](./CONTRAT-D3.6b-notes.md) · [RAPPORT](./RAPPORT-D3.6b-notes-persistence.md). Tag `d3.6b` @ `62bdda16`. PG `evaluations`+`grades` · UNIQUE school+eval+student · migration legacy · calcul canonique · JSON mémoire-only.
- D3.6c : migration écrans Notes — [RAPPORT](./RAPPORT-D3.6c-notes-toollayout.md). Tag `d3.6c` @ `dcc45574`. `/notes` → `ToolLayout`.
- HOTFIX-SYNC-01 : intégrité non destructive sync — [CONTRAT](./CONTRAT-HOTFIX-SYNC-01.md) · [AUDIT](./AUDIT-HOTFIX-SYNC-01.md) · [RAPPORT](./RAPPORT-HOTFIX-SYNC-01.md). Tag `hotfix-sync-01` @ `885979ff`. Non-perte OK · **base saine runtime post-P0**.
- HOTFIX-SYNC-02 : rattachement évaluations PG — [CONTRAT](./CONTRAT-HOTFIX-SYNC-02.md) · [RAPPORT](./RAPPORT-HOTFIX-SYNC-02.md). Ensure classe/matière/année · `syncError` visible · test ACK accepted → PG.
- HOTFIX-SYNC-03 : autorisation métier enseignant evaluations/notes — [CONTRAT](./CONTRAT-HOTFIX-SYNC-03.md) · [RAPPORT](./RAPPORT-HOTFIX-SYNC-03.md). Pas d’élargissement global `/backoffice/state` · `teacherId` session · rejet autres clés · Notes UI sans `auditLog` client. Clôture [KNOWN-ISSUE-NOTES-01](./KNOWN-ISSUE-NOTES-01.md).
- HOTFIX-RBAC-ADMIN-01 : classes / enseignants sans `auditLog` client — [CONTRAT](./CONTRAT-HOTFIX-RBAC-ADMIN-01.md) · [RAPPORT](./RAPPORT-HOTFIX-RBAC-ADMIN-01.md). Filet DataContext · audit serveur · Admin School 200 / `auditLog` 403.
- Bootstrap runtime CI : [CONTRAT-BOOTSTRAP-RUNTIME.md](./CONTRAT-BOOTSTRAP-RUNTIME.md) · PR #73. **SYNC-04** encore isolé.
- D3.2c : membres / élèves d’une classe — `ClassStudentsPage` → EntityPage + `classScope` — [RAPPORT](./RAPPORT-D3.2c-membres-classe.md).
- D2.8a : extraction colonnes EntityPage — [AUDIT](./AUDIT-D2.8-entitypage-remainder.md) · [RAPPORT](./RAPPORT-D2.8a-colonnes-entitypage.md).
- D2.8b : extraction options select — [RAPPORT](./RAPPORT-D2.8b-options-entitypage.md).
- D2.8c : noyau CRUD transversal — [RAPPORT](./RAPPORT-D2.8c-crud-entitypage.md).
- D2.8d1 : workflow affectations enseignants — [RAPPORT](./RAPPORT-D2.8d1-affectations-enseignants.md).
- D2.8d2 : workflow Contacts & Comptes — [RAPPORT](./RAPPORT-D2.8d2-contacts-comptes.md).
- D2.8d3 : workflow Relations parent-enfant — [RAPPORT](./RAPPORT-D2.8d3-relations-parent-enfant.md).
- D2.8d4 : workflow Paiements — [RAPPORT](./RAPPORT-D2.8d4-paiements.md).
- D2.8e : nettoyage final assembleur EntityPage — [RAPPORT](./RAPPORT-D2.8e-nettoyage-entitypage.md). Lot D2.8 clos (tag `d2.8e`).
- Nouveaux écrans : importer uniquement depuis `@/design-system`.
- Modules 🔒 : attendre validation CTO avant d’ouvrir le module suivant.
