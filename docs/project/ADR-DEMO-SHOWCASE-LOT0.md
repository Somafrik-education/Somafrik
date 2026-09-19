# ADR-015 — Environnement Démo commercial (LOT 0)

**Statut :** Proposée — DEMO-0 contrat, en revue CTO  
**Date :** 2026-09-14  
**Source :** audit CTO [`docs/audits/demo-vitrine-cto-2026-09-14.md`](../audits/demo-vitrine-cto-2026-09-14.md) (`develop@5409019c`)

Cette ADR **fige** les contrats obligatoires pour DEMO-1 à DEMO-5. Elle n’ouvre pas d’environnement, de route, de session, de CTA vitrine, ni de base PostgreSQL Demo.

---

## 1. Flux canonique

```text
somafrik.app
  → /demo                    (qualification, indexable)
  → POST api-demo …/demo-sessions
  → code opaque one-shot
  → demo.somafrik.app/?code=
  → échange du code
  → session Démo
  → suppression immédiate du code de l’URL
```

**Interdit :** bouton vitrine → copie de préproduction.  
**Interdit :** JWT dans l’URL (`?token=`, `?access_token=`, ou JWT en clair dans `?code=`).

Le paramètre d’échange s’appelle **`code`**. Ce n’est pas un JWT. Entropy ≥ 128 bits, usage unique, TTL court (≤ 120 s).

---

## 2. Trois frontières (PROD ≠ PREPROD ≠ DEMO)

| | Front | API | `APP_ENV` | Base |
|--|-------|-----|-----------|------|
| PROD | `https://somafrik.app` | `https://api.somafrik.app` | `production` | PostgreSQL PROD |
| PREPROD | `https://preprod.somafrik.app` | API PREPROD | `preproduction` | PostgreSQL PREPROD |
| DEMO | `https://demo.somafrik.app` | `https://api-demo.somafrik.app` | `demo` | PostgreSQL DEMO |

Aucun secret, clé de signature JWT, stockage, webhook ou base n’est partagé avec PROD.

CORS production **n’ajoute jamais** `https://demo.somafrik.app`.  
Le backend Demo n’autorise que les origines strictement nécessaires :

- `https://somafrik.app` — mint de session depuis la vitrine
- `https://demo.somafrik.app` — application Demo

Variable d’origine Demo : `DEMO_FRONTEND_ORIGIN`.

---

## 3. Démo ≠ essai 30 jours

| Parcours | Route | Public | Finalité |
|----------|-------|--------|----------|
| Découverte | `/demo` | oui | Toute personne qui veut voir Somafrik |
| Essai établissement | `/demande-essai` | oui | Prospect qualifié, essai réel 30 jours |

`/demande-essai` **reste intact**. Conversion après Demo : CTA vers `/demande-essai`.

Téléphone et e-mail **ne sont pas obligatoires** sur `/demo`. Ils le restent sur `/demande-essai`.

---

## 4. Qualification (DEMO-1)

Champs obligatoires : `profile`, `discoveryRole`, `country` (ISO 3166-1 alpha-2).  
Facultatif : `organizationName`.  
Interdit comme obligatoire : `phone`, `email`.

Le pays de la Démo **n’est pas** limité à la liste Afrique francophone de `/demande-essai` (investisseurs, partenaires, chercheurs).

Matrice figée : `backend/contracts/demo/qualification.js`.

---

## 5. Handshake session (DEMO-2)

1. `POST /api/public/demo-sessions` (origine vitrine) → `{ code, expiresAt, enterUrl }`
2. Navigation vers `https://demo.somafrik.app/session?code=…`
3. `POST /api/public/demo-sessions/exchange` `{ code }` → session cookie / bearer Demo
4. `history.replaceState` : le `code` disparaît de l’URL
5. Le code est invalidé (one-shot)

Rate-limit + anti-bot sur le mint. Sessions courtes, révocables, isolées de PROD.

---

## 6. Seed legacy vs dataset Demo

`demoSeedPolicy` / `VITE_SHOW_DEMO_ACCOUNTS` / `scripts/reset-demo-data.ps1` = **comptes techniques locaux**.  
Ils ne sont **pas** l’environnement public Démo.

Production : `SOMAFRIK_SKIP_DEMO_SEED=true` **reste obligatoire** même si un serveur Demo tourne avec `NODE_ENV=production`.

Reset commercial : `npm run demo:reset` (DEMO-2) sur la base Demo uniquement, dataset déterministe, idempotent. Les KPI Dashboard se calculent depuis ces données, sans fabrication parallèle.

---

## 7. Drapeaux — noms explicites

| Variable | Rôle |
|----------|------|
| `APP_ENV=demo` | Frontière serveur Demo (comme `production` / `preproduction`) |
| `SOMAFRIK_APP_ENV=demo` | Alias documentaire / client, jamais un substitut flou |
| `SOMAFRIK_DEMO_MODE=true` | Mode Demo explicite (sandbox externalités, watermark) |
| `VITE_DEMO_ENV_URL` | URL de l’application Demo ; vide = CTA d’entrée désactivé |
| `DEMO_FRONTEND_ORIGIN` | Origine CORS Demo |

**Interdit :** réutiliser `VITE_SHOW_DEMO_ACCOUNTS` ou `EXPO_PUBLIC_DEMO_MODE` pour l’environnement public.

---

## 8. Sandbox, capture, SEO

Externalités (SMS, e-mail, push, paiements, WhatsApp, webhooks) → sandbox / simulation.  
Superadmin plateforme inaccessible. Suppression compte/tenant contrôlée. Mutations métier **autorisées**.

Anti-capture : Android `FLAG_SECURE` ; iOS détection/masquage sans promesse absolue ; Web watermark `SOMAFRIK — DÉMONSTRATION — DONNÉES FICTIVES — DEMO-XXXX` (pas de PII).

SEO : `somafrik.app/demo` indexable ; `demo.somafrik.app/*` = `noindex, nofollow` + `X-Robots-Tag`. CSP Demo : `frame-ancestors 'none'`.

---

## 9. Analytics (facultatif DEMO-0, requis avant campagne)

`demo_cta_clicked` → `demo_qualification_started` → `demo_profile_selected` → `demo_session_created` → `demo_entered` → `demo_trial_request_clicked`

Propriétés autorisées : `profile`, `discovery_role`, `country` (ISO).  
Interdit : nom, e-mail, téléphone, nom d’établissement, données scolaires.

---

## 10. DEMO-0 ne fait pas

- aucune migration SQL
- aucune route `/demo` ni `/api/public/demo-sessions`
- aucun CTA vitrine
- aucun `docker-compose.demo.yml` / `.env.demo.example`
- aucun `APP_ENV=demo` dans `corsConfig.js`
- aucun `npm run demo:reset`
- aucune UI watermark / bannière Mode Démo
- aucune modification de `/demande-essai`

Code autorisé : modules de **contrat** + tests (`backend/contracts/demo/**`) + documentation.

---

## 11. Ordre après merge DEMO-0

DEMO-1 vitrine → DEMO-2 backend/infra → DEMO-3 Web Demo → DEMO-4 Mobile Demo → DEMO-5 E2E/conversion.

Gate npm : `verify:demo-lot0`.
