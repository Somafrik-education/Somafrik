# Modèle — accord de sous-traitance établissement (art. 28)

**À adapter et signer hors git.** Opérateur : Baudouin Okito — France — `contact@somafrik.app`.  
Pas de SIREN / siège inventés.

1. **Objet** — l’opérateur fournit Somafrik (Web, API, application mobile) pour la gestion scolaire.
2. **Instructions** — uniquement les traitements nécessaires au service ; pas de réutilisation marketing.
3. **Personnel** — Superadmin / Admin Pays n’accèdent pas aux données personnelles métier d’un établissement.
4. **Sous-traitants ultérieurs** — Supabase, Render, Expo (liste `sous-traitants-transferts.md`). Information préalable en cas d’ajout.
5. **Sécurité** — HTTPS, RBAC, lockdown Data API, sessions courtes, journalisation sans secrets.
6. **Assistance droits** — demandes via `/suppression-compte` et `POST /api/privacy/erasure-requests` ; l’établissement reste responsable des dossiers scolaires.
7. **Violation** — information sans délai injustifié selon `procedure-violation-donnees.md`.
8. **Sortie** — export établissement (`GET /api/data-export`, rôles établissement uniquement) + anonymisation des comptes selon instruction.
9. **Audit** — droit d’audit documentaire raisonnable, sans accès direct production par un prestataire non habilité.

Ce modèle n’a pas de valeur contractuelle tant qu’il n’est pas signé.
