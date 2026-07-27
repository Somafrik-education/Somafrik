# Opérations & runbook — Somafrik

**Statut :** runbook préprod / prod  
**Dernière mise à jour :** 2026-07-26  
**Liens :** [../preproduction.md](../preproduction.md) · [../vercel.md](../vercel.md) · [SECURITY.md](./SECURITY.md) · [TESTING.md](./TESTING.md)

---

## 1. Cartographie des environnements

| Env | Front | API | DB | Branche |
|-----|-------|-----|----|---------|
| Local | Vite `:5173` / Docker | `:5000` | Postgres Docker `:5433` | feature |
| Préprod | https://preprod.somafrik.app (Vercel) | https://somafrik-api-preprod.onrender.com | Render / Supabase | `develop` |
| Prod | https://somafrik.app (Vercel) | https://api.somafrik.app | Postgres managé | `main` |

Santé API : `GET /api/health` → `{ status, database, version, timestamp }`.

---

## 2. Déploiement préproduction (Render + Vercel)

### 2.1 API Render

Variables minimales (Web Service) :

```env
NODE_ENV=production
DATABASE_URL=<Postgres Render ou Supabase>
JWT_SECRET=<≥ 32 car.>
CORS_ORIGINS=https://preprod.somafrik.app
SOMAFRIK_SKIP_DEMO_SEED=true
SOMAFRIK_DB_REQUIRED=true
TRUST_PROXY_HOPS=1
```

1. Push / merge sur `develop`
2. Render rebuild (auto ou manuel)
3. Vérifier `https://somafrik-api-preprod.onrender.com/api/health`
4. Bootstrap / repair superadmin si base neuve :

```bash
npm run preprod:bootstrap
# ou
npm run preprod:repair-superadmin
npm run preprod:verify-login
```

### 2.2 Frontend Vercel

- Projet racine : `web/`
- Branche `develop` → `preprod.somafrik.app`
- `VITE_API_URL=https://somafrik-api-preprod.onrender.com`

Voir [../vercel.md](../vercel.md).

### 2.3 Docker préprod local (optionnel)

```bash
npm run preprod:check
npm run preprod:up
npm run preprod:logs
npm run preprod:down
npm run preprod:reset   # volumes — destructif
```

---

## 3. Déploiement production

1. Go release CTO ([RELEASES.md](./RELEASES.md))
2. Merge `develop` → `main` (ou tag)
3. Vercel prod (`main`) + API prod (`npm run production:up` / pipeline serveur)
4. Smoke : health, login, parcours critique
5. Figement CHANGELOG de la version

---

## 4. Rollback

### 4.1 Frontend (Vercel)

1. Dashboard Vercel → Deployments → **Promote** / **Rollback** vers le déploiement précédent sain
2. Vérifier `VITE_API_URL` inchangé si l’API n’a pas bougé

### 4.2 API (Render)

1. Render → service → **Rollback** vers le release précédent **ou**
2. Redeploy du commit `develop`/`main` connu bon
3. Ne pas rollback DB sans plan (migrations)

### 4.3 Base de données

- Préférer **restauration snapshot** hébergeur (point-in-time) plutôt qu’un reverse migration improvisé
- Documenter l’heure de l’incident et le snapshot choisi
- Après restore : `GET /api/health`, login, smoke classes/notes

### 4.4 Git

```bash
# Hotfix forward préférable au revert massif
git revert <sha>   # si nécessaire, via PR
```

---

## 5. Monitoring

| Signal | Où regarder |
|--------|-------------|
| Health | `/api/health` (uptime robot recommandé) |
| Logs API | Render Logs / Docker `npm run docker:logs` |
| Front | Vercel Analytics / logs build |
| Erreurs auth | 401 vs 500 (jamais 500 sur mauvais password) |
| Sync Notes | Bannière outbox web + logs `syncAck` |
| CI | GitHub Actions sur `develop` / `main` |

Alertes minimales à configurer : health down, taux 5xx, build préprod rouge.

---

## 6. Restauration PostgreSQL

1. Identifier l’environnement (préprod ≠ prod)
2. Prendre un **nouveau** snapshot de sécurité avant restore si possible
3. Restaurer depuis le backup hébergeur (Render / Supabase / ops prod)
4. Redémarrer l’API
5. Vérifier :

```bash
curl -sS "$API/api/health"
# login ops + lecture /backoffice/state
```

6. Consulter `audit_logs` pour la chronologie incident
7. Communication CTO + entrée incident (ci-dessous)

---

## 7. Incidents

### Sévérité

| Niveau | Exemple | Délai cible |
|--------|---------|-------------|
| P0 | Auth down, data loss, 500 systématiques | Immédiat |
| P1 | RBAC cassé, sync Notes bloquée établissement | ≤ 24 h |
| P2 | Bug UI non bloquant | Planifié |

### Déroulement

1. **Détecter** — health, utilisateurs, CI
2. **Contenir** — rollback front/API si besoin
3. **Corriger** — `hotfix/*` ([CONTRIBUTING.md](./CONTRIBUTING.md))
4. **Valider** — CI + gate préprod ([TESTING.md](./TESTING.md))
5. **Déployer** — préprod puis prod si impact
6. **Documenter** — CHANGELOG, ADR si règle, post-mortem court

---

## 8. Hotfix (rappel ops)

```text
hotfix/<nom> depuis develop (ou main si prod down)
  → correctif minimal + tests
  → Draft PR → CI/Security → CTO
  → merge develop (+ main si prod)
  → déployer préprod → gate
  → reprendre roadmap seulement après Go
```

Exemples récents : HOTFIX-SYNC-03 (#79), HOTFIX-RBAC-ADMIN-01 (#81).

---

## 9. Commandes utiles

```bash
# Santé
curl -sS https://somafrik-api-preprod.onrender.com/api/health

# Stack locale
npm run docker:up
npm run docker:logs
npm run docker:down

# Qualité avant deploy
npm run ci:security
npm run verify:runtime-bootstrap
npm run verify:rbac-admin-01
```

---

## 10. Mise à jour

Toute nouvelle dépendance d’infra (autre hébergeur, nouvel outil monitoring) doit mettre à jour ce runbook **dans la même PR**.
