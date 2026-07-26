# Contribuer — Somafrik

**Statut :** règles obligatoires de développement  
**Dernière mise à jour :** 2026-07-26

Ce document définit comment livrer du code sur Somafrik.  
La documentation sous `docs/project/` est la **source de vérité** : toute évolution fonctionnelle doit la mettre à jour.

---

## 1. Git Flow

| Branche | Rôle |
|---------|------|
| `main` | Production |
| `develop` | Intégration / préproduction |
| `feature/*` | Nouvelle fonctionnalité |
| `hotfix/*` | Correctif prioritaire (préprod/prod) |
| `cursor/<slug>-xxxx` | Branches agents Cloud (même règles de PR) |
| `release/*` | Préparation de release (optionnel) |

### Règles

- Toujours brancher depuis `develop` (sauf hotfix prod critique depuis `main` + backport `develop`).
- Une PR = un objectif (phase + release si applicable).
- Pas de commit direct sur `develop` / `main`.

---

## 2. Workflow obligatoire

```text
branche
  ↓
Draft PR
  ↓
Développement
  ↓
Tests locaux
  ↓
CI (Lint et build)
  ↓
Security (Secrets, Security, TypeScript, Lint, Tests, Audit)
  ↓
Review CTO
  ↓
Ready for review (si draft)
  ↓
Merge (squash préféré)
  ↓
Préproduction (Vercel develop + Render API)
  ↓
Gate manuelle / validation CTO
  ↓
Production (main) — sur Go release
```

### Checklist PR

- [ ] Titre clair (`feat|fix|docs|test|ci|security|chore`)
- [ ] Description : problème, correctif, hors périmètre, tests
- [ ] Référence **phase** roadmap (A–J) et **release** si pertinent
- [ ] Docs mises à jour (`docs/project/*` et/ou contrats DS)
- [ ] Aucun secret dans le diff
- [ ] CI + Security verts avant review CTO

---

## 3. Conventions de commits

Format recommandé :

```text
type(scope): résumé impératif court

Corps optionnel — pourquoi / impact.
```

Types : `feat`, `fix`, `docs`, `test`, `ci`, `security`, `chore`, `refactor`.

Exemples :

```text
fix(rbac): HOTFIX-RBAC-ADMIN-01 — classes sans auditLog client
docs(project): gouvernance ROADMAP / ARCHITECTURE
feat(eleves): C1.8a — valider inscription et affecter une classe
```

---

## 4. Conventions de Pull Requests

1. **Draft par défaut** jusqu’à CI verte et périmètre stable.
2. Corps structuré : Problème / Correctif / Tests / Hors périmètre / Docs.
3. Screenshots ou traces Network pour les bugs UI/API préprod.
4. Ne pas merger #analyse seules (ex. historiques SYNC) sans réintroduction isolée.
5. Squash and merge sur `develop` sauf instruction contraire CTO.

---

## 5. Documentation (obligatoire)

| Changement | Documents à mettre à jour |
|------------|---------------------------|
| Fonctionnalité / phase | [ROADMAP.md](./ROADMAP.md), [CHANGELOG.md](./CHANGELOG.md) |
| Architecture / sous-système | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Décision durable | [DECISIONS.md](./DECISIONS.md) |
| Jalon version | [RELEASES.md](./RELEASES.md) |
| Lot Design System | `docs/ux/design-system/SUIVI-MIGRATIONS.md` + contrat/rapport |

Une PR qui change le comportement **sans** doc est considérée incomplète.

---

## 6. Tests & qualité

### Minimum local

```bash
npm run typecheck
npm run lint
npm run verify:rbac-s1-4          # si touch RBAC
npm run verify:rbac-admin-01     # si touch classes/enseignants/auditLog
npm run verify:notes-sync        # si touch Notes/sync
npm run verify:students-sync     # si touch sync élèves/inscriptions PG
npm run verify:pre-e1-hotfix-02  # si touch sync enseignants/affectations/notes PG
npm run verify:pre-e1-hotfix-02b # si touch matérialisation PG teachers/assignments (causalité)
npm run verify:runtime-bootstrap # si touch bootstrap / auth runtime
```

### Principes

- Fail-closed RBAC — prouver les 403 autant que les 200
- Pas d’`auditLog` dans les payloads client
- Sync : prouver ACK / outbox / non-écrasement pending
- Préférer tests ciblés `verify:*` aux suites géantes non liées

### Node

- **Node.js 22.12.0** (voir `.nvmrc`)

---

## 7. Sécurité

- Jamais de JWT en query string
- Jamais de secrets commités (`.env*`, tokens, clés)
- Sanitizer les réponses utilisateur
- Respecter la matrice S1.4 et les hotfixes sync/RBAC

Voir [../ci-cd-security.md](../ci-cd-security.md).

---

## 8. Environnements

| Env | Branche | Front | API |
|-----|---------|-------|-----|
| Dev local | feature | Vite `:5173` | Docker / memory |
| Préprod | `develop` | Vercel | Render |
| Prod | `main` | Vercel | API prod |

Détails : [../preproduction.md](../preproduction.md).

---

## 9. Hotfixes

1. Branche `hotfix/<nom>` depuis `develop` (ou `main` si prod down)
2. Périmètre minimal + tests de non-régression
3. Contrat/rapport si lot nommé (`HOTFIX-*`)
4. Entrée CHANGELOG + DECISIONS si règle durable
5. Gate préprod avant reprise roadmap

---

## 10. Revue CTO — attentes

La review vérifie notamment :

- alignement roadmap / release ;
- absence d’élargissement RBAC silencieux ;
- documentation à jour ;
- preuves de tests ;
- risques préprod explicités.
