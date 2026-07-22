# Suivi officiel des migrations Design System

**Légende :** ✅ Migré / stabilisé · ⏳ Planifié · 🔒 Verrouillé (hors périmètre jusqu’à validation CTO)

Mettre à jour ce tableau à chaque PR de migration ou de stabilisation.

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
| Graphiques dashboard | ⏳ | — | 0 % | Panel + panel |
| Shell `ParametresLayout` | ⏳ | ad hoc | 0 % | Shell module |
| PromptDialog | ⏳ | — | 0 % | ui legacy |
| DataTable | ⏳ | — | 0 % | ui legacy |
| Élèves | 🔒 | — | 0 % | Oui |
| Classes (module métier) | 🔒 | — | 0 % | Oui |
| Enseignants | 🔒 | — | 0 % | Oui |
| Présences | 🔒 | — | 0 % | Oui |
| Notes | 🔒 | — | 0 % | Oui |
| Finance (opérations) | 🔒 | — | 0 % | Oui |
| RH | 🔒 | — | 0 % | Oui |

## Notes

- D2.6 : coexistence via **re-exports** `components/ui/{Toast,Modal,ConfirmDialog,Table,PagePlaceholder}` → `@/design-system`.
- Nouveaux écrans : importer uniquement depuis `@/design-system`.
- Modules 🔒 : attendre validation CTO avant ouverture.
