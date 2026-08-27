# P0 — Rollback contrôlé vers RC2 Offline Read stable — 2026-08-27

**Type :** revert exclusif du merge #356  
**PR :** https://github.com/Somafrik-education/Somafrik/pull/358 — Draft dédiée  
**Branche :** `cursor/p0-rollback-rc2-offline-read-9855`  
**Revert :** `93ef4468`  
**Base :** `develop@1c7b8dfc5f232a7198494bea6e30530aab592e0e`  
**Cible stable :** `fc259bf3590c0b7a30da92a6d519a83503c5f4fc` (merge PR #353)

## Verdict

```text
RC2 Offline Read     RESTAURÉ
RC3 Offline Write    PARKED
Ready                NON
Merge                NON
```

## Contraintes respectées

- Aucun `reset` / `rebase` / `force-push` de `develop`
- Aucune modification de données PostgreSQL
- Aucun `backoffice_state`
- Revert `-m 1` du merge `1c7b8dfc` uniquement (premier parent = #353)

## Pourquoi ce rollback

#356 est déployée (`1c7b8dfc`) et KILOMBO reçoit toujours `GET /api/assignments` **200 + `[]`**.  
#356 restait un correctif valide pour `users.school_id = NULL`, mais ce n’était **pas** la cause KILOMBO (inventaire preprod déjà `CANONICAL`). Le correctif d’identité live a élargi le chemin Assignments sans restaurer les 4 lignes réseau.

P0 : ramener `develop` (via PR Draft, pas via reset) à l’arbre RC2 Offline Read GO.

## Arbre

```text
develop avant rollback
  1c7b8dfc  Merge #356  (identité enseignant live)
  fc259bf3  Merge #353  ← cible RC2 Offline Read GO

après revert -m 1 de 1c7b8dfc
  tree fonctionnel ≡ fc259bf3
  + ce document d’audit
```

## Conservé (RC2)

| Élément | Source |
|---|---|
| SQLCipher natif | #352 |
| RC2 Offline Read smoke | #353 @ `fc259bf3` |
| L1 Classes | inchangé |
| L1 Students | inchangé |
| L1 Assignments | inchangé (projection RC2) |
| L1 SchoolCourses | inchangé |
| L1 CourseSchedules | inchangé |
| Permissions offline | inchangé |
| Refus des mutations offline | inchangé |

## Retiré (uniquement #356)

- `getLiveTeacherIdentityForSchool` sans JOIN `users.school_id` → rétablit le JOIN `u.school_id = t.school_id`
- scripts / tests `teacherCanonicalIdentityAudit`
- `verify:teacher-canonical-identity` / `audit:teacher-canonical-identity`
- gate CI `verify:teacher-canonical-identity`
- `docs/audits/mobile-p1-teacher-canonical-identity-2026-08-27.md`

## Hors scope (restent PARKED, non mergés)

| PR | Branche | Statut |
|---|---|---|
| #354 RC3-1 SQLite outbox | `cursor/rc3-sqlite-outbox-exactly-once-9855` | Draft / PARKED |
| #355 RC3-2 présence physique | `cursor/rc3-physical-offline-presence-9855` | Draft / PARKED |
| #357 identité principale Assignments | `cursor/p1-teacher-assignments-principal-identity-9855` | Draft / PARKED |

Ces branches **ne sont pas** dans `develop`. Ce rollback ne les touche pas.

## Vérifications

```text
git diff fc259bf3590c0b7a30da92a6d519a83503c5f4fc HEAD
  => uniquement ce fichier d’audit (après commit docs)

Aucun fichier RC2 supprimé
verify:mobile-l1-sqlite-cache
verify:mobile-l1-offline-reads
verify:mobile-rc2-offline-read-smoke
TypeScript / lint / tests ciblés
Aucun backoffice_state introduit
Aucune mutation PostgreSQL
Aucun reset de branche
```

## Suite

RC3 Offline Write ne reprend **pas** tant que ce rollback n’est pas explicitement mergé (décision humaine) **et** que KILOMBO n’a pas un chemin Assignments prouvé hors hypothèse `users.school_id`.

#357 (JWT `sub` overlay `teachers.id`) reste le diagnostic d’identité principale, mais il est **PARKED** avec RC3 : pas de Ready, pas de merge, pas de rebase sur ce rollback.
