# Identifiant canonique élève

**Décision CTO :** `student matricule = student login identifier`.  
Un seul code, autorité PostgreSQL.

## Format

`{ISO_PAYS}-{INITIALES_ETAB}-EL-{YY}-{SEQ3}`

Exemple : `CD-IN-EL-26-001`

Ce code est utilisé pour :

- MATRICULE (liste / fiche / recherche)
- identifiant de connexion élève
- bulletins, documents, exports, Mobile

## Contrat technique

| Champ | Valeur |
|---|---|
| `students.student_code` | canonique |
| `students.login_code` | même valeur |
| `students.identity_code` | même valeur |
| `users.user_code` (rôle STUDENT) | même valeur |
| `users.login_code` / `identity_code` (STUDENT) | même valeur |

Unicité : `students.student_code UNIQUE` + CHECK format + égalité login/identity.  
Compteur : `student_login_code_counters` (pays, initiales, année) — distinct de `identity_counters` staff.

**Un seul allocateur en production : le trigger PostgreSQL.**  
L'inscription INSERT `PENDING` ; le trigger écrit `CD-IN-EL-26-001`.  
Le JS n'alloue que comme stand-in mémoire (pas de trigger).

## Backfill legacy (opt-in)

Le rewrite `ELE-0001` → canonique **n'est pas exécuté au boot**.

- Schéma / triggers : `20260823_student_canonical_identifier.sql` (CHECK `NOT VALID`)
- Données : `20260824_student_canonical_identifier_backfill.sql`

```bash
# inventaire, aucune écriture
node backend/scripts/backfill-student-canonical-identifier.js

# application explicite
node backend/scripts/backfill-student-canonical-identifier.js --apply
# ou SOMAFRIK_STUDENT_CANONICAL_BACKFILL=1
```

Fail-safe : refuse si un namespace dépasse 999 ; refuse de valider le CHECK s'il reste des lignes non canoniques.

## Interdit

- `studentCode` ≠ `loginCode`
- `userCode` USR-… affiché comme second matricule élève
- générateur Web / Mobile
- JSON / localStorage comme source d’autorité

## UI

La page Élèves affiche `studentCode` (= matricule = login).  
`generateStudentMatricule` côté Web lève une erreur. Inscription : Classes → Inscrire.  
L'inscription crée aussi le compte `users` (rôle STUDENT) avec le même code.
