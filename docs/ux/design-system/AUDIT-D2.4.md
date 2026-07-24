# Audit feedback & états — D2.4 (avant fondation)

**Statut :** descriptif  
**Phase :** D2.4  
**Périmètre :** toasts, alertes inline, empty / loading / error / forbidden / coming soon

## 1. Inventaire legacy

| Pattern | Où | Constat |
|---------|-----|---------|
| Toast global | `components/ui/Toast` | `info` / `success` / `error` ; 3200 ms ; provider dans `main.tsx` |
| Coming soon | `PagePlaceholder` | Badge « Bientôt disponible » |
| Empty dashed | ~15 usages (élèves, profil, finances…) | Markup ad hoc répété |
| Loading | Messages texte / spinner ad hoc | Pas de composant partagé |
| Error page | Texte danger ad hoc | Pas de retry standardisé |
| Forbidden | Messages hétérogènes + toasts | Confondu parfois avec Empty |
| Inline alerts | `StudentWorkspaceAlert`, bandeaux métier | Hors DS ; tones partiels |
| Layout slots Alerts | D2.2 | Structure seule — pas d’UI alert |

## 2. Dette (DO-005 / DO-012 / DO-031)

1. Pas d’`EmptyState` / `InlineAlert` / `LoadingState` / `ForbiddenState` dans le DS.
2. Toast DS stub ; runtime 100 % legacy.
3. Rôles a11y inconsistants (`status` vs `alert`).
4. Coming soon parfois rendu comme empty dashed (AP risque).

## 3. Décision D2.4

- Livrer les composants feedback dans `design-system/feedback/`.
- **Ne pas** basculer `ToastProvider` dans `main.tsx` ni migrer les écrans en masse.
- Table / Modal restent hors lot (overlays / data-display).

## 4. Mapping cible

| État DO-031 | Composant DS |
|-------------|--------------|
| Loading | `LoadingState` |
| Empty | `EmptyState` |
| Erreur | `ErrorState` |
| Permission refusée | `ForbiddenState` |
| Coming soon | `ComingSoonState` |
| Alerte inline | `InlineAlert` |
| Feedback court global | `ToastProvider` / `useToast` |
| Conflit / Maintenance / Sync | Hors D2.4 (doc + lots suivants) |
| Lecture seule | `InlineAlert` tone `warning` (pattern) |
