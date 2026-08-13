# Stratégie de tests — Somafrik

**Statut :** référence qualité & gates  
**Dernière mise à jour :** 2026-08-13
**Liens :** [RELEASES.md](./RELEASES.md) · [CONTRIBUTING.md](./CONTRIBUTING.md) · [../ci-cd-security.md](../ci-cd-security.md)

---

## 1. Principes

1. **Fail-closed** — prouver les 403 / 401 autant que les 200.
2. **Preuves ciblées** — préférer `verify:*` liés au périmètre plutôt qu’une suite géante non pertinente.
3. **Pas de secrets** dans les fixtures ; comptes E2E via variables d’environnement.
4. **Gate préprod manuelle** après merge pour les domaines critiques (auth, RBAC, sync, classes/enseignants, notes).
5. Une PR n’est pas « terminée » sans les tests du périmètre touché **et** la doc de gouvernance si nécessaire.

---

## 2. Pyramide

```text
        /\
       /E2E\        Playwright / scripts verify-e2e-* (hors CI PR lourde)
      /------\
     / Intégr.\     verify:rbac-* · verify:notes-sync · verify:runtime-bootstrap
    /----------\
   /  Unitaire  \   Vitest (web) · assert Node (backend/lib/*.test.js)
  /--------------\
```

| Niveau | Où | Quand |
|--------|-----|-------|
| Unitaire | `web` Vitest · `backend/lib/*.test.js` | Chaque PR touchant le module |
| Intégration / contrat | `npm run verify:*` | CI Security + local |
| E2E API | `verify:e2e-api` / chaînes `0001`… | Avant gate préprod / release |
| E2E Mobile UI | Playwright (`verify:e2e-mobile`) | Hors chemin critique PR (trop lourd) |
| Gate préprod | Checklist CTO manuelle | Après déploiement `develop` |

---

## 3. Tests unitaires

### Web (Vitest)

```bash
cd web && VITE_API_URL=http://127.0.0.1:5000 npm test
# ou ciblé :
VITE_API_URL=http://127.0.0.1:5000 npx vitest run src/lib/stripClientAuditLog.test.ts
```

Couvre notamment : outbox sync, workflows EntityPage, permissions, strip `auditLog`.

### Backend

Fichiers `*.test.js` exécutés via scripts `verify:*` (pas de runner Jest dédié) :

- `gradesBoPersistence`, `evaluationAttachment`, `evaluationSyncRepository`
- `teacherNotesWriteAccess`
- helpers d’unicité présences, etc.

```bash
npm run verify:notes-sync
node backend/lib/teacherNotesWriteAccess.test.js
```

---

## 4. Tests d’intégration / contrats

| Commande | Objet |
|----------|-------|
| `npm run verify:rbac-s1-4` | Matrice écriture BO + MVP |
| `npm run verify:rbac-admin-01` | Classes/enseignants sans `auditLog` |
| `npm run verify:jwt-header` | JWT header-only |
| `npm run verify:sanitize-user-responses` | Pas de secrets dans les réponses |
| `npm run verify:db-config` | Config DB prod/préprod |
| `npm run verify:runtime-bootstrap` | `init` → health → login 401 |
| `npm run verify:classes-legacy-cleanup` | PUT `classes` interdit ; `/api/classes` + projection lecture |
| `npm run verify:schools-legacy-cleanup` | PUT `schools` interdit (seul, mixte `{schools,users}` / `{schools,subscriptions}`, snapshot) sans mutation partielle ; pays hors référentiel (`FR`) refusé ; `/api/backoffice/establishments` + projection lecture |
| `npm run verify:notes-sync` | Sync Notes / outbox / rattachement |
| `npm run verify:mobile-security` | SecureStore / HTTPS / client mobile |
| `npm run verify:v2-foundation` | Structure V2, frontières legacy, invariants domaine et auth V2.1a |
| `npm run test:v2-auth` | Rôles canoniques, `AuthPrincipal` immuable et `can()` fail-closed |
| `npm run typecheck` · `npm run lint` | Qualité statique |
| `npm run audit:ci` | Vulnérabilités **critical** |

CI PR (`security.yml` + `ci.yml`) : Secrets · Security · TypeScript · Lint · Tests · Audit · Lint et build.

---

## 5. Tests E2E

```bash
npm run verify:e2e-preflight   # bootstrap / santé
npm run verify:e2e-api         # suite API
npm run verify:e2e-mobile      # UI mobile Playwright
npm run verify:e2e-all         # agrégat
```

Chaînes numérotées (`verify:e2e-0001` …) pour parcours métier (finance, inscriptions, etc.).

**Note :** les E2E mobiles ne sont pas tous des required checks PR (durée). Les lancer avant une release ou un gate CTO.

Variables utiles : `SOMAFRIK_E2E_SUPERADMIN_ID` / `PASSWORD`, `SOMAFRIK_API_URL`, pins E2E documentés dans `scripts/e2e-api-helpers.js`.

---

## 6. Gates de préproduction

Après déploiement Render + Vercel (`develop`) :

### Gate Auth / runtime

- [ ] `GET /api/health` → 200, `database: postgresql`
- [ ] Login faux → **401** (jamais 500)
- [ ] Login valide → session + state

### Gate Classes / Enseignants (RBAC-ADMIN-01)

- [ ] Admin établissement : créer classe → PUT **200**, payload **sans** `auditLog`
- [ ] Reload complet → classe toujours présente (PG)
- [ ] Modifier / supprimer une classe → 200 + persistance
- [ ] Créer enseignant + affectation → 200, sans `auditLog`, persiste
- [ ] Nettoyage localStorage suffit pour les fantômes optimistes (pas de delete serveur)

### Gate Notes / sync enseignant

- [ ] Enseignant : evaluations/notes → ACK / outbox vide
- [ ] Hors affectation → 403 métier
- [ ] `auditLog` client → 403

### Gate CI

- [ ] Dernier merge `develop` : tous les checks verts

Détail Go/No Go par version : [RELEASES.md](./RELEASES.md).

---

## 7. Critères Go / No Go (transverses)

| | Go | No Go |
|--|----|-------|
| CI | Tous required verts | Un check rouge |
| RBAC | 403 sur hors-périmètre et `auditLog` | 200 inattendu / 500 |
| Persistance | Visible après hard reload | Uniquement localStorage / optimiste |
| Sync | ACK ou erreur métier explicite | Disparition silencieuse |
| Sécurité | Pas de secret dans logs/réponses | JWT en query, password en JSON |

---

## 8. Responsabilités

| Acteur | Rôle |
|--------|------|
| Auteur PR | Tests locaux du périmètre + doc |
| CI | Filet automatique |
| CTO | Gate préprod / Go release |

---

## 9. Mise à jour de ce document

Ajouter une section ou un script dès qu’un nouveau `verify:*` devient **obligatoire** pour un domaine, ou qu’un gate préprod change.
