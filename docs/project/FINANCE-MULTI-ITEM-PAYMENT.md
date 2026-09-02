# P0 Finance — Paiement multi-libellés / reçu unique

**Base :** `develop` live après #266.  
**Branche :** `cursor/finance-multi-item-payment-b1e7`  
**Statut :** PR Draft — aucun Ready, aucun merge. Revalidation CTO indépendante.

## Séparation métier

| Concept | Grain | Autorité | Ce que ce n’est pas |
| --- | --- | --- | --- |
| **Paiement / reçu** | Encaissement | `payments` (`payment_code`, `amount` = total serveur) | Une ligne de libellé |
| **Ligne de reçu** | Libellé + montant | `payment_items` | Un second `payments` |
| **Total** | `SUM(payment_items.amount)` | Recalcul backend | Le `totalAmount` / `amount` client |

L’encaissement est l’opération financière. Les libellés sont les lignes du reçu. Une saisie Minerval 500 + Examen 1 + Cantine 40 produit **un** `payments` (référence unique, total 541) et **trois** `payment_items`.

## API

`POST /api/payments` canonique :

```json
{
  "studentId": "uuid-ou-code",
  "items": [
    { "feeTypeId": "uuid", "amount": 500 },
    { "feeType": "Frais d'examen", "amount": 1 },
    { "feeType": "Frais de cantine", "amount": 40 }
  ],
  "paymentMethod": "cash",
  "paidAt": "2026-08-19"
}
```

Alias conservés (legacy LOT 4) : `{ feeType, amount, method, date }` → **une** ligne. `paymentMethod` / `paidAt` acceptés à côté de `method` / `date`.

Réponse : `{ id, reference, totalAmount, items, itemsDetail, … }`. `id` reste le `payment_code`. `totalAmount` = `amount` persisté (colonne existante, pas de seconde colonne total).

Le backend **ignore** `totalAmount` / `amount` globaux du client dès que `items` est fourni.

Refus : `items` vide (`PAYMENT_ITEMS_REQUIRED`), montant ≤ 0 (`PAYMENT_ITEM_AMOUNT_INVALID`), type de frais d’un autre tenant (`FEE_ITEM_TENANT_MISMATCH`).

## Transaction

```
BEGIN
INSERT payment
INSERT item 1..n
allocations + audit
COMMIT
```

Échec d’une ligne → `ROLLBACK` total. Aucun reçu partiel.

## Historique

Inventaire puis backfill **1:1** uniquement : un ancien `payments` → une `payment_items` copiant `fee_type` + `amount`.

**Interdit :** fusion automatique des anciens paiements parce qu’ils ont le même élève et la même date. Cela fusionnerait des encaissements réellement distincts.

Les nouveaux paiements sont multi-libellés canoniques. Les anciens restent chacun un reçu individuel.

## UI

- Formulaire : élève *, lignes libellé/montant, **+ Ajouter une ligne de frais**, total auto, mode *, date *, commentaire, **Enregistrer l'encaissement**.
- Liste `/finances/paiements` : **une ligne par reçu** — Référence, Élève, Détail (`3 libellés`), Total, Mode, Date, Statut, Actions (Reçu).
- Clic Détail ou Reçu / PDF : toutes les lignes + total général.

## Preuves

`npm run verify:finance-multi-item-payment` — CI (`ci.yml`) et Security (`security.yml`).

Couvre Esther 500+1+40 (`payments +1`, `payment_items +3`, total 541, une référence), total client falsifié, items vides / montant ≤ 0, fee d’un autre tenant, rollback item #3, annulation du reçu complet, pas de fusion même élève + même date.

Le chemin legacy `verify:finance-management` reste exigé (un libellé = un reçu d’une ligne).
