# Sécurité — Somafrik

**Statut :** politique & contrôles de sécurité  
**Dernière mise à jour :** 2026-08-13  
**Liens :** [ARCHITECTURE.md](./ARCHITECTURE.md) · [DECISIONS.md](./DECISIONS.md) · [../ci-cd-security.md](../ci-cd-security.md)

---

## 1. Principes

1. **Fail-closed** — absence de principal ou de droit ⇒ refus.
2. **Moindre privilège** — matrices d’écriture bornées par rôle.
3. **Aucun secret côté client** — JWT en header uniquement ; pas de mots de passe / PIN / hash dans les réponses.
4. **Audit non falsifiable** — produit serveur uniquement.
5. **Défense en profondeur** — CI Secrets + Security + Audit npm + lockout + CORS strict en prod.

---

## 2. RBAC

### 2.1 `PUT /api/backoffice/state`

Source : `backend/lib/backOfficeWritableEntities.js` (ADR-002).

| Rôle | Exemples de clés autorisées |
|------|-----------------------------|
| Super Admin | Toutes sauf `auditLog` et clés canoniques PG (écoles, élèves, enseignants/affectations, Finance, Pédagogie, **Plateforme**) |
| Admin Pays | users, academicConfigs… (plus `schools`, **plus clés plateforme PUT**) |
| Admin School | contacts, users, notes, documents… (plus Finance PUT, **plus plateforme PUT**) |
| Secrétaire | presences, messages, documents… (paiements via APIs dédiées, plus PUT Finance) |
| Comptable | **aucune** clé PUT state ; Finance exclusivement via `/api/payments` et `/api/finance/*` |
| Pédagogie (cours, EDT, évaluations, notes, présences) | **aucune** clé PUT state ; exclusivement via `/api/courses`, `/api/course-schedules`, `/api/evaluations`, `/api/notes`, `/api/presences` |
| Plateforme (pays, abonnements, notifications, RBAC graphiques) | **aucune** clé PUT state ; exclusivement via `/api/backoffice/countries`, `/subscriptions`, `/notifications`, `/role-permissions`, `/dashboard-chart-config`, collections abonnement |
| Préfet / Proviseur / DA | pédagogie (notes, classes, teachers…) |
| Enseignant | **uniquement** `evaluations` + `notes` (HOTFIX-SYNC-03) |

- Principal absent ⇒ aucune écriture.
- Clé hors matrice ⇒ **403** `Permission insuffisante pour modifier ces données.`
- Tests : `npm run verify:rbac-s1-4` · `npm run verify:rbac-admin-01`

### 2.2 Permissions applicatives

- Matrice Module:ACTION (security matrix) + permissions legacy seed.
- Web : `web/src/lib/permissions.ts`
- Mobile : `Mobile/src/domain/security/permissions.ts`
- UI : routes / actions masquées **et** refus serveur (jamais confiance UI seule).

---

## 3. JWT & authentification

| Règle | Détail |
|-------|--------|
| Transport | `Authorization: Bearer <accessToken>` uniquement (S2.1) |
| Interdit | `?token=` / `?access_token=` sur `/api/*` |
| Refresh | Session serveur + refresh token hashé |
| Mobile | SecureStore ; HTTPS en production |
| Tests | `npm run verify:jwt-header` |

### Lockout

- SoT : table PostgreSQL `login_lockouts` (`backend/lib/loginLockout.js` + `loginLockoutPgStore.js`)
- Clé : `school_scope` (code établissement ou `*` plateforme) + identifiant normalisé (trim/lower)
- Seuil : 5 échecs → verrouillage ~15 minutes (atomique `INSERT … ON CONFLICT`)
- Succès → `DELETE` ; expiration → reset lazy
- Interdit de désactiver le lockout en production (`SOMAFRIK_DISABLE_LOGIN_LOCKOUT`)
- `POST /api/backoffice/e2e/clear-login-lockout` : **404** sauf `SOMAFRIK_E2E=true` et `NODE_ENV !== production`
- Préprod : lockout **activé** + rate limits sur les routes login
- Tests : `npm run verify:login-lockout-data`

