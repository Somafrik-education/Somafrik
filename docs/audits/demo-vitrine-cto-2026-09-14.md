# AUDIT CTO — Vitrine → Démo Somafrik

**Statut :** AUDIT + contrat DEMO-0 — aucune implémentation métier, aucun environnement créé.  
**Gouvernance :** PR Draft — pas de merge sans revue CTO.  
**Interdictions respectées (DEMO-0) :** pas d’environnement Demo, pas de route `/demo`, pas de session, pas de PostgreSQL Demo, pas de CTA vitrine, pas de `APP_ENV=demo` câblé, pas de `demo:reset`, pas de watermark, pas de modification du parcours `/demande-essai`.

| Champ | Valeur |
| --- | --- |
| Dépôt | Somafrik |
| Base | `develop` |
| SHA audité | `5409019c5d0aaee41479dc7a1c0fc4fe885b14ab` |
| Commit | `feat(report-card): E2E Playwright S1 Bulletins LOT 6→11 (#659 / #656) (#660)` |
| Date d’audit | 2026-09-14 |
| Verdict | **GO pour le chantier**, architecture `vitrine → /demo → session Demo isolée` |
| Contrat | [ADR-DEMO-SHOWCASE-LOT0.md](../project/ADR-DEMO-SHOWCASE-LOT0.md) |
| Gate | `npm run verify:demo-lot0` |

---

## Verdict

**GO pour le chantier**, mais **pas de simple bouton qui envoie directement vers une copie de préproduction**.

L’architecture correcte est :

```text
somafrik.app
  → qualification légère /demo
  → création d’une session Démo
  → demo.somafrik.app
  → api-demo.somafrik.app
  → PostgreSQL Démo dédié
```

Production et préproduction restent totalement séparées.

Le parcours existant **« Demander 1 mois d’essai gratuit »** (`/demande-essai`) reste distinct. Il ne doit pas être remplacé par la Démo.

---

## 1. État actuel de la vitrine

La vitrine est une application React/Vite. `/` est public, `/connexion` est public et `/demande-essai` existe déjà. Les écrans métier passent derrière les protections d’authentification.

Le contenu marketing est centralisé dans `web/src/data/marketingContent.ts`. C’est le point d’insertion des lots suivants (DEMO-1) : liens Connexion, Essai, Hero, CTA final.

### Positionnement CTA recommandé

| Emplacement    | État actuel                      | Cible                                                   |
| -------------- | -------------------------------- | ------------------------------------------------------- |
| Header desktop | Essai + Connexion                | **Découvrir la démo** + Essai + Connexion               |
| Header mobile  | Connexion + menu                 | **Démo visible rapidement**, Essai dans menu, Connexion |
| Hero           | Connexion + Essai + Voir produit | **Découvrir la démo** en CTA principal                  |
| CTA final      | Connexion + Essai                | **Découvrir la démo** + Demander un essai               |
| Footer         | Navigation/légal                 | lien Démo facultatif                                    |

Le Hero possède déjà trois actions. **Ne pas en ajouter une quatrième** : rehiérarchiser les CTA.

Bouton commercial principal :

**« Découvrir Somafrik en démo »**

et non « Essayer gratuitement », afin d’éviter la confusion avec l’essai réel de 30 jours.

---

## 2. Ne pas mélanger Démo et essai 30 jours

`/demande-essai` est un parcours commercial d’établissement (nom, fonction, établissement, pays, ville, téléphone, e-mail, taille, consentement). Rôles limités à Chef d’établissement, Promoteur, Directeur et Administrateur. Aucun compte ni tenant n’est créé automatiquement.

**Séparation validée.**

- `/demande-essai` : prospect qualifié souhaitant tester Somafrik dans son établissement.
- `/demo` : toute personne souhaitant découvrir Somafrik.

---

## 3. Qualification de la Démo

Formulaire extrêmement court avant l’entrée.

**Obligatoire :**

Profil :

`Direction / Promoteur` · `Administration scolaire` · `Enseignant` · `Personnel` · `Parent` · `Partenaire/ONG` · `Investisseur` · `Étudiant/Chercheur` · `Autre`

Puis : **« Quel est votre rôle dans la découverte de Somafrik ? »**

