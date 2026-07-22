# Suivi officiel des migrations Design System

**Légende :** ✅ Migré / stabilisé · ⏳ Planifié / différé · 🔒 Verrouillé (hors périmètre jusqu’à validation CTO) · 📋 Audit livré (UI non migrée)

Mettre à jour ce tableau à chaque PR de migration ou de stabilisation.

## Suivi granulaire (D3+)

| Module | Sous-périmètre | Statut | Layout | Legacy restant |
|--------|----------------|--------|--------|----------------|
| Infra | D2.7 EntityPage — chrome liste | ✅ | `ListLayout` via `EntityListShell` | Handlers / colonnes / modales |
| Infra | D2.7 EntityPage — modales / colonnes | ⏳ | — | Dans monolithe |
| Élèves | Fiche / workspace | ✅ | `RecordLayout` | StatusBadge ; nav onglets custom |
| Élèves | Liste | ⏳ | `EntityList*` (socle) | EntityPage métier restant |
| Classes métier | Audit D3.2 | 📋 | — | Voir sous-lots |
| Classes métier | D3.2a — Fiche | 🔒 | `RecordLayout` (cible) | **Fiche absente** (prérequis produit) |
| Classes métier | D3.2b — Liste | ✅ | `ListLayout` via `EntityListShell` | Modales/colonnes EntityPage ; pas de fiche |
| Classes métier | D3.2c — Membres / élèves | ⏳ | `ListLayout` (cible) | `ClassStudentsPage` → EntityPage students |
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
| EntityPage — chrome liste (D2.7) | ✅ | `ListLayout` | patterns `entity-list` | Modales / colonnes / handlers |
| EntityPage — modales & colonnes | ⏳ | — | 0 % | Monolithe restant |
| Documents / bulletins | ⏳ | — | 0 % | Page legacy |
| Graphiques dashboard | ⏳ | — | 0 % | Chart + panel |
| Shell `ParametresLayout` | ⏳ | ad hoc | 0 % | Shell module |
| PromptDialog | ⏳ | — | 0 % | ui legacy |
| DataTable | ⏳ | — | 0 % | ui legacy |
| Élèves — fiche / workspace | ✅ | `RecordLayout` | Fiche DS | Liste `EntityPage` ; StatusBadge |
| Élèves — liste | ⏳ | — | 0 % | `EntityPage` partagé |
| Classes (module métier) | ✅ / ⏳ | `ListLayout` | Liste D3.2b | Fiche absente ; D3.2c membres ; modales EntityPage |
| Enseignants | ✅ / ⏳ | `ListLayout` | Liste D3.3 | Fiche absente ; modales EntityPage |
| Parents / Responsables | 🔒 | — | 0 % | Oui |
| Présences | 🔒 | — | 0 % | Oui |
| Notes | 🔒 | — | 0 % | Oui |
| Finance (opérations) | 🔒 | — | 0 % | Oui |
| RH | 🔒 | — | 0 % | Oui |

## Notes

- D2.6 : coexistence via **re-exports** `components/ui/{Toast,Modal,ConfirmDialog,Table,PagePlaceholder}` → `@/design-system`.
- D3.1 : fiche Élèves migrée (`RecordLayout`) ; **liste** encore sur `EntityPage` (⏳).
- D3.2 : audit Classes métier livré ([AUDIT](./AUDIT-D3.2-classes.md) · [RAPPORT](./RAPPORT-D3.2-classes.md)) ; **aucune migration UI** — fiche inexistante ; liste = EntityPage partagé.
- D2.7 : décomposition EntityPage — chrome liste → `EntityListShell` / Search / Table / Forbidden ([AUDIT](./AUDIT-D2.7-entitypage.md) · [ARCHITECTURE](./ARCHITECTURE-D2.7-entitypage.md) · [RAPPORT](./RAPPORT-D2.7-entitypage.md)). Attendre validation CTO avant **D3.2b** et **D3.3 Enseignants**.
- Nouveaux écrans : importer uniquement depuis `@/design-system`.
- Modules 🔒 : attendre validation CTO avant d’ouvrir le module suivant.
