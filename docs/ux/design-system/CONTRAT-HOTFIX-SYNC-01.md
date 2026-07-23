# Contrat HOTFIX-SYNC-01 — Intégrité non destructive de la synchronisation

**Lot :** HOTFIX-SYNC-01  
**Priorité :** Bloquante — suspend les lots fonctionnels suivants tant que la règle n’est pas garantie  
**Prérequis :** `d3.6c` livré techniquement ; gate roadmap fonctionnelle suspendu  

---

## 1. Règle fondamentale

> Une synchronisation ne peut **jamais** provoquer une perte silencieuse de données.

Il est interdit de :

```
envoi → erreur ignorée → remplacement par snapshot serveur → disparition locale
```

---

## 2. Cycle de vie obligatoire

```
local_pending
  → envoi serveur
  → validation serveur
  → accusé de réception (id canonique / clientMutationId)
  → local_synced
```

En cas d’échec :

```
local_pending
  → sync_failed
  → enregistrement conservé
  → erreur visible
  → réessai possible
```

Statuts : `pending` | `syncing` | `synced` | `failed`.

---

## 3. Identité client

Chaque mutation écrite porte un `clientMutationId` stable (UUID).  
Le serveur doit pouvoir upsert de façon idempotente sur cet id / id métier.

---

## 4. Merge snapshot

Un GET / refresh serveur :

- ne remplace **pas** une ligne locale `pending` | `syncing` | `failed` ;
- n’écrase pas une mutation outbox non ACK ;
- peut remplacer uniquement les lignes `synced` (ou absentes de l’outbox).

`evaluations` est traité comme collection school-scoped (plus de wipe par spread).

---

## 5. Serveur Notes (PG)

- Sync **par enregistrement** : acceptés → PG ; rejetés → conservés en JSON durable avec `syncStatus: failed` + message.
- Strip JSON uniquement pour les ids **acceptés**.
- Réponse PUT expose `syncAck: { accepted[], rejected[] }` pour **evaluations/notes**.
- Domaines encore persistés par le snapshot BO (`presences`, `exams`, `payments`) : succès HTTP ⇒ **ACK implicite** des mutations du patch (même si `syncAck` Notes est vide ou partiel).
- Échec de rattachement (classe / matière / élève / établissement / année) → rejet visible, **pas** de disparition.

---

## 6. Périmètre audit

Évaluations · notes · appels/présences · examens · paiements · mécanisme générique `DataContext` / Mobile `AdminDataContext` · remplacement d’état après téléchargement.

---

## 7. Tests minimums

1. Créer évaluation offline → sync → reload → existe toujours  
2. Présence offline + erreur serveur → reste locale `failed`  
3. Double sync même mutation → un seul enregistrement canonique  
4. Snapshot serveur ancien → ne pas écraser pending local  
5. Échec rattachement classe/matière → message visible · aucune disparition  
