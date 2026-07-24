# Audit — D2.3 première migration métier

**Module choisi :** Profil établissement (`/parametres/profil`)  
**Statut :** descriptif (pré-migration)  
**Date :** 2026-07-22

## 1. Choix du module

| Critère CTO | Évaluation |
|-------------|------------|
| Faible risque | ✅ Page isolée, hors cœur produit |
| Utilisé | ✅ Paramètres établissement (Admin School) |
| Représentatif | ✅ Formulaire page dédiée (type D1.3 Formulaire) |
| Peu de logique UI spécifique | ✅ Formulaire CRUD simple |
| Pas de workflow complexe | ✅ Submit unique, pas d’onglets / wizard |
| Couverture tests | ⚠️ Pas de tests page dédiés — logique couverte côté API/permissions |

**Rejetés pour cette PR :** Élèves, Finance, Notes (cœur) ; Matières / Niveaux / Année (monolithe `ConfigurationPage`) ; Salles (placeholder vide — peu de valeur d’apprentissage).

## 2. Composants actuels (avant)

| Fichier | Rôle |
|---------|------|
| `web/src/pages/parametres/EstablishmentProfilePage.tsx` | Page métier |
| `web/src/pages/parametres/ParametresLayout.tsx` | Shell module (hors migration) |
| `web/src/pages/parametres/SettingsPlaceholders.tsx` | Re-export alias |
| `components/ui/Card`, `Button`, `Field`, `Toast` | Primitives legacy |

## 3. Layout actuel

- Pas de layout DS : une seule `Card` avec `SectionHeader` + formulaire.
- Shell parent : `ParametresLayout` (eyebrow + h1 « Paramètres » + retour hub).

## 4. Dette UI

1. Imports `components/ui` alors que D2.1 propose les équivalents.
2. Pas de zones FormLayout (Header / Alerts / StickyActions).
3. Action primaire en bas de formulaire non sticky (OK desktop court ; StickyActions DS améliore le mobile long).
4. Toast encore hors DS (overlay stub).

## 5. Dépendances (conservées)

| Dépendance | Nature | Migration |
|------------|--------|-----------|
| `useData` / `refresh` | État | Inchangé |
| `useActiveSchool` | Contexte | Inchangé |
| `canManageEstablishmentSettings` | Permissions | Inchangé |
| `validateSchoolForm` | Validation | Inchangé |
| `establishmentsApi.update` | API | Inchangé |
| `useToast` | Feedback | **Reste** `components/ui/Toast` (pas encore dans DS) |

## 6. Mapping migration

| Avant | Après |
|-------|-------|
| Structure ad hoc Card | `FormLayout` |
| `ui/Button` | `@/design-system` `Button` |
| `ui/Card` / `SectionHeader` | DS `Card` / `SectionHeader` |
| `ui/Field` / `Input` / `Select` | `FormField` / `Input` / `Select` |
| Toast | Legacy (gap DS documenté) |
