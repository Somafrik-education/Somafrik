# KNOWN-ISSUE-NOTES-01 — Sync enseignant bloquée (RBAC) après rollback P0

**Référence stable :** `KNOWN-ISSUE-NOTES-01`  
**Statut :** ouverte — dette critique connue  
**Sévérité :** bloquant pour toute fonctionnalité dépendant de notes / évaluations **persistées PostgreSQL**  
**Pas un incident runtime :** préprod auth / `getDataset` restaurés  

---

## 1. Constat (après rollback vers PR #69)

| Observation | État |
|-------------|------|
| Connexion enseignant | Fonctionnelle |
| Évaluations locales | Toujours présentes |
| Outbox | Enregistrements en échec (ex. 4) |
| Cause visible | `Permission insuffisante pour modifier ces données.` |
| Perte de données locale | Non observée (HOTFIX-SYNC-01) |
| Synchronisation serveur / PG | **Bloquée** |

Cohérent avec le rollback vers le merge PR #69 (`885979ff`) : le mécanisme non destructif conserve les évaluations, mais l’autorisation métier enseignant (SYNC-03) n’est **pas** réintroduite.

Les évaluations affichées **ne doivent pas** être considérées comme synchronisées.

---

## 2. Règles opérationnelles

- Ne **pas** supprimer les entrées outbox en échec
- Ne **pas** utiliser « Réessayer » en boucle
- Ne **pas** modifier manuellement la base pour forcer le passage
- Ne **pas** merger #71 / #72 en l’état (sources d’analyse uniquement)
- Travaux hors sync Notes : autorisés sous freeze global Notes PG
- Toute feature qui **dépend** de notes réellement en PostgreSQL : **bloquée** jusqu’à clôture de cette issue

---

## 3. Résolution prévue (ordre CTO)

1. **#73** — filet bootstrap runtime (`verify-runtime-bootstrap`) mergé / vert en CI  
2. **SYNC-03 isolé** — branche depuis `885979ff` (sans reprendre #71/#72) :
   - enseignant : `evaluations` + `notes` seulement
   - contrôle établissement / classe / matière
   - `teacherId` session
   - upsert partiel non destructif  
3. Validation SYNC-03 (bootstrap + 3 profils + périmètre + conservation patch partiel)  
4. **SYNC-04 isolé** — SAVEPOINT, résolution évaluation même TX, codes `GRADE_*`, outbox précise  

Bissection contrôlée obligatoire : ne pas conclure que #72 seule causait le P0 AUTH (le rollback a retiré **tous** les commits post-#69).

---

## 4. Références

| Élément | Lien |
|---------|------|
| Base saine runtime | `885979ff` / PR #69 |
| Bootstrap CI | [CONTRAT-BOOTSTRAP-RUNTIME.md](./CONTRAT-BOOTSTRAP-RUNTIME.md) · PR #73 |
| Analyse SYNC-03 | PR #71 (ne pas merger) |
| Analyse SYNC-04 | PR #72 (bloquée) |
| SYNC-01 non-perte | [CONTRAT-HOTFIX-SYNC-01.md](./CONTRAT-HOTFIX-SYNC-01.md) |

---

## 5. Critères de clôture

- [ ] Enseignant : création évaluation + note → ACK accepted / outbox vide  
- [ ] Seconde session : évaluation visible depuis PG  
- [ ] Hors périmètre (autre classe / matière) → 403 métier, pas de 500  
- [ ] PUT partiel : autres lignes enseignant conservées  
- [ ] Bootstrap CI toujours vert  
