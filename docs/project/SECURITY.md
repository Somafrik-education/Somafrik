# Sécurité — Somafrik

**Statut :** politique & contrôles de sécurité  
**Dernière mise à jour :** 2026-09-01  
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

### 2.3 Attribution des rôles (Comptes V2)

Le backend fait autorité. Ne jamais faire confiance à `schoolCode`, `schoolId`, `role`, `roles`, `permissions`, `userId` provenant du client sans résolution depuis le principal authentifié.

| Règle | Détail |
|-------|--------|
| Création | Identité seule. `id` / `user_code` / `role` / `roles` client → 400 |
| GRANT / REVOKE | `POST /api/backoffice/users/:userId/roles/grant` et `.../revoke` — une opération, une transaction, un audit |
| Interdits Attribuer | `PARENT`, `STUDENT`, `SUPER_ADMIN`, rôles plateforme, tenant étranger, auto-promotion |
| Permissions | Union RBAC des `user_roles` actifs — jamais déduites du classement UI |
| Legacy | `PUT /api/backoffice/state` reste 410 / fail-closed ; aucun écriture `backoffice_state.users` |

Tests : `npm run verify:user-role-lifecycle`

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
| **Export établissement** | lectures dans une transaction PostgreSQL **`READ ONLY` + `REPEATABLE READ`** (snapshot unique) ; audit `export_school_data` après COMMIT (domaines + timestamp, **pas** le contenu) ; fail-closed si l’audit échoue |

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

Canal public de signalement : **`security@somafrik.app`**.

1. **Ne pas** ouvrir d’issue publique détaillant un exploit exploitable, ni publier un PoC avant correctif.
2. Contacter **`security@somafrik.app`**. Ne pas utiliser une adresse interne, personnelle, ou une identité Git comme canal de signalement.
3. Fournir uniquement les informations **minimales** nécessaires à la reproduction (produit, branche/version si connue, impact, étapes). **Ne pas** joindre de données personnelles inutiles (élèves, familles, secrets hors besoin de preuve).
4. Respecter la **divulgation responsable** : attendre un correctif avant toute publication.
5. Délai de remédiation **cible** (engagement d’effort, pas un SLA contractuel) : critique ≤ 72 h, haute ≤ 7 j, moyenne planifiée.
6. Hotfix via branche `hotfix/*` + gate préprod ([CONTRIBUTING.md](./CONTRIBUTING.md)).
7. Après correctif : entrée CHANGELOG **Security** + ADR si règle durable.

Résumé GitHub : [SECURITY.md](../../SECURITY.md) à la racine du dépôt.

Routage **security@somafrik.app** configuré et test de réception validé le **2026-09-01**. Canal hors dépôt (Cloudflare Email Routing). Ne pas documenter ici la destination interne.

Identité Git des auteurs : voir [CONTRIBUTING.md](./CONTRIBUTING.md) §3.1 — distincte de `security@somafrik.app` et des adresses fonctionnelles Somafrik.

---

## 10. Checklist rapide auteur PR

- [ ] Pas de secret dans le diff
- [ ] Pas d’élargissement RBAC non documenté
- [ ] Pas d’`auditLog` client
- [ ] JWT toujours en header
- [ ] Tests `verify:*` du périmètre sécurité touché
