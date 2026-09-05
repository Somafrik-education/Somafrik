# Preuves préprod #503 — 5 septembre 2026

**Candidat :** `1bb3c49d79ac0a6a1ac8fe954cb2bc819b5f1a18` (PR Draft #504)  
**CTO :** GO **étape préprod** ; **pas Ready**, **pas merge**, **pas production** tant que les preuves ci-dessous ne sont pas versées.  
**Cursor :** DEV uniquement. Pas de write production. Pas de déploiement Render (pas d’accès dashboard).

## Constat live (lecture seule, 5 sept. 2026 ~11:42 UTC)

Render préprod suit toujours **`develop`** (`bf5841a667fdee97ef587300acad8cef03f9b963`), pas le candidat.

| Sonde | Résultat | Lecture |
|---|---|---|
| `GET https://somafrik-api-preprod.onrender.com/api/health` | 200 `status=ok` `database=postgresql` `attachments.writable=true` | API préprod up, PG |
| `GET https://preprod.somafrik.app/connexion` | 200 | SPA up |
| Bundle Web | `assets/index-WzTnAyq8.js` — **pas** « Oregon », **pas** « Baudouin Okito » | pages légales P1 **non** déployées |
| `POST /api/privacy/erasure-requests` | **404** `Cannot POST` | workflow P1 **absent** de l’API live |
| `POST /api/auth/revoke-all` | **404** | P1 **absent** |
| `GET /api/students` sans JWT | **401** | auth présente (contrat develop) |
| `GET /api/audit` sans JWT | **401** | idem |
| SHA Render vs candidat | non exposé par `/api/health` | contrat `RENDER_*_DEPLOYED_SHA == candidat` **non tenu** |

Donc : le GO préprod **autorise** le déploiement du candidat ; il **n’est pas encore exécuté**. Les preuves P0/P1 (403 Superadmin, erasure, lockdown Data API au boot de ce SHA) **ne peuvent pas** être collectées sur l’API actuelle.

## Ce que l’ops doit faire (hors merge)

Sur Render, déployer **le même SHA** `1bb3c49d` (ou un HEAD ultérieur du même Draft, si CI verte) sur :

1. Web Service `somafrik-api-preprod`
2. Static Site `somafrik-web-preprod`

**Sans** merger #504 dans `develop`, **sans** promouvoir `main`.

Puis coller dans le ticket CTO (pas les secrets) :

1. SHA Render web = SHA Render API = candidat  
2. `GET /api/health` 200 PG  
3. `POST /api/privacy/erasure-requests` ≠ 404 (400/201 selon payload)  
4. Superadmin `GET /api/students` et `GET /api/audit` → **403**  
5. Login établissement + execute erasure sur un compte **de recette** + refus de reconnexion  
6. Dashboard Supabase Data API disabled + curl `anon` → 401 / denied (voir `supabase-data-api-lockdown.md`)  
7. Hostname pooler **seulement** (`aws-0-<région>.pooler.supabase.com`) pour le registre des transferts  
8. Restore : **pas** de restore prod ; si test, copie hors prod + rejeu erasure (`sauvegardes-restauration.md`)

## Interdit à ce stade

Ready GitHub · merge `develop` · promotion `main` · write production · `purge-retention` prod · inventer une région AWS.
