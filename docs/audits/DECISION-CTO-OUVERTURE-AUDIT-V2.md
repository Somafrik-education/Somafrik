# Décision CTO — Ouverture officielle de l’Audit Pré-E1 V2

**Date :** 2026-07-27  
**Décideur :** CTO  
**Base documentaire :** [`PRE-E1-AUDIT-STATUS-AFTER-HOTFIX.md`](./PRE-E1-AUDIT-STATUS-AFTER-HOTFIX.md) (PR #93)

---

## 1. Décision

| Champ | Valeur |
|-------|--------|
| **Option retenue** | **A** |
| **Décision** | Autoriser l’ouverture officielle de l’**Audit Pré-E1 — phase V2** |
| **Nature** | Phase d’**audit**, **non** de développement |

---

## 2. Constats validés

| Constat | Statut |
|---------|--------|
| HOTFIX-01 / 02 / 02B restent clôturés et ne doivent pas être rouverts | ✅ |
| Le dossier de cadrage est limité à la gouvernance (pas d’implémentation / correctif métier) | ✅ |
| `PRE-E1-IDENTITY-LIFECYCLE` peut être traité dans V2 et ne justifie pas, à elle seule, un nouveau hotfix | ✅ |

### Formulation retenue (réserve CTO)

> Aucun blocker technique V1 n’a été identifié dans ce dossier comme empêchant l’ouverture de V2.  
> L’ouverture de V2 relève désormais d’une décision de gouvernance CTO.

---

## 3. Périmètre V2

- Modèle de données  
- Intégrité  
- Source of Truth  
- `PRE-E1-IDENTITY-LIFECYCLE`  
- `student_code` (`PRE-E1-STUDENT-CODE-SCOPE`)  
- Autres risques documentés à caractériser (hypothèses Phase 0 / dettes majeures)

---

## 4. Contraintes

| Contrainte | Règle |
|------------|-------|
| Implémentation métier | **Interdite** |
| Livrables autorisés | Caractérisation, preuves, contrats |
| Correctifs | **Uniquement** après anomalie **démontrée** (dossier de preuve) |
| HOTFIX-02 / 02B | **Ne pas rouvrir** |
| E1 Bulletins | **NO-GO** jusqu’à décision V7 |

---

## 5. Gouvernance après décision

| Élément | Statut |
|---------|--------|
| Audit Pré-E1 | **OUVERT** |
| Audit V2 | **OUVERTE** (phase audit) |
| HOTFIX-01 / 02 / 02B | **CLOS** |
| E1 | **NO-GO** |
| PR #84 | Draft — preuves historiques intactes |

---

## 6. Référence

- État des lieux : [`PRE-E1-AUDIT-STATUS-AFTER-HOTFIX.md`](./PRE-E1-AUDIT-STATUS-AFTER-HOTFIX.md)
