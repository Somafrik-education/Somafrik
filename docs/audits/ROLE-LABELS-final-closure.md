# ROLE-LABELS — Replay final et clôture administrative

**Statut : DRAFT / HOLD — PAS READY — PAS MERGE**

**Verdict : ROLE_LABELS_CLOSED** (sous réserve CI GitHub sur cette PR)

Base obligatoire : `develop@f95c3f3864d7841fd0ee9a6ec2ea30a251528dbf` (merge #874)

Lot **AUDIT-ONLY**. Aucune modification fonctionnelle. Aucune migration.
Aucun backend / Web / Mobile produit. **Aucune nouvelle PR produit ROLE-LABELS.**

Preuves machine :

- `docs/audits/evidence/role-labels-final-closure.json`
- `backend/lib/roleLabelsFinalReplay.test.js` (RLF-01 → RLF-16)

---

## 0. Chaîne mergée (ne pas rouvrir)

| Lot | PR | Merge SHA | Objet |
|---|---|---|---|
| AUDIT-ROLE-LABELS-01 | #871 | `2da77d96` | Option B, 12 rôles, collision Directeur |
| ROLE-LABELS-API-01 | #872 | `4fbbd2b9` | `effectiveRoleLabel` / `effectiveRoleLabels[]` |
| ROLE-LABELS-WEB-01 | #873 | `eb862377` | Surfaces Web + attribution `roleKey` fail-closed |
| ROLE-LABELS-MOBILE-01 | #874 | `f95c3f38` | Session, Drawer, Users, grant/revoke, Messages |

Reliquat administratif **hors chantier**, Draft, ne pas merger :

| PR | Recommandation |
|---|---|
| #856 | **CLOSE WITHOUT MERGE** — ancien replay sécurité P0/P1, dépassé |

---

## 1. Replay intégré `develop@f95c3f38`

| Suite | Résultat local |
|---|---|
| `test:audit-role-labels-01` | PASS |
| `test:role-labels-api-01` (39) | PASS |
| `test:role-labels-web-01` (68) | PASS |
| `test:role-labels-mobile-01` (67) | PASS |
| ADMIN-02B `functionalRbacAdmin02b` + audit | PASS |

---

## 2. Contrat figé (ne plus rouvrir)

| Règle | Preuve |
|---|---|
| Édition `displayLabel` **Superadmin uniquement** | RLF-03 · RL-07/08 |
| `roleKey` / `roleCode` / JWT / RBAC inchangés | RLF-04 · API-RL-03/04/24 |
| Collision `SCHOOL_ADMIN` / `PRINCIPAL` → « Directeur » autorisée | RLF-05 · DL-18 |
| Rôles custom : affichage `effectiveLabel`, mutation `roleKey` (`RESP_PED`) | RLF-06 |
| Attribution API 200 `[]` ou erreur HTTP → **fail-closed**, 0 grant / 0 revoke | RLF-07 · WEB-RL-38 · MOBILE HTTP |
| Messages : `roleKey` / `kind`, jamais le libellé | RLF-08 · MOBILE-RL-34 |

Exemples figés :

| roleKey | Défaut | Display | Effectif |
|---|---|---|---|
| SCHOOL_ADMIN | Admin School | Directeur | Directeur |
| TEACHER | Enseignant | Professeur | Professeur |
| STUDENT | Élève / Étudiant | Étudiant | Étudiant |
| RESP_PED | Coordinateur pédagogique | Responsable académique | Responsable académique |

`toRoleKey("Directeur")` reste `PRINCIPAL`. Un display « Directeur » sur `SCHOOL_ADMIN` ne transforme jamais l’identité.

---

## 3. Suite

Chantier ROLE-LABELS **fermé**. Prochain lot produit ouvert : **#857 AUDIT-CARTE-01**, à rejouer d’abord contre `develop@f95c3f38` avant toute **CARTE-PR0**.
