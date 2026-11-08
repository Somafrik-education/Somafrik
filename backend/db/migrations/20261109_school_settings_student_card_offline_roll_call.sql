-- NFC-PRES-LOCAL-PR3 — flag établissement de l'appel hors connexion par carte (NFC / QR).
-- FALSE par défaut, jamais activé automatiquement. Absent / valeur invalide = désactivé.
-- Il s'ajoute aux flags existants (maître, présences, NFC, QR) sans les remplacer.

ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS student_card_offline_roll_call_enabled BOOLEAN NOT NULL DEFAULT FALSE;
