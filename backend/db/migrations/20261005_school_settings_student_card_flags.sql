-- CARTE-PR0 — flags carte élève sur school_settings.
-- Tous FALSE par défaut. Absent / table ancienne / valeur invalide = désactivé.

ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS student_card_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS student_card_qr_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS student_card_nfc_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS student_card_attendance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS student_card_finance_check_enabled BOOLEAN NOT NULL DEFAULT FALSE;
