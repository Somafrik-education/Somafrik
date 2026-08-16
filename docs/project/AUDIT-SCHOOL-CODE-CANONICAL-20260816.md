# Audit CTO — code établissement canonique

Date: 2026-08-16
Base auditée: `develop@2adcc8943557d171edd64be6c7087127cd16c6eb`
Mode: audit uniquement — aucune correction produit dans cette PR.

## Décision cible

Le code établissement canonique doit suivre le contrat:

`<ISO pays>-<sigle établissement>-<AA>-<NNN>`

Exemple de référence demandé:

`CD-IN-26-001`

Le format historique `CD-2026-0001` est interdit pour toute nouvelle génération et doit être retiré des fixtures, seeds, tests, exemples et chemins applicatifs qui l'utilisent comme code établissement.

## Verdict

**NO-GO correction aveugle / remplacement texte global.**

Le dépôt contient plusieurs concepts d'identifiants établissement (`school_code`, `login_code`, `short_code`, `publicId`, `code`) et le code actuel n'a pas encore un générateur canonique unique conforme à `CD-IN-26-001`. Un simple remplacement de `CD-2026-0001` par `CD-IN-26-001` masquerait la cause et laisserait les prochaines créations produire l'ancien format.

## Constats P0

### 1. Générateur backend encore ancien

`backend/lib/schoolModule.js::generateSchoolCode()` génère actuellement:

`<countryCode>-<année 4 chiffres>-<compteur 4 chiffres>`

soit `CD-2026-0001`.

Il ne prend pas le nom/type/sigle de l'établissement et ne peut donc pas produire `CD-IN-26-001`.

### 2. Générateur Web dupliqué et encore ancien

`web/src/lib/schoolModule.ts::generateSchoolCode()` contient une seconde implémentation du même format historique. Le commentaire de contrat indique encore `CodePays-AAAA-0001 (ETB-F02)`.

Deux générateurs indépendants créent un risque de divergence Web/backend. La génération définitive doit être autoritaire côté backend/PostgreSQL; le Web ne doit au mieux que prévisualiser le code avec la même fonction de contrat partagée.

### 3. Seed backend contient explicitement l'ancien code

`backend/data.js` contient pour l'établissement de démonstration:

- `publicId: "CD-2026-0001"`
- `code: "CD-2026-0001"`

Ce seed peut réinjecter le format historique dans les environnements où le demo seed est actif et dans les tests qui réutilisent `backend/data.js`.

### 4. E2E critique Admin/User utilise explicitement l'ancien code

`backend/scripts/verify-admin-user-creation.js` définit:

- `SCHOOL_CD = "CD-2026-0001"`
- `SCHOOL_BI = "BI-2026-0002"`

Le gate qui valide login, création Admin Pays/Admin School, GRANT, reset password et lockout ne couvre donc pas le contrat cible `CD-IN-26-001`. C'est un faux sentiment de couverture: le flux auth peut être vert avec un code établissement désormais interdit.

### 5. `establishmentService` appelle le générateur historique

`backend/services/establishmentService.js::hydrateSchoolPayload()` appelle `generateSchoolCode(countryCode, schools)` pour toute nouvelle création sans code fourni. La cause produit est donc directement dans le chemin de création établissement.

### 6. Schéma PostgreSQL n'impose aucun format canonique

`backend/db/schema.sql` déclare seulement `schools.school_code VARCHAR(32) NOT NULL UNIQUE`.

Il n'existe pas de CHECK garantissant le format `CC-SIGLE-AA-NNN`. L'unicité seule n'empêche donc pas une nouvelle écriture `CD-2026-0001`.

### 7. Projection établissement expose plusieurs codes

`backend/lib/schoolsManagement.js::mapEstablishmentRow()` distingue déjà:

- `login_code` → `publicId` prioritaire;
- `school_code` → `code` / `legacySchoolCode`;
- `short_code` → `shortCode`.

Cette coexistence montre qu'une migration de code doit définir explicitement lequel est le **code établissement canonique** utilisé pour login, tenant scope, FK/logique applicative et affichage. Le contrat demandé implique que `CD-IN-26-001` devienne cette valeur canonique et qu'un éventuel ancien code ne soit conservé que comme alias de migration temporaire, jamais comme nouvelle valeur générée.

### 8. Matérialisation legacy peut réintroduire n'importe quel ancien code

`backend/db/postgresRepository.js::ensureSchoolFromBackOfficeRecord()` normalise le code reçu puis l'insère directement dans `schools.school_code`. Ce chemin est un résidu de matérialisation BackOffice et peut contourner le futur générateur canonique. Comme le BackOffice legacy ne doit plus être une source d'écriture, ce chemin doit être supprimé/bloqué pour la création d'établissement ou soumis au même validateur canonique.

## Contrat de génération recommandé

### Source d'autorité

Backend + PostgreSQL uniquement.

Entrées minimales:

