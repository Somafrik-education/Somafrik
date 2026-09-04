# AIPD — screening (pas une AIPD complète)

**Date :** 2026-09-04  
**Conclusion de ce screening :** une analyse d’impact formelle reste à **valider par le CTO** pour le traitement « plateforme scolaire multi-établissements contenant des données d’enfants ».

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

Ce fichier n’est **pas** une AIPD signée. Il ne clôt pas l’obligation d’AIPD si le CTO la juge requise.
