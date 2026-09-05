# Preuves live préprod #503 — 5 septembre 2026

**Candidat git (Draft #505) :** renseigné dans `preprod-503-live.json` (`candidateSha`).  
**CTO :** GO technique sur les 4 correctifs #505 ; **NO GO merge** tant que ce mandat préprod n’est pas clos.  
**Cursor :** DEV. Pas de dashboard Render. Pas de write production. PR reste Draft.

## Script

```bash
npm run verify:preprod-503-local          # CI / mémoire, démo uniquement
npm run verify:preprod-503                # live préprod, non destructif
# Optionnel (recette uniquement) :
# SOMAFRIK_PREPROD_SUPERADMIN_ID=… \
# SOMAFRIK_PREPROD_SCHOOL_ID=… \
# SOMAFRIK_PREPROD_ERASURE_IDENTIFIER=… \
# npm run verify:preprod-503 -- --apply-reuse --apply-erasure
```

Aucun credential n’est versionné. Le JSON masque jetons / mots de passe.

## Constat live (lecture, 5 sept. 2026 ~12:38 UTC)

Sondes publiques, **sans** comptes préprod (credentials absents dans cet environnement).

| Sonde | Résultat | Lecture |
|---|---|---|
| `GET /api/health` | 200 `database=postgresql` `status=ok` | API up, PG |
| SHA dans `/api/health` | **absent** | `RENDER_*_DEPLOYED_SHA` à coller depuis le dashboard ops |
| `POST /api/privacy/erasure-requests` `{}` | **400** `PRIVACY_REQUEST_INVALID` | route **présente** (plus 404) |
| `POST /api/auth/revoke-all` | **401** JWT requis | route **présente** (plus 404) |
| `GET /api/students` et `/api/audit` sans JWT | **401** | auth en place |
| Superadmin / Admin Pays → 403 | **non exécuté** | credentials live absents |
| Admin School nominal + refresh CAS | **non exécuté** | idem |
| Effacement recette | **non exécuté** | `--apply-erasure` + compte recette requis |
| `GET https://preprod.somafrik.app/confidentialite` | 200 SPA | rewrite index.html |
| Chunk `LegalPages-D7LM86qb.js` | Oregon, Baudouin Okito, `contact@somafrik.app` | copies P1 **déployées** |
| Chemins internes `backend/` / `postgresRepository` | **absents** du chunk | OK |

Donc : l’API et le Web préprod **ne sont plus** le `develop` d’avant #504 (erasure 404 + bundle sans Oregon). Le SHA Render **n’est toujours pas** prouvable depuis le health public. Les 403 plateforme et le reuse refresh **attendent des comptes recette** fournis par l’ops (jamais en git).

## À coller par l’ops (sans secrets)

1. `RENDER_API_DEPLOYED_SHA`  
2. `RENDER_WEB_DEPLOYED_SHA`  
3. Les deux **égaux** au candidat #505 (ou au SHA `develop` déployé, documenté)  
4. Sortie `npm run verify:preprod-503` avec les identifiants recette en env  

## Interdit

Ready GitHub · merge · `main` · AAB · production · `npm audit fix --force`.
