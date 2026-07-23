# Rapport D2.8d4 — Workflow Paiements

**Type :** Infrastructure UI D2.8d4  
**Module :** EntityPage + QuickPaymentModal  
**Sous-périmètre :** Plans métier Paiements uniquement (lot isolé)  
**Impact runtime :** Structurel — comportement inchangé  
**Migration métier :** Non  
**Backend/API :** Inchangés  
**Permissions :** Inchangées  
**Breaking change :** Non  

---

## 1. Objectif

Extraire les **plans métier Paiements** (annulation, reçu, persistance création) avec vigilance renforcée sur montants, immutabilité des écritures et audit financier.

---

## 2. Livrable

| Fichier | Rôle |
|---------|------|
| `web/src/pages/entity-page/paymentWorkflow.ts` | Plans cancel / receipt / create persist |
| `paymentWorkflow.test.ts` | 7 scénarios financiers |
| `EntityPage.tsx` | Thin wrappers + JSX modales |
| `QuickPaymentModal.tsx` | Confirms UI + appels plans |

---

## 3. API extraite

| Fonction | Rôle |
|----------|------|
| `buildPaymentCancelPlan` | Soft-cancel + motif + scope + audit `payment.cancel` |
| `buildPaymentReceiptPrintPlan` | Audit-only `payment.receipt.print` |
| `buildPaymentCreatePersistPlan` | Merge + audit `payment.create` + notif parent |

**Injecté :** `scopeUser`, `state`, `showToast`.  
**Confirms doublon / trop-perçu** et `window.print()` restent UI.

---

## 4. Invariants financiers préservés

- Soft-cancel uniquement (pas de delete) ; montant / référence / code vérif inchangés
- Motif d’annulation trimé et obligatoire
- Refuse déjà annulé / hors périmètre
- Reçu = audit seul (pas de mutation des lignes)
- Création via saisie rapide uniquement (pas de CRUD générique EntityPage)
- Actions audit : `payment.create` / `payment.cancel` / `payment.receipt.print`

---

## 5. Hors lot

- Contacts, Relations, Affectations
- Domaine `lib/quickPayment.ts` (non déplacé)
- Paiements abonnement SaaS
- JSX modales

---

## 6. Tests

| Suite | Couverture |
|-------|------------|
| `paymentWorkflow.test.ts` | Motif, déjà annulé, scope, immutabilité, reçu, create |
| entity-page + listes D3 | Régression |
| `tsc` / eslint | OK |

---

## 7. Tableau CTO

| Élément | Résultat |
|---------|----------|
| Lot isolé Paiements | Oui |
| Hooks / contextes | Non |
| JSX déplacé | Non |
| Vigilance montants / audit / immutabilité | Oui |
| Suite | D2.8e — nettoyage final EntityPage |
