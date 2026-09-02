# Contribuer — Somafrik

**Statut :** règles obligatoires de développement  
**Dernière mise à jour :** 2026-09-01

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

### 3.1 Identité Git / confidentialité des auteurs

Règle : **identité Git ≠ adresse publique Somafrik ≠ boîte interne de réception**.

Les commits humains du compte Somafrik doivent utiliser l’adresse **GitHub noreply officielle** de ce compte.

1. GitHub → **Settings → Emails**.
2. Activer *Keep my email addresses private* si ce n’est pas déjà le cas.
3. Copier l’adresse noreply affichée par GitHub (forme `ID+login@users.noreply.github.com`). **Ne pas inventer l’ID.**
4. Configurer `user.email` avec **cette** adresse, pas une adresse inventée dans la doc.

Interdit comme `user.email` / `author.email` **nouveau** :

- toute adresse du domaine Outlook historique interne ;
- `contact@somafrik.app` ;
- `security@somafrik.app` ;
- `support@somafrik.app` ;
- `notifications@somafrik.app` ;
- `noreply@somafrik.app` ;
- `facturation@somafrik.app`.

Les adresses fonctionnelles Somafrik (`contact@`, `security@`, etc.) sont des **canaux produit / divulgation**, pas une identité d’auteur Git.

Les trailers `Co-authored-by:` des contributeurs humains Somafrik doivent eux aussi utiliser l’adresse GitHub noreply du compte, pas une boîte personnelle. **Ne pas inventer** d’ID noreply.

**Ne pas réécrire** l’historique Git existant (`filter-repo`, `filter-branch`, BFG, force-push de `develop` / `main`) pour masquer d’anciennes identités. Les occurrences déjà publiées **ne sont pas des secrets**. Réécrire uniquement une branche PR non mergée pour retirer un trailer personnel **nouveau** n’est pas une réécriture de `develop` / `main`.

Signalement de vulnérabilité : [SECURITY.md](./SECURITY.md) et [SECURITY.md](../../SECURITY.md) racine — `security@somafrik.app`.

---

## 4. Conventions de Pull Requests

1. **Draft par défaut** jusqu’à CI verte et périmètre stable.
2. Corps structuré : Problème / Correctif / Tests / Hors périmètre / Docs.
3. Screenshots ou traces Network pour les bugs UI/API préprod.
4. Ne pas merger #analyse seules (ex. historiques SYNC) sans réintroduction isolée.
5. Squash and merge sur `develop` sauf instruction contraire CTO.

---

## 5. Documentation (obligatoire)

### Règle de gouvernance

> **Aucune PR fonctionnelle n’est considérée comme terminée tant que la documentation de gouvernance n’est pas mise à jour lorsque cela est nécessaire.**

Ainsi, la documentation évolue **au même rythme** que le code.

| Changement | Document à mettre à jour |
|------------|--------------------------|
| Nouvelle fonctionnalité / phase | [ROADMAP.md](./ROADMAP.md) |
| Nouvelle release / jalon version | [RELEASES.md](./RELEASES.md) |
| Changement observable pour l’utilisateur | [CHANGELOG.md](./CHANGELOG.md) |
| Décision d’architecture | [DECISIONS.md](./DECISIONS.md) |
| Évolution d’architecture / sous-système | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Stratégie de tests / gates | [TESTING.md](./TESTING.md) |
| Contrôle sécurité / secrets / RBAC | [SECURITY.md](./SECURITY.md) |
| Déploiement / incident / runbook | [OPERATIONS.md](./OPERATIONS.md) |
| Schéma / migration / contraintes PG | [DATABASE.md](./DATABASE.md) |
| Lot Design System | `docs/ux/design-system/SUIVI-MIGRATIONS.md` + contrat/rapport |

Une PR qui change le comportement **sans** la doc requise est **incomplète** et ne doit pas être mergée.

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
npm run verify:schools-legacy-cleanup # si touch établissements / PUT schools
npm run verify:finance-legacy-cleanup # si touch Finance / PUT payments* fee* reminders
npm run verify:finance-management     # si touch paiements, grilles, obligations, relances
npm run verify:finance-multi-item-payment # si touch reçu multi-libellés / payment_items
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
- Identité Git : §3.1 (noreply GitHub ; pas d’adresse fonctionnelle Somafrik)
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
