# Audit architecture — cache offline incrémental L1/L2

**Date :** 2026-08-26  
**Type :** AUDIT UNIQUEMENT — aucune implémentation produit  
**Base `develop` exact :** `bf9402ef78b4593ccbeff8f2d504fc0acbd97446` (merge #340)  
**RC1 / #339 :** hors scope. Ce chantier n’est pas un prétexte pour déplacer la ligne d’arrivée RC1.  
**#340 :** hors modification. `ready_offline` est un prérequis RBAC, pas un cache métier.

**Verdict :** **GO SOUS CONDITIONS**

Amendements CTO #341 (obligatoires, intégrés ci-dessous) :

1. **P1 chiffrement** — Expo SDK 54 supporte `expo-sqlite` + `useSQLCipher: true` (build natif, pas Expo Go). Évaluer **cela avant** `op-sqlite`. Clé en SecureStore/Keystore.
2. **P0 scope + curseur** — `scopeHash` / `scopeVersion` est **lié au curseur** et **obligatoire**. Grant/revoke → **mini-cold sync** de la ressource. Un delta warm ne peut pas rattraper l’historique d’une classe nouvellement autorisée dont `updated_at` est antérieur au curseur.
3. **P1 outbox révoquée** — jamais de drop silencieux. État `blocked_authorization`, notification, purge sécurisée du payload sensible, métadonnée d’audit minimale conservée.
4. **Expiration curseur / tombstones** — curseur expiré ou tombstones plus disponibles → le backend **impose une réconciliation complète** de la ressource.

---

## 1. Executive summary

Somafrik Mobile est aujourd’hui **online-first**. Les données L1/L2 vivent en **RAM** (`AdminDataContext`). Le seul durcissement offline réel est :

| Artifact | Stockage | Rôle |
| --- | --- | --- |
| JWT + profil session | SecureStore | auth |
| Snapshot permissions v1 (#340) | SecureStore | RBAC `ready_offline` |
| Outbox mutations | FileSystem JSON | écritures `presences` / `notes` (plus messages/paiements hors chantier) |

**Cold boot hors ligne = listes métier vides.** `ready_offline` ouvre la coque (permissions persistées), pas les classes, élèves, planning, présences, évaluations ni notes.

PostgreSQL reste la seule vérité serveur. `GET /api/backoffice/state` est **410 Gone**. Toute architecture s’appuyant sur `backoffice_state` est **NO-GO**.

Les GET L1/L2 actuels sont des **listes complètes**. Aucun `updatedSince`, curseur, ETag ou changelog. Plusieurs suppressions/archives **disparaissent du GET** : un client incrémental ne peut pas les apprendre.

**Cible retenue (à valider CTO avant toute implémentation) :**

```text
SQLite local structuré (expo-sqlite + SQLCipher, clé SecureStore)
  = snapshot serveur (autorisé, partitionné)
  + overlay outbox pending | blocked_authorization
  + delta keyset (curseur opaque updated_at,id lié à scopeHash)
  + tombstones in-band (status terminal)
  + mini-cold si scopeHash change ou curseur expiré
```

Pas un gros JSON retéléchargé à chaque login.

---

## 2. Architecture actuelle

```text
PostgreSQL  ──GET listes full──►  AdminDataContext (RAM)
                ▲                         │
                │                         ▼
           OutboxRuntime            écrans (filtre client
           FileSystem JSON          classId / studentId / date)
                ▲
           mutations L2
           présences + notes
```

- Auth / foreground : `AuthContext` revalide **uniquement** `GET /auth/effective-permissions`.
- Domaine : reload au changement de `resourceScopeKey`, à `window.online`, et au `useFocusEffect` des écrans. **Pas** de refresh domaine au retour foreground.
- Écriture `backoffice_state` : interdite (`BACKOFFICE_STATE_WRITE_REMOVED`).
- `refreshBackOfficeState()` est un **nom trompeur** : il appelle les APIs dédiées, jamais `/api/backoffice/state`.

Identité runtime :

- `resourceScopeKey` = `userId|role|homeSchool|country|tenantSchool` (`dataTruth.ts`)
- HTTP tenant : JWT + `X-Somafrik-School-Code`
- Outbox : `{ userId, schoolScope }` — fail-closed si mismatch

---

## 3. Inventaire L1/L2 Mobile

Aucune de ces ressources n’est persistée localement aujourd’hui. Mobile **n’envoie pas** `classId` / `date` en query sur les listes : le serveur scope par JWT/header, l’UI filtre ensuite.

| Ressource | Endpoint actuel | Cache mémoire | Persisté localement | Offline cold boot | Mutation outbox |
| --- | --- | --- | --- | --- | --- |
| Classes | `GET /classes` (`getClasses`) | `classesData` + `classesSnapshot` | non | non | non (CRUD direct online) |
| Students | `GET /students` (`getStudents`) | `studentsData` + `studentsSnapshot` | non | non | non |
| Assignments | `GET /assignments` (`getAssignments`) | `assignmentsData` **sans** `ResourceSnapshot` | non | non | non |
| Course schedules | `GET /course-schedules` (`getPlanningWeekly`) | `courseSchedulesSnapshot` | non | non | non |
| Presences | `GET /presences` (`getPresences`) | `presencesData` + `presencesSnapshot` | non (outbox = mutation) | non | **oui** domaine `presences` |
| Evaluations | `GET /evaluations` (`getEvaluations`) | `evaluationsSnapshot` | non | non | non |
| Grades/Notes | `GET /notes` (`getNotes`) | `notesSnapshot` + `notesData` legacy | non (outbox = mutation) | non | **oui** domaine `notes` |

**In-session :** `snapshotFromFailure` conserve les lignes RAM si la panne est un vrai transport. Kill Expo → RAM perdue.

**Overlay déjà présent (présences seulement) :** `overlayPresenceOutboxOnAttendance` (`attendanceOffline.ts`). Les notes n’ont pas d’équivalent snapshot+overlay.

Planning : contrat réel **`/course-schedules`** (slots hebdomadaires canoniques). Pas de route legacy imaginaire. Mobile ignore aujourd’hui `updatedAt` du DTO (`planningV2.normalizeWeeklySlot`).

---

## 4. Inventaire stockage local

| Option | Présent aujourd’hui | Aptitude L1/L2 |
| --- | --- | --- |
| Mémoire React | **Oui** — unique cache métier | Insuffisant (perdue au kill) |
| JSON FileSystem | **Oui** — outbox uniquement | Mauvaise pour L2 (rewrite fichier entier, pas d’index) |
| AsyncStorage | **Non** | Interdit tokens ; médiocre pour requêtes classId/date |
| SecureStore | **Oui** — secrets + snapshot RBAC | Réservé secrets/session. Pas de cache métier |
| expo-sqlite | **Non** (absent de `Mobile/package.json`) | **Candidat naturel** pour L1/L2. SDK 54 : `useSQLCipher: true` sur Android/iOS/macOS, **build natif requis** (indisponible dans Expo Go) |

Android : `allowBackup="false"` + règles d’exclusion déjà en place (`withSomafrikAndroidSecurity.js`).

JWT / refresh **ne doivent jamais** entrer dans la base cache.

---

## 5. Inventaire API / Backend

Préfixe réel : `/api/...`. Mobile appelle sans le préfixe via `httpClient`.

| RESOURCE | CURRENT GET | TENANT FILTER | RBAC | UPDATED_AT | DELETE SIGNAL | PAGINATION | DELTA READY? | BACKEND CHANGE NEEDED? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Classes | `GET /api/classes` | `schoolCode` JWT + `assertSchoolAccess` | `Classes:READ` / Voir/Gérer classes | `classes.updated_at` → `updatedAt` | `PATCH` → `inactive` **reste listé** | non | non | **oui** |
| Students | `GET /api/students` | idem + `scopeSchoolStudentsForPrincipal` | `Élèves:READ` | `students.updated_at` | archive `DELETE` → **omis du GET** | opt-in, Mobile full | non | **oui** |
| Assignments | `GET /api/assignments` | school + enseignant auto-filtré | `Affectations:READ` | `teacher_assignments.updated_at` | `status=deleted` → **omis** | opt-in, Mobile full | non | **oui** |
| Course schedules | `GET /api/course-schedules` | school ; enseignant → son `teacherId` | `Planning de cours:READ` | slot `updated_at` (Mobile drop) | `cancelled` → **omis** (filtre `active`) | non | non | **oui** |
| Presences | `GET /api/presences` | filtre **après** projection globale | `Présences:READ` | `attendance.updated_at` → `savedAt` | pas d’API delete ; upsert | non | non | **oui** |
| Evaluations | `GET /api/evaluations` | `e.school_id` | `Notes:READ` | `evaluations.updated_at` | archived via PATCH ; staff les voit | opt-in, Mobile full | non | **oui** |
| Notes | `GET /api/notes` | filtre **après** projection globale | `Notes:READ` | `grades.updated_at` + **`grades.version`** | pas d’API delete ; upsert | non | non | **oui** |

**P0 perf / isolation lecture L2 :** `loadCanonicalPedagogyForPrincipal` → `listPedagogyProjection()` **sans `WHERE school_id`**, puis filtre mémoire (`server.js`). Le RBAC final est appliqué avant réponse, mais le coût et le blast radius SQL sont inacceptables pour un sync 1 000–5 000 élèves.

**Ne pas inventer d’endpoint produit dans cette PR.** Les GET ci-dessus sont les seuls utilisés par Mobile pour L1/L2.

Aucun changelog / table delta client n’existe. `audit_logs` et `idempotency_keys` ne sont pas un protocole de pull.

---

## 6. Gap analysis incrémental

La cible n’est **pas** `login → DELETE cache → GET tout`.

Écarts bloquants :

1. Pas de curseur / `updatedSince` / ordre keyset `(updated_at, id)`.
2. Tombstones absents : élèves archivés, affectations deleted, créneaux cancelled **invisibles**.
3. `updatedAt` seul est insuffisant (égalité de timestamp, clock, suppressions cachées).
4. Notes : OCC serveur (`grades.version`) **non transporté** par Mobile (`normalizeGrade` strip, `buildSaveNotePayload` n’envoie pas `version`) → last-write-wins de fait.
5. Présences : **pas d’OCC** ; `ON CONFLICT (school_id, student_id, attendance_date) DO UPDATE` = LWW produit actuel.
6. L2 GET notes/présences : full projection.
7. Aucun persist L1/L2 → scénarios kill/relaunch offline impossibles hors outbox.
8. Un curseur warm n’est **pas** un filtre d’autorisation : sans `scopeHash` lié, un grant de classe B dont les élèves ont `updated_at` antérieur au curseur C **n’apparaît jamais**.
9. « Drop » d’outbox révoquée trop dangereux : une présence offline devenue interdite ne doit ni être rejouée ni disparaître sans trace.
10. Tombstones/cursors ont une durée de vie : un mobile longtemps hors-ligne peut rater des suppressions si le warm continue.

---

## 7. Architecture cible

```text
                    ┌──────────────────────────┐
   Auth/RBAC live   │  PostgreSQL (canonique)  │
   fail-closed      └────────────▲─────────────┘
                                 │ delta + POST
         ┌───────────────────────┴────────────────────────┐
         │  Mobile                                        │
         │  SQLite snapshot (userId, schoolId, resource)  │
         │       +  outbox overlay (pending/sending)      │
         │       =  UI offline                            │
         │  SecureStore = secrets + permissions only      │
         └────────────────────────────────────────────────┘
```

Règles :

- Le cache n’est **jamais** une seconde source canonique.
- Les mutations locales non confirmées **n’écrasent pas** le snapshot serveur.
- UI = `snapshot ∪ overlay(outbox)` — déjà le modèle présences.
- Timeout / 4xx / 5xx **≠** offline (`isRecognizedTransportFailure` inchangé).
- Pas de matrice RBAC locale, pas de `Admin = tout`, pas de `roleDefaults` client.
- Le serveur filtre **avant** téléchargement. L’UI ne télécharge pas « trop » pour filtrer après.

---

## 8. Modèle DB local proposé (minimal)

Partition obligatoire sur **chaque ligne** :

`user_id | school_id | school_code | resource_type | canonical_id`

Plus `updated_at` serveur, `sync_cursor_token` (opaque, par ressource), `row_status` (`active|inactive|archived|deleted|cancelled`), `fetched_at`.

### Tables (champs utiles Mobile seulement)

**meta_sync**  
`user_id, school_id, resource, cursor, scope_hash, scope_version, cursor_issued_at, server_time, schema_version`

`scope_hash` / `scope_version` sont **obligatoires** et **liés au curseur** : un curseur n’est valide que pour le scope qui l’a émis. Changement de scope (grant **ou** revoke) → invalidation du curseur → **mini-cold** de la ressource, pas un delta warm.

**classes**  
`id, code, name, academic_year_id, status, updated_at`

**students**  
`id, public_id, matricule, class_id, class_code, first_name, last_name, status, updated_at`  
Pas de parentEmail / pièces / photos.

**assignments**  
`id, teacher_id, class_id, subject_id / course identifiers, status, updated_at`

**course_schedule_slots**  
`id, class_id, school_course_id, teacher_id, day_of_week, start_time, end_time, room_id, status, updated_at`

**presences**  
identité canonique `(student_id, class_id, attendance_date)` + `status, teacher_id, saved_at/updated_at`  
Pas de version OCC aujourd’hui.

**evaluations**  
`id, school_course_id, class_id, type, date, scale, coefficient, status, updated_at`

**grades**  
`id, evaluation_id, student_id, value/status, **version**, updated_at`

**Interdit dans SQLite :** accessToken, refreshToken, password, `ALL_PRIVILEGES` inventé, finance, utilisateurs complets, documents.

Migrations : table `schema_migrations` (entier monotone). Crash recovery : transaction SQLite par page delta (apply items + tombstones + cursor atomique).

Séparer **server snapshot** et **pending overlay** (outbox file existant, pas dupliqué dans SQLite au v1). V1 peut garder l’outbox FileSystem actuelle.

---

## 9. Protocole de synchronisation

### Primitive retenue : **B (curseur opaque) implémenté en A-keyset**

Comparer :

| | A `updatedAt` + page | B cursor opaque | C sequence monotone |
| --- | --- | --- | --- |
| Simple côté SQL | oui | oui (encode A) | nouvelle colonne `sync_seq` |
| Égalité timestamp | **fragile** | OK si tie-break `id` | OK |
| Clock skew client | dangereux si client envoie « now » | OK si serveur compare ses colonnes | OK |
| Suppressions | **non** | oui si items terminaux inclus | oui |
| Complexité Backend | moyenne | moyenne | plus haute |

**Recommandation v1 :** curseur opaque serveur =

```text
base64url({ t: updated_at_timestamptz, id: uuid })
```

Comparaison SQL : `(updated_at, id) > (cursor.t, cursor.id)`  
`ORDER BY updated_at ASC, id ASC`  
`limit` borné (ex. 200).

**Bootstrap (COLD) :** pas de cursor → première page depuis l’origine, puis `nextCursor` jusqu’à `null`.  
**Warm :** reprendre le cursor stocké **seulement si** `scopeHash` client = `scopeHash` serveur **et** le serveur n’a pas marqué le curseur expiré.  
**Jamais** d’horloge device.

Réponse type (conceptuelle, **non implémentée**) :

```text
{
  items: [ /* DTO actuel + status + updatedAt */ ],
  nextCursor: "…" | null,
  scopeHash: "…",          // obligatoire, lié au curseur
  scopeVersion: 12,        // monotone serveur pour ce principal+ressource
  cursorStatus: "ok" | "scope_changed" | "expired",
  serverTime: ISO-8601
}
```

Lignes au status terminal (**tombstone in-band**) : le client **efface** la ligne locale. Pas besoin d’une table `sync_tombstones` au v1 si chaque ressource a déjà un status durable.

### P0 — `scopeHash` lié au curseur (grant et revoke)

Le curseur `(updated_at, id)` ne encode **pas** l’ensemble autorisé. Cas bloquant :

```text
Enseignant, curseur C sur Students (scope = classe A)
→ obtient ensuite classe B
→ les élèves de B ont updated_at < C
→ un delta warm (updated_at, id) > C ne télécharge JAMAIS B
```

Donc :

- chaque page delta porte `scopeHash` (empreinte stable des classIds / affectations / permissions de lecture de **cette** ressource) et `scopeVersion` ;
- le client persiste `(cursor, scopeHash, scopeVersion)` ensemble dans `meta_sync` ;
- si le serveur répond `cursorStatus=scope_changed` **ou** si le `scopeHash` reçu ≠ celui stocké : **mini-cold obligatoire** de la ressource (reset curseur, pagination depuis l’origine **sous le nouveau scope serveur**, puis remplacement des lignes locales hors nouveau scope) ;
- grant et revoke sont le même événement protocole : le scope a changé. Le revoke doit aussi retirer immédiatement les lignes locales devenues non autorisées.

Un delta warm **sans** mini-cold après grant est un trou P0 (données manquantes). Un delta warm **sans** purge après revoke est un trou P0 (données révoquées visibles).

### Expiration curseur / fenêtre de tombstones

Les status terminaux ne restent pas interrogeables éternellement (rétention, vacuum, `inactive` trop ancien). Un téléphone qui revient après une longue coupure avec un curseur C peut :

- ne plus voir les tombstones des suppressions survenues pendant l’absence ;
- conserver indéfiniment dans SQLite une ligne que le serveur a déjà oublié d’émettre.

**Contrat obligatoire :**

- le backend définit une **fenêtre de validité** du curseur (ex. alignée sur la rétention des tombstones in-band, à figer en implémentation, ordre de grandeur ≥ rétention L2 présences) ;
- si `cursor.t` est hors fenêtre, curseur inconnu/corrompu, ou tombstones de cet intervalle plus disponibles : `cursorStatus=expired` (ou équivalent fail-closed) ;
- le client **n’applique pas** ce warm. Il purge la ressource dans la partition courante puis fait une **réconciliation complète** (cold paginé du scope actuel) ;
- le serveur **refuse** de servir un delta warm sur un curseur expiré (pas de « best effort » qui laisserait des zombies locaux).

Agrégat `GET /api/mobile-sync/l1` : **non prioritaire**. 4 GET L1 parallèles suffisent si chacun est scopé/paginé. Un agrégat mélange RBAC différents et grossit les PRs. Revoir seulement si le nombre d’allers-retours devient un P1 terrain.

### Ordre déterministe (Option A enrichie)

```text
1. Refresh auth / effective-permissions
   - 401/403 → purge session + **purge cache partition**
   - ready_offline → UI cache si COLD/WARM présent ; sinon message explicite
2. Recalcul du scope autorisé (classes enseignant, etc.) → scopeHash
3. Outbox hors scope : NE PAS rejouer, NE PAS drop silencieux
   → status blocked_authorization
   → notification utilisateur
   → purge sécurisée du payload sensible
   → conservation d’une métadonnée d’audit minimale
4. Pull L1 puis L2 :
   - si scopeHash inchangé et curseur valide → delta warm
   - si scopeHash changé → mini-cold ressource
   - si curseur expiré / tombstones indisponibles → réconciliation complète
5. Replay outbox restante (pending seulement, idempotency keys existantes)
6. Pull delta final (ou appliquer le body POST confirmé dans le snapshot)
```

Pourquoi pas B (replay puis delta) seul : l’OCC notes a besoin de la `version` serveur **avant** le POST. D’où delta puis replay puis delta.

Compat #321 / #325 / #340 :

- Outbox allowlist + persist fail-closed inchangés.
- `timeout ≠ offline`, `4xx/5xx ≠ offline`.
- `ready_offline` n’hydrate pas le métier ; le cache L1/L2 le fera **plus tard**, dans d’autres PRs.

---

## 10. RBAC

**P0.** Le blob téléchargé = exactement ce que le Backend autorise déjà.

| Profil | Cache L1/L2 |
| --- | --- |
| Enseignant | classes d’affectations **actives**, élèves de ces classes, planning/présences/notes de ce scope |
| Préfet / Admin school | selon permissions serveur réelles (`Classes:READ`, `Élèves:READ`, `Présences:READ`, `Notes:READ`, …) |
| Comptable | **hors chantier** — ne pas créer un cache pédagogie « parce que GET /students répond » |

Interdit : Admin=tout local, Teacher=toutes les classes, filtrer seulement dans l’UI après un download trop large, `getInternalRoleDefaults` pour peupler le cache.

**Révocation / grant online :** le prochain refresh live permissions + le `scopeHash` serveur sont la source. Les GET enseignant filtrent déjà côté serveur (`classStudentsAuthz`, assignments, planning `teacherId`). Le cache doit **suivre** ce filtre, pas le déduire d’un curseur d’horodatage.

**`scopeHash` n’est pas optionnel.** Il est émis avec chaque curseur. Tout écart grant **ou** revoke déclenche un **mini-cold obligatoire** des ressources liées (students, assignments, schedules, puis L2 de ces classIds) :

- revoke : retirer du snapshot local tout ce qui n’appartient plus au scope (cascade : plus aucune affectation restante pour cette classe) ;
- grant : **repartir de l’origine** pour cette ressource, sinon l’historique B antérieur au curseur A n’arrive jamais.

Les tombstones d’affectations `deleted` restent utiles **à l’intérieur** d’un même `scopeHash`. Ils ne remplacent pas le mini-cold de changement de scope.

La réconciliation forcée sur curseur expiré (section 9) couvre l’absence prolongée ; elle ne dispense pas du `scopeHash`.

---

## 11. Tenant isolation

**P0.** Scénarios :

1. A School A → logout → B School B : **zéro** ligne A visible.
2. A School A → logout → C School A scope plus faible : C n’hérite pas du cache large de A.

**Recommandation fail-closed + minimisation :**

- **Purge au logout** (comme tokens + snapshot permissions + `blockOutboxOnLogout`).
- **Partition `user_id + school_id`** en défense (fichier/DB nommé par partition, `WHERE` obligatoire, bind session comme l’outbox).
- Ne **pas** conserver le cache d’un autre utilisateur « au cas où » (téléphone partagé / purge incomplète).

Toute lecture SQLite sans `user_id = session.userId AND school_id = session.schoolId` est un bug P0.

---

## 12. Chiffrement / données sensibles

**Sensible :** nom/prénom élèves, matricule, présences, notes, titres d’évaluations.  
**Non cible cache :** JWT, finance, documents, photos.

Mécanismes déjà là :

- SecureStore / Keystore pour secrets.
- `android:allowBackup="false"` + exclusion files/database.

**Ne pas inventer un AES maison.**

Recommandation (corrigée) :

1. **PR A — évaluer d’abord `expo-sqlite` SDK 54 + `useSQLCipher: true`.** Support officiel Android / iOS / macOS. Indisponible dans **Expo Go** : Somafrik est déjà en build natif (APK/AAB), donc ce mode est le chemin par défaut. Clé de base dans **SecureStore / Keystore Android / Keychain iOS**, jamais dans le fichier DB, jamais dans le repo, jamais dans les logs. `PRAGMA key` uniquement en mémoire après lecture SecureStore.
2. **Ne pas introduire `op-sqlite`** tant que `expo-sqlite` + SQLCipher n’a pas été écarté sur un critère mesuré (API, migrations, crash recovery, taille APK, CI prebuild).
3. Compléments déjà là : `allowBackup="false"`, purge logout, pas de JWT dans SQLite, logs sans PII (`safeLogger`).
4. Pas d’AES maison sur le fichier SQLite. Appareil rooté : Keystore extractable selon OEM — minimisation + rétention L2 courte restent nécessaires même avec SQLCipher.

---

## 13. Rétention et volumétrie

Sans images/documents. Ordres de grandeur (UTF-8 + index SQLite × ~2) :

| | L1 (année) | Planning (slots semaine) | Présences 8 semaines | Notes année | **Total** |
| --- | --- | --- | --- | --- | --- |
| 100 élèves | ~0.1 MB | <0.05 MB | ~0.3 MB | ~0.2 MB | **< 1 MB** |
| 500 | ~0.4 MB | <0.1 MB | ~1.5 MB | ~1 MB | **~2–4 MB** |
| 1 000 | ~0.8 MB | <0.2 MB | ~3 MB | ~2 MB | **~4–8 MB** |
| 5 000 | ~4 MB | <0.5 MB | ~15 MB | ~10 MB | **~20–40 MB** |

Politique proposée :

| Ressource | Rétention |
| --- | --- |
| Classes / Students / Assignments | année scolaire active |
| Course schedules | template hebdo année active (petit) |
| Présences | **8 semaines** glissantes |
| Évaluations / Notes | année / période active affichée Mobile |

Le cache ne doit pas grandir indéfiniment : job local `DELETE WHERE attendance_date < cutoff` après delta.

SQLite se justifie surtout à **500+ élèves** et dès que les requêtes `classId+date` / `evaluationId+studentId` deviennent le chemin UI. En dessous, un JSON L1 seul tiendrait, mais L2 + overlay + tombstones + transactions poussent quand même vers SQLite pour un seul modèle.

---

## 14. Tombstones / archives / suppressions

| Ressource | Aujourd’hui | Apprentissage Mobile incrémental |
| --- | --- | --- |
| Élève | archive, **omis du GET** | inclure `status=archived` dans le delta |
| Classe | `inactive`, **encore listée** | upsert status ; UI masque inactive |
| Affectation | `deleted`, **omise** | inclure `status=deleted` dans le delta |
| Créneau | `cancelled`, **omis** | inclure cancelled dans le delta |
| Évaluation | archived visible staff | upsert status |
| Présence / note | pas de delete | upsert suffit |

**Aucune donnée révoquée ne reste indéfiniment visible offline.**

Trois filets, tous obligatoires :

| Événement | Action |
| --- | --- |
| `scopeHash` changé (grant/revoke) | mini-cold ressource + purge des lignes hors nouveau scope |
| Tombstone in-band dans un delta **valide** | delete local de l’id |
| Curseur expiré / tombstones hors fenêtre | **réconciliation complète** imposée par le backend ; interdit de continuer en warm |

Le backend doit documenter la fenêtre (TTL curseur = fenêtre pendant laquelle un status terminal reste visible au delta). Au-delà, `cursorStatus=expired`. Un client qui ignore `expired` et continue le warm est un bug P0 (zombie local).

Pas de `deletedRows` legacy / `backoffice_state`.

---

## 15. OCC / conflits

| Mutation | Backend | Mobile aujourd’hui | Cible cache |
| --- | --- | --- | --- |
| Note `POST /notes` | `assertNoteOptimisticLock` si `version` fournie ; sinon skip | **n’envoie pas** `version` | conserver `version` dans snapshot + outbox ; 409 → conflict UI ; **interdit last-write-wins silencieux** |
| Présence `POST /presences` | LWW `ON CONFLICT` | idempotency key + intention `presence:{classId}:{date}` | **documenter LWW** comme contrat actuel ; ne pas inventer une version absente. Si le produit veut un 409 présence, c’est un changement Backend **séparé** |

409 notes : garder la valeur locale en overlay `conflict`, afficher la valeur serveur du delta, résolution manuelle (re-saisie). Idempotency : ne pas retenter en boucle un 409 (`classifyMutationFailure` déjà `conflict` non retryable).

---

## 16. Outbox + cache

Deux concepts. Modèle UI :

```text
SERVER SNAPSHOT LOCAL  ∪  PENDING OUTBOX OVERLAY  =  UI OFFLINE
```

Statuts outbox actuels : `pending | sending | sent | failed | blocked_scope_mismatch | blocked_logout`.  
Ajouter **`blocked_authorization`** (révocation de permission / perte de classe après saisie offline).

| Issue | Comportement |
| --- | --- |
| POST confirmé | entry `sent` → upsert snapshot depuis body/delta → overlay retiré |
| 4xx métier | `failed` ; ne pas prétendre sync |
| 409 | conflict state |
| vraie panne transport | reste `pending` |
| 5xx / timeout | politique actuelle ; **pas** reclasse offline sans preuve |
| Intention devenue hors RBAC / hors classe | **ne pas rejouer** ; **ne pas drop silencieux** |

Protocole `blocked_authorization` :

1. Marquer l’entrée `blocked_authorization` (non retryable, comme un conflict).
2. **Notifier** l’utilisateur (copie FR explicite : l’enregistrement n’a pas été envoyé car les droits ont changé).
3. **Purger le payload sensible** (noms, présences, notes, identifiants élèves) du fichier outbox.
4. **Conserver une métadonnée d’audit minimale** : `id`, `domain`, `path`, `createdAt`, `userId`, `schoolScope`, `intentionId`, `blockedAt`, `reason=authorization_revoked`. Pas de body métier.
5. L’overlay UI retire la valeur pending ; le snapshot serveur (éventuellement déjà mini-cold) fait foi.

`bindOutboxToSession` / `blockOutboxOnLogout` restent la barrière tenant. `blocked_authorization` est la barrière **RBAC intra-session / après reconnect**.

Présences : overlay déjà là. Notes : à créer sur le même contrat (PR E), y compris ce statut.

---

## 17. Performance

Aujourd’hui : 7 GET full (dont notes/présences sur projection globale) à chaque hydration. N+1 écran = refetch full.

Cible :

- Cold : pages delta depuis origine, parallèle L1 puis L2. Objectif &lt; quelques secondes sur 500 élèves, Wi-Fi.
- Warm : 1 page/ressource si peu de changements.
- Éviter N+1 : **pas** un GET par classe. Enrichir les GET existants, pas 30 routes.
- Batterie : pas de polling métier ; déclencheurs = login, reconnect, foreground (après RBAC), fin d’outbox.
- UX : ne **pas** bloquer Home sur la fin du cold sync si un WARM existe ; si COLD vide + offline → message explicite (pas `[]` canonique — `dataTruth` l’interdit déjà).

Endpoints actuellement inefficaces pour sync : `GET /notes`, `GET /presences` (projection globale). `GET /students|classes|assignments|evaluations|course-schedules` full-list sans cursor.

---

## 18. Tests Device (futurs — hors cette PR)

À coller sur UAT Android après implémentation :

| ID | Scénario | Attendu |
| --- | --- | --- |
| A | login online bootstrap → avion | L1/L2 visibles |
| B | sync → avion → kill → relaunch | L1/L2 visibles |
| C | offline présence → outbox → kill → relaunch → overlay → reconnect → replay **once** | pas de doublon |
| D | device version N → serveur N+1 → reconnect | seulement le delta |
| E | élève/affectation supprimé serveur | disparition locale |
| F | Teacher **perd** une classe → refresh permissions | données classe retirées + outbox liée → `blocked_authorization` (pas de drop silencieux) |
| F2 | Teacher **gagne** une classe B dont l’historique a `updated_at` &lt; curseur A | mini-cold : B visible, pas seulement le delta warm |
| G | A logout → B login | aucune donnée A |
| H | note modifiée serveur **et** offline → 409 | pas de perte silencieuse |
| I | device absent &gt; fenêtre de tombstones, curseur expiré | backend impose réconciliation complète ; pas de zombies locaux |

RC1 device UAT (#339) reste le canal smoke actuel ; ces scénarios sont le **futur** chantier cache, pas un GO RC1.

---

## 19. Risques

| ID | SEV | RISK | CURRENT STATE | TARGET | MITIGATION | BLOCKING? |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | P0 | Fuite tenant A→B | RAM reset + outbox bind ; pas de cache disque métier | purge + partition | tests G ; bind session | oui |
| R2 | P0 | Permission locale élargie | serveur filtre listes ; UI re-filtre | serveur filtre delta | pas de download extra | oui |
| R3 | P0 | Cache autre user visible | n/a (pas de DB) | purge logout | fail-closed lecture | oui |
| R4 | P0 | Données révoquées visibles offline **ou** historique d’un grant jamais tiré | n/a | `scopeHash` **obligatoire** lié au curseur + mini-cold | scénarios F et F2 | oui |
| R5 | P0 | Corruption canonique / Mobile SoT | outbox ≠ réplique | snapshot≠overlay | ne jamais écrire snapshot depuis draft | oui |
| R6 | P0 | Replay doublé | idempotency + intention | inchangé | garder keys | oui |
| R7 | P0 | Réintroduire backoffice_state | 410 + reject Mobile | interdit | NO-GO | oui |
| R8 | P1 | Delta incomplet / tombstone manquant / curseur expiré ignoré | GET omet deleted | in-band status + `cursorStatus=expired` → full resync | tests E, I | oui avant warm |
| R9 | P1 | Notes OCC contourné | version strippée | version dans cache/outbox | test H | oui avant PR E |
| R10 | P1 | Présences LWW concurrent | LWW SQL | documenté | pas de faux 409 | non (contrat actuel) |
| R11 | P1 | Cold boot lent / projection L2 | full table | SQL school + cursor | avant 1000+ élèves | oui perf |
| R12 | P1 | Cache impossible à migrer | n/a | schema_migrations | PR A | non |
| R13 | P1 | Listes vides prises pour vérité | `empty` vs `error`/`offline` | garder dataTruth | UX COLD | non |
| R14 | P1 | Chiffrement at-rest | `expo-sqlite` non installé ; SDK 54 **a** `useSQLCipher` | **expo-sqlite + SQLCipher** (natif, pas Expo Go), clé SecureStore ; `op-sqlite` seulement si écart mesuré | PR A | oui avant données élèves sur disque |
| R15 | P2 | Assignments sans ResourceSnapshot | data only | aligner PR B | — | non |
| R16 | P3 | Nom `refreshBackOfficeState` trompeur | misnomer | rename plus tard | — | non |
| R17 | P1 | Outbox révoquée drop silencieux | pas d’état dédié | `blocked_authorization` + notif + purge payload + audit minimal | scénario F | oui avant PR E |

---

## 20. Découpage PR (implémentation future)

Chaque PR assez petite pour un diff CTO indépendant. **Aucune de ces PRs n’est cette PR d’audit.**

| PR | Contenu | Dépend de |
| --- | --- | --- |
| **A** | Infra SQLite : schema/migrations, partition user/school, **expo-sqlite + `useSQLCipher: true`** (clé SecureStore, build natif), repos, pas de JWT | validation CTO de **ce** rapport |
| **B** | L1 bootstrap + delta : Classes, Students, Assignments, `/course-schedules` ; curseur **lié à scopeHash** | A + **Backend delta L1** (cursor + scopeHash + expired) |
| **C** | L1 purge / RBAC grant+revoke / tenant / tombstones / **mini-cold obligatoire** sur `scopeHash` | B |
| **D** | L2 lecture offline : Presences, Evaluations, Notes (snapshot) | C + **Backend delta L2 school-scoped** |
| **E** | Overlay notes + OCC `version` + 409 ; présences overlay ; **`blocked_authorization`** | D |
| **F** | Device UAT A–I + F2 + hardening rétention/perf / curseur expiré | E |

**Backend (PRs séparées, avant ou en parallèle B/D) :**

1. Delta keyset + status terminal sur L1 + **`scopeHash`/`scopeVersion` + `cursorStatus` (`ok` \| `scope_changed` \| `expired`)** + fenêtre de tombstones.
2. `GET /notes` et `GET /presences` **WHERE school_id** (+ teacher scope) + même cursor.
3. Exposer `version` + `updatedAt` notes jusqu’au JSON Mobile (contrat GET/POST). **Sans changer le RBAC.**

Ordre : **Backend L1 delta → PR A → B → C → Backend L2 delta → D → E → F.**

---

## 21. Verdict final

### GO SOUS CONDITIONS

Le principe CTO est confirmé par l’inventaire réel : **SQLite structuré + snapshot serveur + overlay outbox + delta**, pas un JSON full-fetch.

| Décision | Choix |
| --- | --- |
| Stockage | **expo-sqlite + SQLCipher** (`useSQLCipher: true`, SDK 54, build natif, pas Expo Go). Clé SecureStore/Keystore. Évaluer **avant** tout `op-sqlite`. Outbox v1 = JSON FileSystem. SecureStore secrets/RBAC. |
| Delta | Curseur opaque `(updated_at, id)` **lié à `scopeHash`** + items au status terminal |
| Tombstones | In-band via `status` ; **TTL** ; curseur expiré → réconciliation complète imposée par le backend |
| RBAC | Filtre **serveur** ; grant/revoke → **mini-cold obligatoire** (pas un delta warm) |
| Tenant | Purge logout **et** partition `userId+schoolId` |
| Chiffrement | SQLCipher expo-sqlite dès PR A (données élèves). Backup déjà off |
| Rétention | L1 année ; présences 8 semaines ; notes année |
| OCC | Notes : transporter `version`. Présences : LWW documenté |
| Outbox | Séparé du snapshot ; overlay ; **`blocked_authorization`** (pas de drop silencieux) ; ordre auth → bloquer outbox hors droits → delta/mini-cold → replay pending → delta |
| Backend | **Oui, obligatoire** : delta + scopeHash + cursor expired + L2 school-scoped |
| Mobile | Nouvelle stack cache ; ne pas modifier #339/#340 |
| Complexité | Haute (cross-stack), maîtrisable si PRs A–F tenues petites |

**P0 à traiter avant implémentation produit :** R1–R7 (isolation, RBAC, `scopeHash` lié au curseur, no SoT, no backoffice_state, idempotency).  
**P1 bloquants avant “warm delta” / données sur disque :** R8 tombstones+expiry, R9 version notes, R11 GET L2 scopé, R14 SQLCipher expo-sqlite, R17 outbox `blocked_authorization`.

**Conditions de GO implémentation (après validation CTO de ce rapport) :**

1. Contrats delta + tombstones spécifiés (cette reco) acceptés.
2. Pas d’implémentation tant que ce diff n’a pas l’autorisation Ready/merge **audit**.
3. RC1 reste sur #339. Cache L1/L2 = chantier suivant, pas un élargissement RC1.

**NO-GO si :** réintroduction `backoffice_state`, cache = SoT, download unfiltered, `updatedAt` client-clock seul, last-write-wins silencieux sur notes, timeout traité comme offline, **delta warm après grant de scope**, **drop silencieux d’outbox révoquée**, **warm sur curseur expiré**.

---

## Références code (audit)

- Mobile : `AdminDataContext.tsx`, `AuthContext.tsx`, `livePermissionsRefresh.ts`, `offlinePermissionsSnapshot.ts`, `outbox.ts`, `OutboxRuntime.tsx`, `attendanceOffline.ts`, `dataTruth.ts`, `connectivity.ts`, `networkResilience.ts`, `evaluationsV2.ts`, `planningV2.ts`, `services/api.ts`, `services/secureStorage.ts`
- Backend : `server.js` (GET L1/L2, `loadCanonicalPedagogyForPrincipal`), `classStudentsAuthz.js`, `noteConcurrency.js`, `pedagogyPgStore.js`, `db/schema.sql`, `rbacService.js`
- Sécurité device : `Mobile/plugins/withSomafrikAndroidSecurity.js`
