# Audit layouts existants — D2.2 (avant fondation)

**Statut :** descriptif  
**Phase :** D2.2  
**Périmètre :** `web/src/components/layout/*`, `pages/**/*Layout.tsx`, structures de pages

## 1. Structures réutilisées

| Pattern | Où | Description |
|---------|-----|-------------|
| App chrome | `components/layout/AppLayout` | Sidebar + Topbar + main + Outlet |
| Module shell | 7 layouts pages | Eyebrow + h1 + description + TabNav + Outlet |
| List chrome | EntityPage, Users, Fees… | Card + SectionHeader + search/filters + Table |
| Record / fiche | StudentWorkspacePage | Header + tabs + content |
| Hub grid | SettingsHub, EtablissementOverview | Tuiles / cartes d’accès |
| Tool | Présences, Notes, Planning | Zone de travail dense + contrôles |

## 2. Duplications

1. Header module (eyebrow / h1 / description) copié ~7 fois.
2. Trois systèmes d’onglets (`TabNav`, nav dossier élève, boutons Notes).
3. Titres doubles : Topbar `h1` + layout module `h1`.
4. Hub tiles Settings ≈ Overview établissement (CSS partagé, pas de layout).

## 3. Différences

| Sujet | Écart |
|-------|-------|
| Filtrage onglets par permission | Seulement Mon établissement |
| Paramètres | Hub + retour, pas TabNav |
| TimetableLayout | Sous-onglets seuls (pas de header) |
| Page header | SectionHeader Card vs bare vs aucun |

## 4. Dette

1. Aucun layout dans `@/design-system` (stub D2.1).
2. Pas de zones/slots nommés → structures ad hoc.
3. Incohérence Card vs contenu nu.
4. AppLayout runtime = logique titre/nav — à ne pas remplacer en D2.2.

## 5. Décision D2.2

- Créer layouts **génériques à slots** dans `design-system/layout/`.
- **Ne pas** migrer `components/layout/AppLayout` ni les module layouts.
- Documenter le mapping type de page → layout pour D2.3.
