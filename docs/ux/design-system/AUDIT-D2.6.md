# Audit — D2.6 Stabilisation du socle UI

**Statut :** descriptif (pré-stabilisation)  
**Phase :** D2.6

## Constat post D2.5

| Gap | Impact |
|-----|--------|
| Toast DS non branché dans `main.tsx` | Double contexte si bascule partielle |
| Modal / Confirm / Table stubs | Bloquent migrations propres (Sécurité, Data) |
| `PagePlaceholder` encore 1 consumer | Marketplace |
| PromptDialog | Hors P0 (Users / Entity) |
| Navigation DS | Stub — différé |
| ParametresLayout | Shell ad hoc — différé |
| Modules cœur | 🔒 |

## Décision D2.6

Stabiliser le **runtime** (Toast, Confirm) et les **APIs bloquantes** (Modal, Table) via implémentation DS + re-exports `components/ui/*` (DO-045).  
Pas de migration des modules cœur.
