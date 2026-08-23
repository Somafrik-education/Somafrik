# PR-0 — Inventaire live des référentiels pédagogiques

**Mode :** diagnostic uniquement.  
**Base :** `origin/develop` `@c13df0ee5857dd86933fce33bad16eefe5b562cc`  
**Gouvernance :** Draft. Aucun Ready. Aucun merge. Aucun UPDATE / DELETE / migration de données.

Référence d’architecture : [`PEDAGOGICAL-MODEL-V2.md`](./PEDAGOGICAL-MODEL-V2.md).

---

## Pourquoi avant PR-1

L’index `uq_classes_structural_offering` ne protège pas deux classes identiques avec `group_id IS NULL`.  
Avant d’autoriser le groupe facultatif, il faut savoir :

- ce qui est réellement en base (`Bio-chimie`, `Générale`, `Confession catholique`, …) ;
- combien de classes ont déjà `group_id IS NULL` ;
- s’il existe déjà des doublons structurels hors index.

Toute valeur ambiguë → **STOP**, aucune correction automatique.

---

## Exécution

```bash
# Tests du classificateur (sans base)
node --test backend/lib/pedagogicalReferenceInventory.test.js

# Inventaire live (transaction BEGIN READ ONLY)
DATABASE_URL=postgresql://… npm run inventory:pedagogical-reference

# Preprod
PREPROD_DATABASE_URL=postgresql://… npm run inventory:pedagogical-reference

# Preuves
PROOF_OUT=docs/audits/evidence/pedagogical-reference-inventory.json \
PROOF_MD=docs/audits/evidence/pedagogical-reference-inventory.md \
  npm run inventory:pedagogical-reference
```

SQL brut (équivalent, sans matrice) :

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "BEGIN READ ONLY;" \
  -f backend/db/inventory_pedagogical_reference.sql \
  -c "ROLLBACK;"
```

Refusé : `--apply`, `--write`, `--fix`, `--migrate`, `SOMAFRIK_PEDAGOGICAL_BACKFILL=1`.

Sans `DATABASE_URL`, le runner sort `PENDING_LIVE_DB` et n’invente aucune ligne.

---

## Inventaire produit

| Source | Colonnes |
|---|---|
| `education_streams` | id, pays, name, stream_type, level_id, status |
| `education_class_groups` | id, pays, group_code, name, status |
| `school_streams` / `school_class_groups` | activations par établissement |
| `classes` | class_code, année, level_id, stream_id, group_id, group_code |

Signalement obligatoire (toujours **ambiguë = oui — STOP**) :

- streams : `Bio-Chimie`, `Biochimie`, `Math-Physique`, `Scientifique`, `Sciences`, `Générale`
- groupes dont le nom/code contient : `Confession`, `Catholique`, `Protestant`, `Conventionné`, `Officiel`, `Non conventionné`

Matrice :

```text
valeur → type actuel → nombre de classes → établissements → classification proposée → ambiguë oui/non
```

La colonne « classification proposée » est une **hypothèse**. Elle n’écrit rien.

---

## Résultat de cette PR (agent Cloud)

`DATABASE_URL` était **absent** dans l’environnement d’agent.  
L’inventaire **live n’a pas été exécuté ici**. Relancer le runner contre preprod/prod et joindre JSON + Markdown sous `docs/audits/evidence/` avant PR-1.

| Contrôle | Statut |
|---|---|
| Script SELECT-only + tests classificateur | livré |
| Exécution PostgreSQL live | **PENDING_LIVE_DB** |
| `Confession catholique` en base | inconnu tant que le runner n’a pas tourné |
| Classes `group_id IS NULL` | inconnu tant que le runner n’a pas tourné |
| Doublons structurels à groupe NULL | inconnu tant que le runner n’a pas tourné |

---

## Suite autorisée

Après un dump live et revue humaine des lignes STOP :

1. **PR-1** — unicité NULL puis `groupId` facultatif (API + Web + Mobile, valeur initiale Aucun).
2. Pas de `UPDATE education_streams.stream_type`.
3. Pas d’archivage automatique d’un groupe confessionnel.
4. Chantier taxonomie (section / série / option / parent) **après** PR-1.
