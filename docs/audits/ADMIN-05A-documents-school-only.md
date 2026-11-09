# ADMIN-05A — Documents : périmètre school-only et clôture métadonnées

**Statut : DRAFT / HOLD — PAS READY — PAS MERGE**

Base obligatoire : `develop@841362e297eafd38b8f5ee68c7cfecb8208ae894`

## Décision

**Option A — SCHOOL-ONLY.** `school_documents` = catalogue de métadonnées établissement. Aucun accès plateforme (SUPER_ADMIN / COUNTRY_ADMIN) aux titres, `student_id` ou documents d’un établissement. `ALL_PRIVILEGES` / `COUNTRY_PRIVILEGES` ne contournent pas le deny.

Option B (agrégat non-PII) plus tard. Option C (support plateforme sur documents personnels) **interdite**.

## Contrat métadonnées

| Champ | Contrat |
|---|---|
| id | UUID |
| schoolId | établissement serveur |
| schoolCode | projection serveur |
| studentId | null ou élève **du même** établissement |
| studentName | projection `first_name` + `last_name` |
| documentType | texte |
| title | texte |
| mimeType | texte \| null |
| status | `available` \| `generating` \| `archived` |
| createdAt / updatedAt | timestamps |

`storageKey` : **interne uniquement**. Non exposé API / audit. Ignoré s’il est fourni par le client. Ce n’est **pas** une preuve de fichier stocké.

## Matrice CRUD SCHOOL_ADMIN

| Action | API | Persist | Reload | Isolation |
|---|---|---|---|---|
| LIST | GET `/api/school-documents` | lecture `school_id` | n/a | A ne voit pas B |
| CREATE | POST | insert métadonnées | refresh EntityPage | `ignoreClientScope` + school du principal |
| PATCH titre | PATCH | `title` | refresh | documentId autre école → 404 |
| PATCH type | PATCH | `document_type` | refresh | 404 |
| PATCH statut | PATCH | `available`/`generating`/`archived` | refresh | 404 |
| student_id | POST optionnel | `resolveStudent(school_id, …)` | projection | cross-school 404 |
| ARCHIVE | POST `…/archive` | `status=archived` | refresh | 404 |

## Platform deny

Les 4 routes restent dans `SCHOOL_PERSONAL_DATA_FORBIDDEN_FOR_PLATFORM`. Le guard n’est pas modifié. Deny HTTP + `rbac.canAccess` + deny service `assertSchoolDocumentsPlatformDenied` (aucun contournement ALL_PRIVILEGES via appel interne).

## storage_key

- Créé aujourd’hui : colonne TEXT, historiquement recopiée depuis le body client.
- ADMIN-05A : le client ne peut plus l’écrire ; l’API ne le renvoie plus.
- Aucun endpoint upload / download / S3 / Supabase Storage / disk / base64 / bytea.
- Si un vrai stockage fichier est nécessaire : **ADMIN-05B séparé**.

## Migration

**NON.**

## Interdit respecté

Pas de Conformité produit, pas de Relations produit, pas de rôles / JWT / moteur RBAC, pas de suppression du guard, pas d’accès Superadmin aux documents élève, pas d’upload/download.
