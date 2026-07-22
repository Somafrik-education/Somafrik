# Suivi officiel des migrations Design System

**Légende :** ✅ Migré / stabilisé · ⏳ Planifié / différé · 🔒 Verrouillé (hors périmètre jusqu’à validation CTO) · 📋 Audit livré (UI non migrée)

Mettre à jour ce tableau à chaque PR de migration ou de stabilisation.

## Suivi granulaire (D3+)

| Module | Sous-périmètre | Statut | Layout | Legacy restant |
|--------|----------------|--------|--------|----------------|
| Élèves | Fiche / workspace | ✅ | `RecordLayout` | StatusBadge ; nav onglets custom |
| Élèves | Liste | ⏳ | — | `EntityPage` partagé |
| Classes métier | Audit D3.2 | 📋 | — | Voir sous-lots |
| Classes métier | D3.2a — Fiche | 🔒 | `RecordLayout` (cible) | **Fiche absente** (prérequis produit) |
| Classes métier | D3.2b — Liste | ⏳ | `ListLayout` (cible) | `EntityPage entity="classes"` |
| Classes métier | D3.2c — Membres / élèves | ⏳ | `ListLayout` (cible) | `ClassStudentsPage` → EntityPage students |
| Classes config | Structure (D2.5) | ✅ | `FormLayout` | Monolithe `ConfigurationPage` |
| Enseignants | Module | 🔒 | — | Oui — attendre CTO après D3.2 |

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
| Documents / bulletins | ⏳ | — | 0 % | Page legacy |
| Graphiques dashboard | ⏳ | — | 0 % | Chart + panel |
| Shell `ParametresLayout` | ⏳ | ad hoc | 0 % | Shell module |
| PromptDialog | ⏳ | — | 0 % | ui legacy |
| DataTable | ⏳ | — | 0 % | ui legacy |
| Élèves — fiche / workspace | ✅ | `RecordLayout` | Fiche DS | Liste `EntityPage` ; StatusBadge |
| Élèves — liste | ⏳ | — | 0 % | `EntityPage` partagé |
| Classes (module métier) | 📋 | — | Audit D3.2 | EntityPage ; pas de fiche ; ClassStudentsPage |
| Enseignants | 🔒 | — | 0 % | Oui |
| Parents / Responsables | 🔒 | — | 0 % | Oui |
| Présences | 🔒 | — | 0 % | Oui |
| Notes | 🔒 | — | 0 % | Oui |
| Finance (opérations) | 🔒 | — | 0 % | Oui |
| RH | 🔒 | — | 0 % | Oui |

## Notes

- D2.6 : coexistence via **re-exports** `components/ui/{Toast,Modal,ConfirmDialog,Table,PagePlaceholder}` → `@/design-system`.
- D3.1 : fiche Élèves migrée (`RecordLayout`) ; **liste** encore sur `EntityPage` (⏳).
- D3.2 : audit Classes métier livré ([AUDIT](./AUDIT-D3.2-classes.md) · [RAPPORT](./RAPPORT-D3.2-classes.md)) ; **aucune migration UI** — fiche inexistante ; liste = EntityPage partagé. Attendre validation CTO avant D3.2a/b/c et avant **D3.3 Enseignants**.
- Nouveaux écrans : importer uniquement depuis `@/design-system`.
- Modules 🔒 : attendre validation CTO avant d’ouvrir le module suivant.
