# Stratégie de coexistence & migration — Design System

**Décisions :** DO-045 (compatibilité ascendante) · DO-046 (dépréciation contrôlée) · DO-040 (kit ERP)  
**Lots :** D2.1 (primitives) · D2.2 (layouts) · D2.3 (écrans) · D2.4 (feedback)

## Principe

Le Design System (`web/src/design-system/`) **s’ajoute** sans remplacer les imports existants.

```
Écrans métier existants  →  components/ui/* + components/layout/*  (legacy, inchangé)
Nouveaux écrans / D2.3+  →  @/design-system (primitives + layouts + feedback)
```

**D2.1 / D2.2 / D2.4 :** fondations — pas de migration massive d’écrans.  
**D2.3+ :** migration progressive, **un module à la fois**, avec [rapport CTO obligatoire](./RAPPORT-D2.3-profil-etablissement.md).

### Première migration (D2.3)

| Module | Layout | Statut |
|--------|--------|--------|
| Profil établissement (`/parametres/profil`) | `FormLayout` | ✅ Livré — voir [AUDIT](./AUDIT-D2.3.md) + [Rapport](./RAPPORT-D2.3-profil-etablissement.md) |

Attendre validation CTO avant un second module.

### Feedback (D2.4) — coexistence

| Legacy | Équivalent DS | Action D2.4 |
|--------|---------------|-------------|
| `components/ui/Toast` | `ToastProvider` / `useToast` | Coexistence — **ne pas** basculer `main.tsx` |
| `PagePlaceholder` | `ComingSoonState` | Coexistence |
| Empty dashed ad hoc | `EmptyState` | Disponible pour D2.3+ / nouveaux écrans |
| Messages loading / error / forbidden | `LoadingState` / `ErrorState` / `ForbiddenState` | Idem |
| Alertes inline ad hoc | `InlineAlert` | Idem |

---

## D2.1 — Primitives

| Legacy (`components/ui`) | Équivalent DS | Statut |
|--------------------------|---------------|--------|
| `Button` | `Button` (`tertiary` ≈ `ghost`) | Coexistence |
| `Badge` | `Badge` | Coexistence |
| `StatusBadge` | — (helper métier) | Reste dans ui |
| `Card` / `SectionHeader` | `Card` / `SectionHeader` | Coexistence |
| `Field` / `Input` / `Select` | `FormField` / `Input` / `Select` | Coexistence |
| `Modal`, `Table`… | stubs overlays / data-display | Lots suivants |

### Alias dépréciés (DO-046)

| API | Remplacement | Suppression |
|-----|--------------|-------------|
| `Button variant="ghost"` | `variant="tertiary"` | Après migration + validation CTO |

---

## D2.2 — Layouts (aucune migration runtime)

| Legacy | Layout DS | Action D2.2 |
|--------|-----------|-------------|
| `components/layout/AppLayout` | `AppLayout` (DS) | Coexistence — **ne pas remplacer** |
| `pages/**/*Layout.tsx` (shells module) | — | Conservés ; titres / TabNav restent locaux |
| Structures ad hoc Liste / Fiche / Outil | `ListLayout`, `RecordLayout`, `ToolLayout`… | Disponibles pour D2.3 uniquement |

### Mapping type de page → layout (cible D2.3)

| Type de page (D1.3) | Pattern | Layout DS | Notes |
|---------------------|---------|-----------|-------|
| Shell applicatif | D1.2 | `AppLayout` | Remplacement progressif du chrome runtime |
| Dashboard opérationnel | P-004 | `DashboardLayout` | Alerts avant Kpis |
| Dashboard analytique | P-005 | `DashboardLayout` | Charts dans `Content` |
| Liste | P-002 | `ListLayout` | |
| Fiche | P-003 + P-001 | `RecordLayout` | Résumé dans `Summary` |
| Formulaire page | — | `FormLayout` | Hors Modal (P-009) |
| Assistant | P-008 | `WizardLayout` | |
| Outil | P-007 | `ToolLayout` | Présences, Notes, Planning |
| Hub paramétrage | P-006 | `DashboardLayout` ou `ListLayout` | Pas de HubLayout dédié en D2.2 ; tuiles dans `Content` |
| Rapport | P-010 | `DashboardLayout` ou `ListLayout` | Selon densité tableau vs synthèse |
| Consultation légère | P-009 | — (Modal) | Hors layouts page |
| Placeholder | — | n’importe quel layout + état Coming soon | |

### Ordre de migration recommandé (D2.3+)

1. Nouveaux écrans uniquement → layouts DS dès la création.
2. Fiches (référence élève) → `RecordLayout`.
3. Listes CRUD génériques → `ListLayout`.
4. Outils (Présences / Notes) → `ToolLayout`.
5. Dashboards → `DashboardLayout`.
6. Shell `components/layout/AppLayout` → `AppLayout` DS **en dernier** (forte charge runtime).

Chaque PR de migration cite : Pattern, DO, `Aucun AP introduit`, layout utilisé.

---

## Règles transverses (D2.3)

1. Migrer **écran par écran**, jamais en big-bang.
2. Parité visuelle tant que les valeurs de tokens D1.4 ne sont pas figées.
3. Ne pas supprimer `components/ui/X` ou `components/layout/X` tant que des imports restent.
4. Layouts = structure seule ; logique métier reste dans pages / features.

## Interdits D2.1 / D2.2

- Refonte visuelle globale
- Changement fonctionnel métier
- Migration des modules métier
- Suppression des fichiers legacy encore importés
- Activation dark mode produit
