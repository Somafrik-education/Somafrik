# Somafrik Démo — contrat d'architecture

Issue de gouvernance : #661.

## Objectif

Fournir une démonstration publique de Somafrik qui utilise les vrais parcours Web/Mobile et des données exclusivement fictives, sans dépendre des environnements Production ou Préproduction.

## Frontières d'environnement

| Environnement | Web | API | Données |
| --- | --- | --- | --- |
| Production | `https://somafrik.app` | `https://api.somafrik.app` | PostgreSQL PROD |
| Préproduction | `https://preprod.somafrik.app` | API PREPROD | PostgreSQL PREPROD |
| Démo | `https://demo.somafrik.app` | `https://api-demo.somafrik.app` | PostgreSQL DEMO dédié |

La Démo ne doit jamais utiliser la base, les secrets JWT, les stockages, les webhooks ou les externalités de PROD/PREPROD.

## Parcours public

1. `somafrik.app/demo` collecte une qualification légère.
2. Le backend public crée une demande de session Démo et retourne un code opaque, court et à usage unique.
3. Le navigateur est redirigé vers `demo.somafrik.app` avec ce code.
4. Le frontend Démo échange immédiatement le code contre une session Démo puis le retire de l'URL.
5. Aucun JWT, token de session ou secret durable ne doit apparaître dans une URL.

## Qualification minimale

Champs obligatoires :
- profil : direction/promoteur, administration scolaire, enseignant, personnel, parent, partenaire/ONG, investisseur, étudiant/chercheur, autre ;
- rôle dans la découverte : décideur, participant au choix, futur utilisateur, prescripteur, simple découverte ;
- pays.

Nom d'organisation facultatif. E-mail et téléphone non obligatoires pour entrer dans la Démo.

## Isolation et sécurité

- `APP_ENV=demo` constitue une frontière explicite distincte de `production` et `preproduction`.
- CORS Démo : uniquement l'origine Démo et les origines locales explicitement autorisées en développement.
- `NODE_ENV=production` reste utilisable sur l'infrastructure Démo ; le seed legacy interdit en production ne doit jamais être réactivé.
- Le dataset Démo est créé/réinitialisé par un mécanisme dédié, idempotent et nommé `demo:reset`.
- Aucune donnée importée depuis PROD/PREPROD.
- Les sessions Démo sont courtes, révocables et limitées à des rôles de démonstration.
- Aucun accès Superadmin plateforme dans la Démo publique.

## Externalités

Les opérations qui déclencheraient normalement une action externe doivent être neutralisées ou sandboxées : SMS, e-mail, push, paiements, WhatsApp et webhooks.

## Web

- watermark permanent : `SOMAFRIK — DÉMONSTRATION — DONNÉES FICTIVES — <session-id-court>` ;
- bannière visible « Mode Démo » ;
- `noindex, nofollow` sur l'application Démo ;
- `X-Robots-Tag: noindex, nofollow` recommandé au niveau hébergement ;
- protection anti-embedding via politique de framing/CSP.

## Mobile

- même API et même dataset Démo que le Web ;
- Android : protection native contre capture/enregistrement lorsque supportée (`FLAG_SECURE`) ;
- iOS : détection/masquage selon les capacités publiques de la plateforme, sans promesse de blocage absolu ;
- aucune configuration Mobile Démo ne doit pointer vers l'API PROD.

## Conversion commerciale

Le parcours existant `/demande-essai` reste séparé. La Démo se termine par un CTA vers la demande d'essai réel de 30 jours.

## Configuration externe non bloquante

DNS, services Render, base PostgreSQL Démo, secrets, domaines personnalisés et autres variables externes sont regroupés dans une PR `DEMO-CONFIG`. Leur absence ne bloque pas l'implémentation locale/CI, mais bloque le GO public de l'environnement Démo.

## Gouvernance de merge

Chaque lot est une PR séparée et aucun merge n'est autorisé sans :
1. diff GitHub indépendant CTO ;
2. branche à jour et mergeable ;
3. lint/typecheck/build pertinents ;
4. scan secrets ;
5. tests ciblés ;
6. aucune dérive de périmètre ;
7. preuve d'absence de dépendance PROD/PREPROD.
