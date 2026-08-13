# Roadmap produit — Somafrik

**Statut :** source de vérité officielle des développements  
**Dernière mise à jour :** 2026-08-13
**Branche de référence :** `develop`  
**Suivi Design System granulaire :** [../ux/design-system/SUIVI-MIGRATIONS.md](../ux/design-system/SUIVI-MIGRATIONS.md)

**Pilotage :** produit ([ROADMAP](./ROADMAP.md)) · technique ([ARCHITECTURE](./ARCHITECTURE.md)) · décisions ([DECISIONS](./DECISIONS.md)) · tests ([TESTING](./TESTING.md)) · sécurité ([SECURITY](./SECURITY.md)) · ops ([OPERATIONS](./OPERATIONS.md)) · data ([DATABASE](./DATABASE.md))

Toute PR fonctionnelle doit référencer une **phase** (A–J) et, si applicable, une **release** ([RELEASES.md](./RELEASES.md)). Voir aussi la règle doc dans [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## 1. Vision produit

Somafrik est une plateforme SaaS de **gouvernance scolaire** pour l’Afrique francophone : du pays à la classe, du backoffice établissement à l’application mobile (enseignants, parents, élèves).

La plateforme unifie :

- l’administration multi-tenant (pays → établissements) ;
- la vie scolaire (élèves, classes, enseignants, présences, notes, bulletins) ;
- la finance scolaire et les abonnements ;
- la communication et, à terme, l’assistance IA.

---

## 2. Objectifs long terme

| Horizon | Objectif |
|---------|----------|
| Court | Stabiliser la préproduction (auth, RBAC, sync, persistance PG) |
| Moyen | Couvrir le cycle scolaire complet (présences → notes → bulletins → finance) |
| Long | Mobile production-ready, IA pédagogique, internationalisation (pays / langues) |

---

## 3. Principes d’ingénierie

1. **Documentation = source de vérité** — toute évolution met à jour `docs/project/` et les contrats DS concernés.
2. **Fail-closed RBAC** — aucun élargissement implicite des droits ; `auditLog` jamais writable client.
3. **Sync non destructive** — outbox + ACK ; pas de perte silencieuse de mutations locales.
4. **PostgreSQL canonique** — les domaines critiques (présences, notes) migrent vers des tables PG avec contrats explicites.
5. **Hotfix avant roadmap** — un incident préprod bloque la phase suivante jusqu’à clôture CTO.
6. **Git Flow** — `develop` → Draft PR → CI/Security → review CTO → merge → préprod → production ([CONTRIBUTING.md](./CONTRIBUTING.md)).
7. **Reconstruction contrôlée** — V2 est construite en parallèle et migre une capacité à la fois ; aucun cutover sans parité et Go CTO ([V2-RECONSTRUCTION.md](./V2-RECONSTRUCTION.md)).

---

## 4. État actuel du projet (synthèse)

| Domaine | État |
|---------|------|
| Fondation / sécurité (S1–S2) | ✅ Opérationnel |
| Design System D2.x + EntityPage D2.7–D2.8 | ✅ Clos |
| Élèves / Classes / Enseignants (listes) | ✅ Stabilisé |
| Parents (contrat identité) | ✅ Clos · chrome DS 🔒 |
| Présences (contrat + PG) | ✅ Clos · ToolLayout 🔒 |
| Notes (PG + ToolLayout + sync enseignant) | ✅ Stabilisé · Bulletins 🔒 |
| Sync outbox | ✅ SYNC-01/02/03 · SYNC-04 isolé |
| Hotfix Admin auditLog | ✅ RBAC-ADMIN-01 mergé |
| Reconstruction V2 | 🚧 V2.0 fondation et frontières |
| Finance opérations / RH | 🔒 Verrouillé (persistance LOT 4 ✅) |
| Pédagogie (cours, EDT, notes, présences) | 🔒 Verrouillé (persistance LOT 5 ✅) |
| Mobile production / IA / i18n | 📋 Planifié |

---

## 5. Modules terminés

- Sécurité API : sanitization réponses (S1.3), RBAC state (S1.4), JWT header-only (S2.1), DB config (S2.2), mobile hardening (S2.3), CI Security (S2.4)
- Design System D2.1 → D2.8e (EntityPage extracté)
- Élèves (fiche + liste + inscriptions C1.8a/b)
- Classes métier D3.2 (liste + membres)
- Enseignants D3.3 (liste)
- Parents D3.4a/b (identité `contactId`)
- Présences D3.5a/b
- Notes D3.6a/b/c + HOTFIX-SYNC-01/02/03
- HOTFIX-RBAC-ADMIN-01 (classes/enseignants sans `auditLog` client)

## 6. Modules en cours / dette active

| Item | Statut | Phase |
|------|--------|-------|
| V2.0 (structure, frontières, tenant scope) | En cours | Transverse A–E |
| SYNC-04 (SAVEPOINT / codes `GRADE_*`) | Isolé | D / E |
| Fiches Classe / Enseignant / Parent | 🔒 produit | E |
| Chrome DS Présences (`ToolLayout`) | 🔒 | E |
| Bulletins D3.7 | 🔒 après Notes | E |
| Finance persistance PostgreSQL (LOT 4) | ✅ | F (persistance) |
| Finance opérations produit (reporting, RH, extras) | 🔒 | F |

## 7. Modules planifiés

Voir phases F → J ci-dessous.

## 8. Dette technique

| Dette | Sévérité | Mitigation |
|-------|----------|------------|
| Snapshot `backoffice_state` partagé entre domaines | Haute | Migration V2 progressive vers API métier + PostgreSQL canonique (LOTS 1–4 : PUT `schools` / `students` / `teachers` / `assignments` / Finance retirés) |
| Workflows encore porteurs d’`auditLog` client (Contacts) | Moyenne | Filet DataContext + strip ; migration progressive |
| SYNC-04 non livré | Moyenne | Isoler après validation préprod Notes |
| Monolithes UI (`ConfigurationPage`, modales EntityPage) | Basse | Extractions D2.8 pattern |
| Expo / audit npm Mobile | Basse | Migration Expo ciblée |

## 9. Hotfixes (registre)

| ID | Objet | Statut |
|----|-------|--------|
| HOTFIX-SYNC-01 | Sync non destructive / outbox | ✅ |
| HOTFIX-SYNC-02 | Rattachement évaluations PG | ✅ |
| HOTFIX-SYNC-03 | RBAC enseignant evaluations/notes | ✅ (#79) |
| HOTFIX-RBAC-ADMIN-01 | Classes/enseignants sans auditLog client | ✅ (#81) |
| SYNC-04 | SAVEPOINT / GRADE_* | ⏳ Isolé |

## 10. Releases

Voir [RELEASES.md](./RELEASES.md). Release courante de référence : **v1.0 Préproduction**.

## 11. Prochaine fonctionnalité (candidat CTO)

Sous réserve de validation préprod post-RBAC-ADMIN-01 :

1. Gate préprod classes / enseignants (création, modif, suppression, affectation)
2. Puis instruction CTO explicite pour ouvrir **Bulletins (D3.7)** ou **SYNC-04** — pas les deux en parallèle sans décision.

---

## Phases numérotées

### Phase A — Fondation

| | |
|--|--|
| **Objectif** | Socle produit, comptes, multi-tenant, sécurité de base |
| **Préconditions** | Dépôt, stack Node 22, Docker |
| **Fonctionnalités** | Auth backoffice/mobile, superadmin, Admin Pays / School, seed contrôlé |
| **Critères de validation** | Login 401 (faux) / 200 (vrai) ; bootstrap runtime vert |
| **Statut** | ✅ Clos |

### Phase B — Infrastructure

| | |
|--|--|
| **Objectif** | CI/CD, secrets, DB, hébergement préprod/prod |
| **Préconditions** | Phase A |
| **Fonctionnalités** | GitHub Actions Security, Gitleaks, Render API, Vercel web, PostgreSQL/Supabase, Docker Compose |
| **Critères de validation** | Checks required verts ; `verify:runtime-bootstrap` ; health API préprod |
| **Statut** | ✅ Clos (entretien continu) |

### Phase C — Backoffice

| | |
|--|--|
| **Objectif** | Plateforme web d’administration (pays → établissement) |
| **Préconditions** | Phases A–B |
| **Fonctionnalités** | Dashboard, établissements, utilisateurs, paramètres, abonnements, EntityPage |
| **Critères de validation** | RBAC S1.4 ; scopes tenant ; CRUD établissement sans 403 injustifié |
| **Statut** | ✅ Stabilisé |

### Phase D — Refactoring (Design System)

| | |
|--|--|
| **Objectif** | UI cohérente, EntityPage extracté, migrations D2/D3 |
| **Préconditions** | Phase C |
| **Fonctionnalités** | DS D2.1–D2.8, listes Élèves/Classes/Enseignants, contrats données |
| **Critères de validation** | Tag/clôture par lot ; SUIVI-MIGRATIONS à jour ; pas de régression RBAC |
| **Statut** | ✅ D2 clos · D3 partiel (suite verrouillée) |

### Phase E — Vie scolaire

| | |
|--|--|
| **Objectif** | Cycle pédagogique quotidien |
| **Préconditions** | Phases C–D ; hotfixes sync/RBAC clos |
| **Fonctionnalités** | Présences, Notes/Évaluations, Bulletins, Planning, affectations |
| **Critères de validation** | Persistance PG ; ACK sync ; gate préprod par module |
| **Statut** | ⏳ En cours (Présences/Notes ✅ · Bulletins 🔒 · SYNC-04 ⏳) |

### Phase F — Finance

| | |
|--|--|
| **Objectif** | Frais, tarifs, paiements, impayés, abonnements école |
| **Préconditions** | Vie scolaire stabilisée ; instruction CTO |
| **Fonctionnalités** | Grilles tarifaires, paiements, relances, reporting financier |
| **Critères de validation** | RBAC Comptable/Secrétaire ; audit serveur ; pas d’`auditLog` client |
| **Statut** | ✅ Persistance LOT 5 (PostgreSQL SoT pédagogie, PUT pédagogie interdit) · lots 6–8 bloqués |

### Phase G — Communication

| | |
|--|--|
| **Objectif** | Messages, annonces, notifications multi-canal |
| **Préconditions** | Phase E minimale ; contacts/relations stables |
| **Fonctionnalités** | Messagerie enseignant↔parent, annonces établissement, notifications plateforme |
| **Critères de validation** | Scopes destinataires ; pas de fuite cross-tenant |
| **Statut** | 📋 Planifié |

### Phase H — Mobile

| | |
|--|--|
| **Objectif** | Apps Expo production (enseignant, parent, élève) |
| **Préconditions** | API stables ; SecureStore ; HTTPS |
| **Fonctionnalités** | Appels, notes, bulletins, messagerie, mode hors-ligne contrôlé |
| **Critères de validation** | `verify:mobile-security` ; stores readiness ; sync outbox alignée |
| **Statut** | 📋 Planifié (MVP existant) |

### Phase I — IA

| | |
|--|--|
| **Objectif** | Assistance pédagogique et opérationnelle |
| **Préconditions** | Données canoniques PG ; politiques confidentialité |
| **Fonctionnalités** | Aide à la rédaction, alertes risque d’échec, copilote admin |
| **Critères de validation** | Opt-in, audit, pas d’exfiltration PII |
| **Statut** | 📋 Planifié |

### Phase J — Internationalisation

| | |
|--|--|
| **Objectif** | Multi-pays, multi-langues, devises, calendriers scolaires |
| **Préconditions** | Phases E–F stables |
| **Fonctionnalités** | i18n UI, packs pays, devises, années scolaires locales |
| **Critères de validation** | Isolation tenant pays ; pas de régression RBAC |
| **Statut** | 📋 Planifié |

---

## Règle de mise à jour

À chaque merge sur `develop` qui change le périmètre fonctionnel :

1. Mettre à jour ce fichier (statut phase / modules / hotfixes)
2. Ajouter une entrée dans [CHANGELOG.md](./CHANGELOG.md)
3. Si décision d’architecture : [DECISIONS.md](./DECISIONS.md)
4. Si jalon release : [RELEASES.md](./RELEASES.md)
