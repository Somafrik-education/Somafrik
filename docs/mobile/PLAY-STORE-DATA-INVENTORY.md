# Inventaire des données — Google Play (Somafrik Mobile)

Document d’inventaire pour la fiche Data safety / Data collection de Google Play.
Aucune donnée n’est inventée : seules les collectes réellement présentes dans le client Mobile et l’API Somafrik sont listées.

Cette PR **ne soumet pas** l’application sur Google Play.

## Tableau

| Donnée | Source | Finalité | Stockage local | Backend | Transit HTTPS | Logout / suppression |
| ------ | ------ | -------- | -------------- | ------- | ------------- | -------------------- |
| Identité (nom, rôle, identifiant de connexion) | Saisie login + profil session API | Authentification, affichage Home, périmètre école | SecureStore (`somafrik.sessionProfile`), device-only | PostgreSQL comptes | Oui | Logout : `clearSecureSession`. Suppression de compte **absente** (P0 Store) |
| E-mail | Compte utilisateur si renseigné côté API | Identification / communication établissement | Dans le profil session SecureStore s’il est renvoyé par l’API | PostgreSQL | Oui | Logout local. Pas d’endpoint self-delete |
| Téléphone | Compte / fiche élève-parent si renvoyé par l’API | Contact établissement | Profil session / listes métier hydratées en mémoire | PostgreSQL | Oui | Logout local. Pas d’endpoint self-delete |
| Notes / évaluations | API pédagogie | Consultation et saisie enseignant (LOT 2) | Mémoire + outbox fichier si mutation hors-ligne (payload sans secret) | PostgreSQL | Oui | Logout : outbox marquée `blocked_logout` |
| Présences | API présences | Appel / consultation | Mémoire + outbox fichier | PostgreSQL | Oui | Logout : outbox bloquée |
| Paiements | API finance | Consultation reçus, saisie autorisée | Mémoire + outbox fichier | PostgreSQL | Oui | Logout : outbox bloquée |
| Messages | API messages | Messagerie interne | Mémoire + outbox fichier | PostgreSQL | Oui | Logout : outbox bloquée |
| Annonces | API annonces | Information établissement | Mémoire (pas d’outbox) | PostgreSQL | Oui | Disparaît à la fermeture de session |
| Données scolaires (écoles, classes, élèves, emplois du temps) | API canonique hydratée | Périmètre métier | Mémoire runtime | PostgreSQL | Oui | Disparaît à la fermeture de session |
| Jetons d’accès / refresh | Login API | Session | SecureStore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | JWT côté API | Oui (header Authorization, jamais loggé) | Logout : suppression SecureStore |
| Photo de compte | Appareil photo / galerie (permission runtime) | Photo utilisateur | Fichier temporaire d’upload, pas de galerie Somafrik persistée | Stockage backend si upload | Oui | Non conservée localement après upload |

## Hors collecte Mobile

- Pas d’analytics tiers, pas de Sentry, pas de FCM, pas de NFC dans ce lot.
- Mot de passe et PIN : saisis, jamais persistés. PIN démo uniquement via `EXPO_PUBLIC_DEMO_PIN` en développement.
- L’outbox ne contient **aucun** `accessToken` / `refreshToken` / `password` / `pin` (LOT 5, `OUTBOX_SECRET_FORBIDDEN`).
