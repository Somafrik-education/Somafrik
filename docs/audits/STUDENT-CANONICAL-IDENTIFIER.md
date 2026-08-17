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

## Interdit

- `studentCode` ≠ `loginCode`
- `userCode` USR-… affiché comme second matricule élève
- générateur Web / Mobile
- JSON / localStorage comme source d’autorité

## UI

La page Élèves affiche `studentCode` (= matricule = login).  
`generateStudentMatricule` côté Web lève une erreur. Inscription : Classes → Inscrire.  
L'inscription crée aussi le compte `users` (rôle STUDENT) avec le même code.
