-- BULLETIN-CATALOG-01 — retour arrière documenté (JAMAIS exécuté automatiquement).
--
-- Supprime uniquement les tables du catalogue. Les profils, gabarits, demandes,
-- liaisons actives et snapshots publiés ne sont pas concernés : les bulletins
-- configurés et publiés restent valides. Après exécution, plus aucun modèle du
-- catalogue n'est proposé aux établissements (fail-closed).

DROP TABLE IF EXISTS report_card_catalog_availability_audit;
DROP TABLE IF EXISTS report_card_catalog_availability;
DROP TABLE IF EXISTS report_card_catalog_models;
