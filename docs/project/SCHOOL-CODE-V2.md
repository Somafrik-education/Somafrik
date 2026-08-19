# School code V2

**Statut :** contrat canonique Somafrik V2  
**Code public de référence :** `CD-IN-26-001`

## Format

```text
{ISO_PAYS}-{INITIALES}-{YY}-{SEQ3}
```

Exemple :

```text
CD-IN-26-001
```

| Segment | Valeur | Signification |
|---------|--------|----------------|
| `CD` | ISO 3166-1 alpha-2 du pays | République Démocratique du Congo |
| `IN` | Initiales déterministes du **nom** | `somafrik_school_short_code` / `schoolShortCodeFromName` — première lettre de chaque mot significatif ; mots-outils ignorés : `DE DU DES LA LE LES D ET`. « Institut Nuru » → `IN`. **Aucune constante INSTITUT NURU n'est codée dans le générateur.** |
| `26` | Année civile d'émission, 2 chiffres | `created_at` PostgreSQL, pas l'année scolaire |
| `001` | Séquence 3 chiffres | Compteur global **par pays et par année civile**, pas par initiales |

Le code suivant du même pays / année est `CD-IN-26-002` (ou `CD-ISC-26-002` si le deuxième établissement a d'autres initiales) : le SEQ3 est global, les initiales restent un segment lisible.

## Source de vérité

PostgreSQL :

- colonne publique : `schools.login_code` (`UNIQUE` via `upper(login_code)`, `NOT NULL` après émission)
- trigger `somafrik_prepare_school_login_code` (BEFORE INSERT)
- compteur `school_login_code_counters` clé `(country_id, creation_year)`, `INSERT … ON CONFLICT DO UPDATE`
- alias interne : `schools.school_code` (`UNIQUE`) — `SCH-…` pour les créations V2 ; peut encore valoir un ancien `CD-YYYY-NNNN` en lecture seule

L'API publique `GET /api/schools/:code` renvoie `code` = `loginCode` = `login_code` V2 (`toPublicSchool` / `publicSchoolCodeFromRecord`).

Backend, Web et Mobile **n'allouent plus** de code établissement sur les clients.  
En mémoire (E2E / fallback sans PostgreSQL), `allocateNextSchoolLoginCode` reflète le compteur PG `(pays, année)` pour émettre un `login_code` V2. Ce n'est **pas** le générateur legacy `CC-YYYY-NNNN`.

## Génération

Unique en production : PostgreSQL.  
`formatSchoolLoginCode` (JS) formate et teste ; il n'incrémente aucun compteur applicatif client.

Création applicative : `schoolsRepository.persist` refuse `CD-YYYY-NNNN`, alloue `school_code = SCH-…`, laisse le trigger écrire `login_code`. Un UPDATE identifié par un code public (legacy ou V2) est **converti en UUID** puis écrit `WHERE id = $uuid`. Aucune nouvelle génération de `school_code` legacy.

## Concurrence

Le compteur est transactionnel et atomique. Deux INSERT simultanés dans le même pays / année reçoivent des SEQ3 distincts. Preuve : `backend/lib/schoolLoginCode.pg.test.js` (`testConcurrency`).

## Validation

`validateSchoolCode` / `normalizeSchoolCode` :

| Valeur | Création | Lecture |
|--------|----------|---------|
| `CD-IN-26-001` | accepté | accepté |
| `CD-IN-26-002` | accepté | accepté |
| `CD-2026-0001` | **refusé** (`SCHOOL_CODE_LEGACY_FORBIDDEN`) | lecture seule (lookup `school_code` **ou** `login_code`) |

La regex V2 `^[A-Z]{2}-[A-Z0-9]{2,5}-\d{2}-\d{3}$` n'accepte pas `CD-2026-0001`.

## Legacy interdit

`CD-2026-0001` (et tout `CC-YYYY-NNNN`) est l'ancien identifiant public. Il n'est plus :

- généré
- proposé en placeholder UI
- pré-rempli sur l'écran Mobile
- écrit à la création

Lecture temporaire : `getByCode` matche encore `school_code` pour ne pas casser un JWT / un tenant historique. Pas de dual-write. Pas de nouvelle table legacy. Plan de suppression : après migration contrôlée des lignes préprod (autorisation CTO).

## Préproduction — INSTITUT NURU

**Aucune mutation dans cette PR.**

Diagnostic lecture seule :

```sql
SELECT id, name, school_code, login_code, status, created_at
FROM schools
WHERE name ILIKE '%NURU%'
   OR school_code = 'CD-2026-0001'
   OR login_code = 'CD-IN-26-001';
```

Si `school_code` (ou `login_code`) vaut encore `CD-2026-0001` :

1. noter `id`, `name`, old code, proposed `CD-IN-26-001`
2. collision check : `SELECT 1 FROM schools WHERE upper(login_code) = 'CD-IN-26-001'`
3. transaction + rollback préparés
4. **STOP — attendre autorisation CTO**

## Gate

```bash
npm run verify:school-code-v2
```

Fail-closed dans CI et Security. Le bundle Preview Metro est scanné (`verify:mobile-release-readiness`) : zéro `CD-2026-0001`.
