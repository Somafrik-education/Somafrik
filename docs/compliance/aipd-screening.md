# AIPD — screening (annexe, pas une AIPD)

**Date :** 2026-09-04, mis à jour 2026-09-05  
**Ce fichier n’est pas une AIPD.** L’analyse formelle est `aipd-somafrik.md`.  
**Décision CTO (5 septembre 2026) :** ne pas clore le sujet sur un screening. Enfants / personnes vulnérables + dimension multi-établissements → **AIPD formelle obligatoire** avant GO final.

## Critères CNIL (indicatif)

| Critère | Observation Somafrik |
|---|---|
| Données de mineurs | Oui (fiches élèves) |
| Données sensibles (art. 9) | Non comme finalité ; pièces jointes peuvent en contenir |
| Surveillance systématique | Non |
| Décision automatisée | Non |
| Large échelle | Multi-établissements, volume selon clients |
| Croisement de fichiers | Non hors établissement |
| Personnes vulnérables | Enfants scolarisés |
| Usage innovant | Non |
| Exclusion de droit | Non |

**Mesures déjà dans le code :** cloisonnement établissement, deny Superadmin/Admin Pays, pas de Data API client, TTL court, refresh rotatif, workflow d’effacement partiel (compte, pas le dossier scolaire).

Ce screening **ne remplace pas** `aipd-somafrik.md` et n’a **pas** de signature.
