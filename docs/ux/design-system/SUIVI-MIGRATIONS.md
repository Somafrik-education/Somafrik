# Suivi officiel des migrations Design System

**Légende :** ✅ Migré · ⏳ Planifié / en cours · 🔒 Verrouillé (hors périmètre D2.5)

Mettre à jour ce tableau à chaque PR de migration.

| Module | Statut | Layout | Design System | Legacy restant |
|--------|--------|--------|---------------|----------------|
| Profil établissement | ✅ | `FormLayout` | 100 % UI page | Toast |
| Hub Paramètres | ✅ | `DashboardLayout` | Badge + layout | — |
| Placeholders paramètres (Finances, Notifs, Apparence, Intégrations) | ✅ | — | `ComingSoonState` | — |
| Année scolaire | ✅ | `FormLayout` | FormField, Input, Select, Textarea, Badge, Button, Card | Toast ; monolithe `ConfigurationPage` |
| Structure — Niveaux | ✅ | `FormLayout` | idem | Toast |
| Structure — Filières | ✅ | `FormLayout` | idem | Toast |
| Structure — Classes (listes config) | ✅ | `FormLayout` | idem | Toast |
| Structure — Matières | ✅ | `FormLayout` | EmptyState, Select, Textarea… | Toast |
| Rôles et droits | ✅ | `FormLayout` | ForbiddenState, FormField… | Toast ; checkboxes natives |
| Salles (planning) | ✅ | — | `ComingSoonState` | — |
| Sécurité | ✅ | `ListLayout` | FormField, EmptyState, Button, Card… | Table, PrintButton |
| Données & sauvegarde | ✅ | `DashboardLayout` | Button, Card, InlineAlert… | ConfirmDialog, Toast |
| Politique abonnement pays | ✅ | `FormLayout` | EmptyState, FormField… | Toast |
| Documents / bulletins | ⏳ | — | 0 % | Page complète legacy |
| Graphiques dashboard | ⏳ | — | 0 % | Panel + panel legacy |
| Shell `ParametresLayout` | ⏳ | ad hoc | 0 % | Shell module |
| Toast provider (`main.tsx`) | ⏳ | — | DS dispo, non branché | `components/ui/Toast` |
| Élèves | 🔒 | — | 0 % | Oui |
| Classes (module métier) | 🔒 | — | 0 % | Oui |
| Enseignants | 🔒 | — | 0 % | Oui |
| Présences | 🔒 | — | 0 % | Oui |
| Notes | 🔒 | — | 0 % | Oui |
| Finance (opérations) | 🔒 | — | 0 % | Oui |
| RH | 🔒 | — | 0 % | Oui |

## Notes

- Année / Structure / Rôles partagent `web/src/pages/ConfigurationPage.tsx` (UI migrée, logique inchangée).
- « Classes » dans Structure = listes de configuration pédagogique, **pas** le module métier Classes (🔒).
- Marketplace et hors paramètres peuvent encore utiliser `PagePlaceholder`.
