# Finance F7 — UX Finance Web + Mobile — 2026-08-28

**Type :** UX clients. Pas de nouvelle table. Pas de nouveau calcul d’autorité.  
**Repo :** `Somafrik-education/Somafrik`  
**Base :** `origin/develop@3860a1290dd88b9ab6f907897ce225a049b89bca`  
**Branche :** `cursor/finance-f7-ux-web-mobile-9855`  
**F1–F6 :** mergés. F7 consomme leurs contrats. F8 non ouvert.

```text
FINANCE F7 UX WEB+MOBILE = attente revue CTO indépendante
PR      DRAFT
Ready   NON
Merge   NON
F8      NON OUVERT
```

Gate : `npm run verify:finance-ux`

---

## Matrice permission → action UI

| Permission effective | Web | Mobile |
|---|---|---|
| `Paiements:READ` | Liste, reçu, KPI, export | Liste, reçus, soldes |
| `Paiements:CREATE` | CTA Enregistrer un encaissement | CTA Enregistrer un encaissement |
| `Paiements:UPDATE` | CTA Annuler | CTA Annuler le paiement |
| `Frais & tarifs:READ` | Consultation tarifs / catalogue | — (via catalogue paiement) |
| `Frais & tarifs:CREATE` | Nouvelle grille | — |
| `Frais & tarifs:UPDATE` | Modifier / activer / appliquer / catalogue | — |
| `Impayés:READ` | Consultation restes à payer | — |
| `Impayés:CREATE` | Relancer | — |
| Permission absente | Action non proposée | Action non proposée |

Aucun `role === "Admin School" | "Comptable" | "Super Admin"` sur les écrans Finance.

Le backend F6 continue de refuser une mutation appelée directement.

---

## Devise

Helper unique :

- `web/src/lib/financeCurrency.ts`
- `Mobile/src/lib/financeCurrency.ts`

Source : catalogue établissement / pays / ligne.  
Alias de présentation `FC → CDF` uniquement.  
Aucun repli `USD` / `EUR` / `CDF` si le contexte est vide → `—`.

---

## Écrans

**Web**

- `FinancesLayout` — parcours tarif → obligation → encaissement → affectation → solde
- `EntityPage` paiements — KPI métier + historique + cartes mobile
- `QuickPaymentModal` — élève, frais ouverts, soldes serveur, garde double-submit, copies FR
- `FinanceFeesPage` / `FinanceUnpaidPage` / `SettingsFinancePage` — loading / empty / error / retry

**Mobile**

- `PaymentsScreen` / `StudentPaymentsScreen`
- `PaymentMutationControls` — confirmation après succès + refresh
- `PaymentReceiptCard` — date / référence / élève / montant / moyen / statut

---

## Non-régression

Pas de changement backend Finance F1–F6.  
Pas de second moteur métier client. Les soldes affichés restent la projection serveur.
