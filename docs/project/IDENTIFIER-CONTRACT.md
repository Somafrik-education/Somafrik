# Contrat d'identifiants permanents Somafrik V2

## Décision

L'identifiant humain décrit l'origine de l'identité, jamais son rôle actuel.

Format complet établissement :

```text
{PAYS}-{ETABLISSEMENT}-{INITIALES}-{YY}-{SEQUENCE}
```

Exemples :

```text
CD-IK-GK-26-00001   Grâce Kabeya
CD-IK-JPM-26-00002  Jean Pierre Mbuyi
```

Login court dans le tenant établissement :

```text
GK-26-00001
JPM-26-00002
```

Le code établissement est fourni séparément à l'authentification.

## Permanence

`26` est l'année de création de l'identité, pas l'année scolaire. Le code ne change jamais lors d'un changement de :

- classe ou année scolaire ;
- cycle ;
- nom ;
- rôle ;
- statut métier ;
- attribution/retrait du rôle Enseignant ;
- ajout d'une relation Parent.

Le parcours décennal de l'élève reste attaché au même UUID et au même `identity_code`. Les inscriptions, notes, présences, paiements et documents portent la temporalité.

## Établissements

Le **code public de connexion** n'est pas `short_code` seul. Contrat V2 :

```text
{ISO}-{INITIALES}-{YY}-{SEQ3}
CD-IN-26-001
```

Détail : [School code V2](./SCHOOL-CODE-V2.md).

`schools.short_code` est un code canonique de 2 à 5 caractères, majuscule/alphanumérique, unique dans un pays et immuable après création. Il alimente le segment initiales (`Institut Nuru` → `IN`, `Institut Kibwija` → `IK`).

L'ancien format public `CD-2026-0001` (`CC-YYYY-NNNN`) est **legacy** : lecture seule, jamais régénéré.

## Compteur

La séquence est partagée entre identités établissement et élèves, scoped par :

```text
school_id + creation_year
```

Elle va de `00001` à `99999`, soit 99 999 nouvelles identités par établissement et par année. PostgreSQL alloue la valeur atomiquement avec `INSERT ... ON CONFLICT ... DO UPDATE`; aucun `MAX()+1` applicatif n'est utilisé.

## Compatibilité

Cette première migration est non destructive :

- `users.id` et `students.id` restent les PK UUID ;
- `users.user_code` reste temporairement un alias legacy pour ne pas casser les anciens logins et références ;
- `students.student_code` reste temporairement un alias métier legacy pour ne pas casser les inscriptions ;
- les nouveaux codes permanents vivent dans `identity_code`, `login_code`, `identity_initials`, `identity_year` ;
- pour les nouveaux utilisateurs, `profile_payload.identifier` devient le login court et `profile_payload.identityCode` contient le code complet ;
- les lignes historiques ne sont pas renumérotées automatiquement : aucune identité n'est inventée pendant la migration.

Une migration ultérieure pourra désactiver les alias legacy après inventaire et preuve de non-utilisation.

## Enseignant / Parent

Le GRANT `TEACHER` n'alloue aucun nouvel identifiant. Un utilisateur `CD-IK-JPM-26-00002` reste le même utilisateur s'il devient Enseignant, Préfet ou Parent. Le rôle est porté par `user_roles`, le profil métier par `teachers`, et la relation responsable/élève par les relations canoniques.

## Sécurité

Les champs permanents sont générés côté PostgreSQL. Une tentative de mutation directe d'un identifiant déjà attribué est refusée. Le `short_code` établissement est également immuable après création.
