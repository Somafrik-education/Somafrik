# Suivi officiel des migrations Design System

**Légende :** ✅ Migré / stabilisé · ⏳ Planifié / différé · 🔒 Verrouillé (hors périmètre jusqu’à validation CTO) · 📋 Audit livré (UI non migrée)

Mettre à jour ce tableau à chaque PR de migration ou de stabilisation.

## Suivi granulaire (D3+)

| Module | Sous-périmètre | Statut | Layout | Legacy restant |
|--------|----------------|--------|--------|----------------|
| Infra | D2.7 EntityPage — chrome liste | ✅ | `ListLayout` via `EntityListShell` | Handlers / modales |
| Infra | D2.8a — Colonnes EntityPage | ✅ | — | `entityColumns.tsx` |
| Infra | D2.8b — Options formulaire | ✅ | — | `entitySelectOptions.ts` |
| Infra | D2.8c — Handlers CRUD | ⏳ | — | submit / delete / persist |
| Infra | D2.8d/e — Modales & nettoyage | ⏳ | — | Monolithe restant |
| Élèves | Fiche / workspace | ✅ | `RecordLayout` | StatusBadge ; nav onglets custom |
| Élèves | Liste (D3.1b) | ✅ | `ListLayout` via `EntityListShell` | Modales/colonnes EntityPage |
| Classes métier | Audit D3.2 | 📋 | — | Voir sous-lots |
| Classes métier | D3.2a — Fiche | 🔒 | `RecordLayout` (cible) | **Fiche absente** (prérequis produit) |
| Classes métier | D3.2b — Liste | ✅ | `ListLayout` via `EntityListShell` | Modales/colonnes EntityPage ; pas de fiche |
| Classes métier | D3.2c — Membres / élèves | ✅ | `ListLayout` via `EntityListShell` | classScope EntityPage ; modales |
| Classes config | Structure (D2.5) | ✅ | `FormLayout` | Monolithe `ConfigurationPage` |
| Enseignants | D3.3 — Liste | ✅ | `ListLayout` via `EntityListShell` | Modales/colonnes EntityPage ; pas de fiche |
| Enseignants | Fiche | 🔒 | `RecordLayout` (cible) | Fiche absente |

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
| EntityPage — modales & handlers | ⏳ | — | 0 % | Monolithe restant |
| Documents / bulletins | ⏳ | — | 0 % | Page legacy |
| Graphiques dashboard | ⏳ | — | 0 % | Chart + panel |
| Shell `ParametresLayout` | ⏳ | ad hoc | 0 % | Shell module |
| PromptDialog | ⏳ | — | 0 % | ui legacy |
| DataTable | ⏳ | — | 0 % | ui legacy |
| Élèves — fiche / workspace | ✅ | `RecordLayout` | Fiche DS | StatusBadge ; onglets |
| Élèves — liste | ✅ | `ListLayout` | D3.1b `StudentsListPage` | Modales EntityPage |
| Classes (module métier) | ✅ / ⏳ | `ListLayout` | Liste D3.2b + membres D3.2c | Fiche absente ; modales EntityPage |
| Enseignants | ✅ / ⏳ | `ListLayout` | Liste D3.3 | Fiche absente ; modales EntityPage |
| Parents / Responsables | 🔒 | — | 0 % | Oui |
| Présences | 🔒 | — | 0 % | Oui |
| Notes | 🔒 | — | 0 % | Oui |
| Finance (opérations) | 🔒 | — | 0 % | Oui |
| RH | 🔒 | — | 0 % | Oui |

## Notes

- D2.6 : coexistence via **re-exports** `components/ui/{Toast,Modal,ConfirmDialog,Table,PagePlaceholder}` → `@/design-system`.
- D3.1 : fiche Élèves migrée (`RecordLayout`).
- D3.1b : liste Élèves — `StudentsListPage` → EntityPage — [RAPPORT](./RAPPORT-D3.1b-liste-eleves.md).
- D3.2 : audit Classes — [AUDIT](./AUDIT-D3.2-classes.md) · [RAPPORT](./RAPPORT-D3.2-classes.md).
- D2.7 : chrome EntityPage — [AUDIT](./AUDIT-D2.7-entitypage.md) · [ARCHITECTURE](./ARCHITECTURE-D2.7-entitypage.md) · [RAPPORT](./RAPPORT-D2.7-entitypage.md).
- D3.2b : liste Classes — [RAPPORT](./RAPPORT-D3.2b-liste-classes.md).
- D3.3 : liste Enseignants — [RAPPORT](./RAPPORT-D3.3-enseignants.md).
- D3.2c : membres / élèves d’une classe — `ClassStudentsPage` → EntityPage + `classScope` — [RAPPORT](./RAPPORT-D3.2c-membres-classe.md).
- D2.8a : extraction colonnes EntityPage — [AUDIT](./AUDIT-D2.8-entitypage-remainder.md) · [RAPPORT](./RAPPORT-D2.8a-colonnes-entitypage.md).
- D2.8b : extraction options select — [RAPPORT](./RAPPORT-D2.8b-options-entitypage.md). Suite : D2.8c handlers CRUD.
- Nouveaux écrans : importer uniquement depuis `@/design-system`.
- Modules 🔒 : attendre validation CTO avant d’ouvrir le module suivant.
