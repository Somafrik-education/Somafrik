# Changelog — Somafrik

Toutes les évolutions notables de ce projet sont documentées dans ce fichier.

Le format s’inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versioning sémantique](https://semver.org/lang/fr/) pour les releases produit ([RELEASES.md](./RELEASES.md)).

**Règle :** toute PR mergée qui change le comportement observable ou l’architecture doit ajouter une entrée ici (sous `[Unreleased]` puis bascule à la release).

---

## [Unreleased]

### Added

- Ouverture du chantier de reconstruction contrôlée Somafrik V2 : structure `apps/` / `packages/` / `tests/v2/`, premier invariant tenant scope et garde-fou CI des frontières legacy.
- Gouvernance documentaire officielle sous `docs/project/` (ROADMAP, ARCHITECTURE, CHANGELOG, RELEASES, CONTRIBUTING, DECISIONS) — PR #82.
- Extension gouvernance SaaS : [TESTING.md](./TESTING.md), [SECURITY.md](./SECURITY.md), [OPERATIONS.md](./OPERATIONS.md), [DATABASE.md](./DATABASE.md).
- Règle CONTRIBUTING : PR fonctionnelle incomplète sans mise à jour doc de gouvernance lorsque nécessaire.

---

## [1.0.0-preprod] — 2026-07-26

Jalonnement préproduction MVP — base `develop` après HOTFIX-RBAC-ADMIN-01 (#81).

### Added

- **D2.8 — EntityPage** (a→e) : extraction colonnes, options select, noyau CRUD, workflows affectations / contacts / relations / paiements, nettoyage assembleur.
- **D3.2 — Classes** : audit D3.2a, liste D3.2b, membres D3.2c (tag `d3.2a`).
- **D3.3 — Enseignants** : liste via EntityPage.
- **D3.4 — Parents** : audit + contrat d’identité `contactId` (D3.4b).
- **D3.5 — Présences** : contrat + persistance PG canonique.
- **D3.6 — Notes** : contrat PG, ToolLayout `/notes`, sync évaluations.
- **HOTFIX-SYNC-01** : outbox non destructive + ACK.
- **HOTFIX-SYNC-02** : rattachement évaluations / `syncError` visible.
- **HOTFIX-SYNC-03** : RBAC enseignant `evaluations` + `notes` (#79).
- **HOTFIX-RBAC-ADMIN-01** : classes/enseignants sans `auditLog` client ; audit serveur (#81).
- Filet CI `verify:runtime-bootstrap` (post P0 AUTH).
- Inscriptions élèves C1.8a / C1.8b (valider, affecter, transfert, clôture).

### Changed

- Matrice d’écriture `PUT /backoffice/state` fail-closed par rôle (S1.4).
- Notes UI et EntityPage classes/enseignants : plus d’envoi client de `auditLog`.
- DataContext : strip systématique de `auditLog` avant PUT.

### Fixed

- Sync enseignant bloquée (`Permission insuffisante…`) — KNOWN-ISSUE-NOTES-01 clôturée par SYNC-03.
- Création classe/enseignant rejetée à cause de `auditLog` client — RBAC-ADMIN-01.
- Rattachement évaluations en échec silencieux — SYNC-02.

### Removed

- Écriture client de `auditLog` pour Notes, classes, enseignants, affectations (reste interdit pour tous les rôles).

### Security

- S1.3 sanitization réponses utilisateur.
- S1.4 RBAC backoffice + MVP.
- S2.1 JWT header-only (plus de token en query).
- S2.2 / S2.2.1 durcissement config DB.
- S2.3 mobile SecureStore / HTTPS.
- S2.4 CI Security (Secrets, Security, TypeScript, Lint, Tests, Audit).

---

## Légende des sections

| Section | Usage |
|---------|-------|
| **Added** | Nouvelles fonctionnalités |
| **Changed** | Changements de comportement rétrocompatibles ou migrations |
| **Fixed** | Corrections de bugs |
| **Removed** | Suppressions / dépréciations effectives |
| **Security** | Correctifs ou durcissements sécurité |