---

## 4. Audit

| | |
|--|--|
| **Décision** | ADR-003 / ADR-004 |
| **Client** | Ne jamais envoyer `auditLog` (strip DataContext + 403 si présent) |
| **Serveur** | `AuditService.record` — `userId`, `schoolCode`, action, entity, IP, UA |
| **Stockage** | Table `audit_logs` (JSONB old/new) |
| **Collections critiques** | users, payments, bulletins, rolePermissions, classes, teachers, assignments… |
| **Export établissement** | action `export_school_data` (domaines + timestamp, **pas** le contenu) |

---

## 5. Secrets

| Secret | Usage | Contrainte |
|--------|-------|------------|
| `JWT_SECRET` | Signature tokens | ≥ 32 caractères |
| `DATABASE_URL` / Postgres | Connexion DB | SSL selon env |
| `BOOTSTRAP_SUPERADMIN_PASSWORD` | Bootstrap préprod | ≥ 12 car., hors git |
| Clés cloud (Render, Vercel, EAS) | Déploiement | Dashboards uniquement |

### Contrôles

- **Gitleaks 8.24.3** en CI (check **Secrets**)
- `.gitignore` : `.env`, `.env.preproduction`, `.env.local`, keystores…
- Validation secrets production : `backend/lib/productionSecrets.js`
- Local : `npm run verify:secrets`

**Jamais** committer un `.env` réel ni coller un token dans une PR / un ticket.

---

## 6. Rotation

| Élément | Fréquence recommandée | Action |
|---------|----------------------|--------|
| `JWT_SECRET` | À compromission ou rotation annuelle | Nouveau secret → redéploiement API → invalidation sessions |
| Mots de passe superadmin / ops | À chaque départ collaborateur | `preprod:repair-superadmin` / reset ops |
| `DATABASE_URL` credentials | Selon politique hébergeur | Rotation Render/Supabase + MAJ env |
| Tokens CI / deploy | À départ ou fuite | Régénérer GitHub / Vercel / Render |

Après rotation JWT : tous les utilisateurs doivent se reconnecter.

---

## 7. Sauvegardes

| Env | Responsable | Attente minimale |
|-----|-------------|------------------|
| Préprod (Render/Supabase) | Ops / CTO | Snapshots hébergeur activés |
| Prod Postgres | Ops | Sauvegardes automatiques + test de restauration périodique |
| Volumes Docker locaux | Dev | Non critiques (recréables) |

Procédure de restauration : [OPERATIONS.md](./OPERATIONS.md).

---

## 8. Surface d’attaque — contrôles CI

Voir [../ci-cd-security.md](../ci-cd-security.md).

| Check | Contenu |
|-------|---------|
| Secrets | Gitleaks |
| Security | `verify:db-config` + `verify:mobile-security` + `verify:login-lockout-data` + `verify:data-export-safety` |
| TypeScript / Lint | Qualité |
| Tests | verify JWT, RBAC, sanitize, check… |
| Audit | `npm audit` fail si **critical** |

---

## 9. Politique de divulgation

1. **Ne pas** ouvrir d’issue publique détaillant un exploit exploitable.
2. Contacter le CTO / propriétaire du dépôt (`somafrik@outlook.fr` / canal privé équipe).
3. Délai de remediation cible : critique ≤ 72 h, haute ≤ 7 j, moyenne planifiée.
4. Hotfix via branche `hotfix/*` + gate préprod ([CONTRIBUTING.md](./CONTRIBUTING.md)).
5. Après correctif : entrée CHANGELOG **Security** + ADR si règle durable.

---

## 10. Checklist rapide auteur PR

- [ ] Pas de secret dans le diff
- [ ] Pas d’élargissement RBAC non documenté
- [ ] Pas d’`auditLog` client
- [ ] JWT toujours en header
- [ ] Tests `verify:*` du périmètre sécurité touché