`Je décide` · `Je participe au choix` · `Je serai utilisateur` · `Je recommande des solutions` · `Je découvre simplement`

Puis : **Pays**.

Le nom de l’établissement/organisation est facultatif.

**Ni téléphone ni e-mail obligatoires** pour la démo instantanée.

À la sortie de la démo :

**« Vous représentez un établissement ? Demandez maintenant votre mois d’essai gratuit. »** → `/demande-essai`

---

## 4. Architecture d’accès retenue

```text
somafrik.app
  → /demo
  → qualification
  → demande de session anonyme
  → code opaque à usage unique et durée très courte
  → demo.somafrik.app
  → échange du code
  → session Démo
  → suppression immédiate du code de l’URL
```

**Interdit : JWT dans l’URL.** Le backend refuse déjà `?token=` / `?access_token=` sur `/api/*`. Le système Demo doit respecter cette philosophie. Le paramètre d’échange s’appelle `code`, jamais `token`.

---

## 5. P0 — le CORS actuel ne supporte pas Demo

Origines principales actuelles :

- `https://somafrik.app`
- `https://preprod.somafrik.app`

`demo.somafrik.app` est inconnu. **Il est interdit** d’ajouter la Démo aux origines de production.

Introduire explicitement **`APP_ENV=demo`** (DEMO-2) avec :

- `DEMO_FRONTEND_ORIGIN=https://demo.somafrik.app`
- API : `https://api-demo.somafrik.app`

Le backend Démo n’accepte que les origines strictement nécessaires (`https://somafrik.app` pour le mint depuis la vitrine, `https://demo.somafrik.app` pour l’application).

---

## 6. P0 — ne pas réutiliser le seed historique

`demoSeedPolicy` **n’est pas** l’environnement commercial Démo.

Ce mécanisme désactive le seed lorsque `NODE_ENV=production`, et la production exige `SOMAFRIK_SKIP_DEMO_SEED=true`. Cette protection reste intacte.

L’environnement Démo utilisera `npm run demo:reset` (DEMO-2) avec une base PostgreSQL Démo séparée et un dataset déterministe.

Même si le serveur Démo tourne avec `NODE_ENV=production`, le seed legacy ne sera jamais réactivé.

---

## 7. Isolation infrastructure

| Frontière | Front | API | APP_ENV | DB |
|-----------|-------|-----|---------|----|
| PROD | `somafrik.app` | `api.somafrik.app` | `production` | PROD |
| PREPROD | `preprod.somafrik.app` | API PREPROD | `preproduction` | PREPROD |
| DEMO | `demo.somafrik.app` | `api-demo.somafrik.app` | `demo` | DEMO |

Aucun secret, JWT signing key, stockage, webhook ou base de données ne doit être partagé avec PROD.

---

## 8. Protection anti-capture

**Android :** protection native type `FLAG_SECURE`.

**iOS :** détection d’enregistrement/partage d’écran + masquage lorsque l’OS le permet. Apple ne permet pas le blocage absolu des captures classiques via API publique ; aucun faux niveau de sécurité ne sera annoncé.

**Web :** watermark dynamique permanent et répété :

`SOMAFRIK — DÉMONSTRATION — DONNÉES FICTIVES — DEMO-7F32`

Pas de nom, e-mail ou téléphone dans le watermark.

Les mesures navigateur peuvent compliquer impression/copie, mais elles ne pourront jamais empêcher une capture OS ou une photographie externe.

---

## 9. SEO

`web/index.html` possède déjà titre, description, Open Graph et Twitter Card.

`web/public` ne contient actuellement **ni `robots.txt` ni sitemap**.

- `somafrik.app/demo` peut être indexable comme page commerciale.
- `demo.somafrik.app/*` doit être `noindex, nofollow`.
- `X-Robots-Tag: noindex, nofollow` au niveau de l’hébergement Démo.

Les données scolaires fictives et écrans applicatifs ne doivent jamais arriver dans Google.

---

## 10. Sécurité navigateur

Le backend possède déjà `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` et `Permissions-Policy`.

Pour la Démo : CSP stricte, notamment `frame-ancestors 'none'`.

Sessions courtes, révocables, isolées des sessions production.

---

## 11. Externalités interdites

Le visiteur a l’impression d’utiliser réellement Somafrik, sans déclencher de vraies actions externes.

