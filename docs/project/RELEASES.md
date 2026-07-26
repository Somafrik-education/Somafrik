# Plan des releases — Somafrik

**Statut :** plan officiel Go/No Go  
**Dernière mise à jour :** 2026-07-26  
**Alignement :** [ROADMAP.md](./ROADMAP.md) · [CHANGELOG.md](./CHANGELOG.md)

Chaque release doit être validée CTO avant promotion `develop` → `main` / production.

---

## v1.0 — Préproduction

**Cible :** MVP opérable sur `preprod.somafrik.app`  
**Statut :** ⏳ En validation gate (post HOTFIX-RBAC-ADMIN-01)

### Fonctionnalités

- Auth backoffice + mobile
- Multi-tenant pays / établissements
- EntityPage + Design System D2.8
- Élèves, classes, enseignants (listes)
- Présences & Notes (PG + sync enseignant)
- RBAC S1.4 + audit serveur
- CI/Security S2.4

### Critères Go / No Go

| Critère | Go si… |
|---------|--------|
| Auth | Login faux → 401 (jamais 500) ; bootstrap runtime vert |
| Classes | Admin School crée/modifie/supprime classe → PUT 200, persiste après reload, **sans** `auditLog` client |
| Enseignants | Création + affectation → PUT 200, persiste après reload |
| Notes | Enseignant sync evaluations/notes → ACK ; hors périmètre → 403 |
| RBAC | `auditLog` client → 403 pour tous les rôles métier |
| CI | Secrets / Security / TypeScript / Lint / Tests / Audit verts |

### Risques

- Données optimistes locales (outbox / localStorage) confondues avec PG
- Workflows Finance/Contacts encore porteurs d’`auditLog` (mitigés par strip DataContext)
- SYNC-04 non livré (erreurs grade plus granulaires)

### Validation CTO

- [ ] Gate préprod classes / enseignants (modif, suppression, affectation)
- [ ] Gate notes enseignant
- [ ] Décision explicite d’ouverture de la release suivante

---

## v1.1 — Bulletins

**Cible :** publication de bulletins après Notes stabilisées (D3.7)  
**Statut :** 🔒 Bloqué jusqu’à Go v1.0 + instruction CTO

### Fonctionnalités

- Calcul / assemblage bulletins
- Publication ≠ simple note
- Prévisualisation / PDF selon droits

### Critères Go / No Go

| Critère | Go si… |
|---------|--------|
| Prérequis | Notes PG + sync enseignant validés en préprod |
| Données | Bulletin dérivé des grades canoniques |
| Droits | Publication réservée aux rôles autorisés |
| Non-régression | Présences / Notes inchangés |

### Risques

- Confusion publication note vs bulletin
- Perf calcul multi-classes

### Validation CTO

- [ ] Contrat D3.7 approuvé
- [ ] Gate préprod bulletins
- [ ] Pas de livraison en parallèle de SYNC-04 sans décision

---

## v1.2 — Présences (chrome & parcours)

**Cible :** ToolLayout / parcours établissement complets (au-delà du contrat D3.5b)  
**Statut :** 📋 Planifié

### Fonctionnalités

- Chrome DS `ToolLayout` Présences
- Parcours appel stabilisé web + mobile
- Reporting absences

### Critères Go / No Go

| Critère | Go si… |
|---------|--------|
| PG | UNIQUE / upsert D3.5b conservés |
| UX | ToolLayout sans régression métier |
| Mobile | Appel enseignant aligné API |

### Risques

- Double écriture JSON + PG
- Fuseaux / journées scolaires

### Validation CTO

- [ ] Audit UX clôturé
- [ ] Gate préprod présences

---

## v1.3 — Finance

**Cible :** opérations financières établissement (Phase F)  
**Statut :** 🔒 Verrouillé

### Fonctionnalités

- Grilles / frais / paiements / impayés
- RBAC Comptable / Secrétaire
- Audit serveur des transactions

### Critères Go / No Go

| Critère | Go si… |
|---------|--------|
| RBAC | Matrice paiement respectée |
| Audit | Aucun `auditLog` client ; traces serveur |
| Intégrité | Pas de double encaissement |

### Risques

- Dette `auditLog` dans workflows paiements historiques
- Règles tarifaires multi-années

### Validation CTO

- [ ] Ouverture Phase F explicite
- [ ] Gate préprod finance
- [ ] Revue sécurité paiements

---

## v2.0 — Mobile + IA

**Cible :** apps stores-ready + premiers copilotes IA (Phases H–I)  
**Statut :** 📋 Planifié

### Fonctionnalités

- Mobile production (enseignant, parent, élève)
- Sync hors-ligne robuste
- Premiers cas d’usage IA (opt-in, auditables)

### Critères Go / No Go

| Critère | Go si… |
|---------|--------|
| Sécurité mobile | `verify:mobile-security` + pin / SecureStore |
| Stores | Builds EAS stables |
| IA | Politique PII + opt-in + logs d’audit |
| Perf / coût | Budgets API IA définis |

### Risques

- Dette Expo / npm audit
- Conformité données scolaires

### Validation CTO

- [ ] Checklist stores
- [ ] Revue juridique / PII IA
- [ ] Go production explicite

---

## Processus de release

```text
develop stable
  → checklist Go/No Go de la version
  → validation CTO
  → tag / notes de release
  → merge develop → main (prod)
  → déploiement
  → smoke post-prod
  → entrée CHANGELOG figée
```

Les hotfixes urgents suivent `hotfix/*` → PR → CI → CTO → `develop` (+ `main` si prod impactée) — voir [CONTRIBUTING.md](./CONTRIBUTING.md).