- ISO pays canonique (`CD`);
- nom de l'établissement (`Institut Nuru`);
- date/année de création (`26` pour 2026);
- compteur atomique par `(country, sigle, année)`.

### Sigle

Pour `Institut Nuru`, le sigle attendu est `IN`.

Règle déterministe proposée:

1. normaliser accents et ponctuation;
2. découper en mots significatifs;
3. ignorer articles/prépositions usuels (`de`, `du`, `des`, `la`, `le`, `l`, `et`, etc.);
4. si au moins deux mots significatifs: première lettre des deux premiers (`Institut Nuru` → `IN`);
5. si un seul mot: deux premières lettres alphanumériques;
6. uppercase ASCII;
7. sigle 2 caractères minimum; collision gérée par le compteur, pas par mutation aléatoire du sigle.

### Année

Deux chiffres: `2026` → `26`.

### Compteur

Trois chiffres, démarrant à `001`, atomique et concurrent-safe.

Exemple:

- premier Institut Nuru en RDC en 2026 → `CD-IN-26-001`
- second établissement avec sigle IN en RDC en 2026 → `CD-IN-26-002`

Le compteur ne doit pas être calculé par lecture `max + 1` en mémoire. Il faut une table de compteur ou un verrou PostgreSQL/advisory lock dans la transaction de création.

## Migration des données existantes

Ne pas faire un `UPDATE schools SET school_code = ...` isolé: `school_code` est utilisé comme identifiant de tenant dans de nombreuses projections et payloads.

Plan obligatoire:

1. inventaire read-only des `schools.school_code`, `login_code`, `short_code` et références textuelles;
2. détection des collisions du futur code;
3. table/colonne d'alias de migration si nécessaire;
4. migration transactionnelle d'un établissement avec toutes les références textuelles non-FK;
5. FK UUID restent inchangées (`school_id`), ce qui limite le risque sur les tables canoniques;
6. compatibilité login temporaire possible via alias ancien, mais réponse/API/UI doivent exposer le nouveau code;
7. suppression de l'alias ancien après fenêtre de transition décidée explicitement.

Pour l'établissement cible, la migration attendue est:

`CD-2026-0001` → `CD-IN-26-001`

uniquement après vérification que la ligne correspond bien à **Institut Nuru**. Il ne faut jamais renommer automatiquement une autre école portant `CD-2026-0001` vers `CD-IN-26-001` sans cette preuve.

## Périmètre de correction requis après audit

- `backend/lib/schoolModule.js`: remplacer le générateur historique par le contrat canonique.
- `backend/services/establishmentService.js`: génération backend autoritaire, code client fourni refusé ou strictement validé selon rôle/migration.
- PostgreSQL: compteur concurrent-safe + validation format; migration idempotente.
- `web/src/lib/schoolModule.ts`: supprimer la génération indépendante ou l'aligner comme preview non autoritaire.
- `backend/data.js`: retirer `CD-2026-0001`.
- `backend/scripts/verify-admin-user-creation.js`: utiliser `CD-IN-26-001` et un code Burundi au nouveau format.
- tous les tests/fixtures/docs/seeds détectés par audit repository complet: zéro occurrence active du motif historique.
- `ensureSchoolFromBackOfficeRecord`: ne plus permettre une création legacy hors contrat.
- auth/tenant: vérifier login avec `CD-IN-26-001`, reset password, lockout, JWT `schoolCode`, scope et relecture API.

## Gates à ajouter

Créer `verify:school-code-canonical` avec PostgreSQL réel:

1. création `Institut Nuru`, pays CD → `CD-IN-26-001`;
2. seconde création même sigle/année → `CD-IN-26-002`;
3. concurrence de deux créations → deux codes distincts, aucun doublon;
4. année/sigle/pays isolent les compteurs;
5. code ancien `CD-2026-0001` refusé en nouvelle écriture;
6. GET/reload retourne le même code;
7. login Admin School avec le nouveau code;
8. reset password + relogin avec le nouveau code;
9. tenant mismatch sur un autre code/pays;
10. audit repository: aucune fixture active ne réintroduit `CC-AAAA-NNNN`.

Brancher ce verifier dans CI et Security avec PostgreSQL.

## Risques

- P0: génération actuelle continue de créer de nouveaux codes historiques.
- P0: E2E auth actuel valide encore l'ancien contrat.
- P1: migration textuelle incomplète peut casser login/scope malgré les FK UUID intactes.
- P1: double générateur Web/backend peut recréer une divergence.
- P1: matérialisation legacy peut contourner le futur validateur.

## Critères de GO du futur chantier de correction

- génération PostgreSQL/backend unique et concurrent-safe;
- `Institut Nuru` → `CD-IN-26-001` prouvé par E2E;
- aucune nouvelle écriture au format `CD-2026-0001` possible;
- migration de l'établissement existant auditée et idempotente;
- login/scope/reset/lockout verts avec nouveau code;
- CI + Security + Architecture Audit + verifier school-code verts;
- diff CTO indépendant avant merge.