| Canal | Comportement Demo |
|-------|-------------------|
| SMS | sandbox |
| E-mail | sandbox |
| Push | environnement Démo |
| Paiements | simulation |
| WhatsApp | simulation |
| Webhooks | sandbox / désactivés |
| Suppression de compte/tenant | contrôlée |
| Superadmin plateforme | inaccessible |

La modification des données Démo reste possible pour montrer la vraie application.

---

## 12. Dataset et reset

La base Démo reste mutable pendant la session. Un visiteur pourra enregistrer un paiement, faire un appel ou saisir une note.

Elle sera régulièrement remise dans un état de référence via un reset idempotent (`npm run demo:reset`).

Les statistiques sont calculées depuis les données canoniques, non fabriquées spécialement pour les cartes de dashboard.

---

## 13. Web et Mobile

Le même backend Démo alimente Web et Mobile (paiement Web → immédiatement cohérent sur Mobile). Smoke test permanent de convergence.

---

## 14. Analytics du tunnel Démo

Aucune instrumentation PostHog ou `gtag` évidente dans le code audité.

Mesure minimale :

```text
demo_cta_clicked
  → demo_qualification_started
  → demo_profile_selected
  → demo_session_created
  → demo_entered
  → demo_trial_request_clicked
```

Aucune donnée scolaire ou information personnelle sensible dans les événements.

PostHog est facultatif pour le premier lot, recommandé avant campagne marketing.

---

## 15. Attention au nom « comptes démo »

`VITE_SHOW_DEMO_ACCOUNTS` expose des comptes techniques de développement local, désactivés en production/préproduction.

**Ne pas réutiliser ce flag.**

Noms explicites :

- `VITE_DEMO_ENV_URL`
- `APP_ENV=demo` / `SOMAFRIK_APP_ENV=demo`
- `SOMAFRIK_DEMO_MODE=true`

---

## 16. Gouvernance GitHub — P1 indépendant

Le contrôle du branch endpoint indique actuellement **`develop protected: false`**.

La règle « aucun merge sans diff GitHub indépendant CTO » est aujourd’hui une règle de gouvernance, pas une contrainte GitHub.

Classé **P1 gouvernance**. Le chantier Démo ne doit pas modifier cette politique furtivement.

---

## Découpage

| Lot | Périmètre |
|-----|-----------|
| **DEMO-0** | Contrat & tests RED. Aucun environnement, aucune logique métier. |
| **DEMO-1** | Vitrine `/demo`, qualification, CTA, responsive, a11y, feature flag. CTA environnement final désactivable. |
| **DEMO-2** | `APP_ENV=demo`, API Demo, PostgreSQL dédié, CORS strict, session éphémère, rate-limit, anti-bot, dataset, `demo:reset`. |
| **DEMO-3** | Web Démo : isolation, watermark, bannière Mode Démo, sandbox, expiration, noindex. |
| **DEMO-4** | Mobile Démo : même dataset, parcours rôle, `FLAG_SECURE`, protections iOS, sandbox push. |
| **DEMO-5** | E2E & conversion : vitrine → qualification → Demo → manipulation → reset → `/demande-essai`, Web/Mobile, analytics. |

---

## Gates bloquantes avant fusion (lots 1–5)

Aucun lot n’est fusionné sans : diff GitHub indépendant CTO, branche à jour, périmètre contrôlé, lint/typecheck/build, secrets scan, tests ciblés RED→GREEN, aucune donnée réelle, aucune connexion PROD/PREPROD, isolation tenant/DB/secrets, CORS strict, sandbox externalités, protection anti-capture conforme à chaque plateforme, responsive 360/390/1024/1440, accessibilité du tunnel, noindex de l’application Démo et test du reset.

Les gates Démo complètent `ci.yml` / `pr-gates.yml` sans remettre les tests lourds dans chaque PR standard.

---

## Conclusion CTO

**Architecture validée.**

Le bouton s’intègre au site vitrine, conduit d’abord vers **`/demo`** pour qualifier légèrement le visiteur, puis seulement vers **`demo.somafrik.app`**.

`/demande-essai` reste intact et devient la conversion commerciale après découverte.

**DEMO-0** livre le contrat et les tests RED d’absence. PostHog reste facultatif jusqu’à DEMO-5 / campagne.
