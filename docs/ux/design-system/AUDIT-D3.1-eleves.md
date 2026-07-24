# Audit — D3.1 Élèves (fiche / workspace)

**Statut :** descriptif (pré-migration)  
**Module :** Élèves — dossier / fiche  
**Hors périmètre D3.1 :** liste `EntityPage`, Classes→élèves, Notes

## Pages

| Route | Fichier | Type |
|-------|---------|------|
| `/etablissement/eleves/:id[/:section]` | `StudentWorkspacePage` | Fiche / Record |
| `/etablissement/eleves` | `EntityPage` (students) | Liste — **différée** |

## Layout actuel (avant)

Shell ad hoc `space-y-6` + header Card + tabs custom.

## Composants legacy

`components/ui` Card, Badge, Button, Modal + `StatusBadge` ; empties dashed ad hoc ; alertes custom.

## Dette

1. Pas de `RecordLayout` / états DS.
2. Liste encore sur monolithe partagé `EntityPage`.
3. `StatusBadge` hors DS (helper métier).

## Dépendances conservées

Hooks workspace / editing, libs permissions, navigation, view-models, API.
