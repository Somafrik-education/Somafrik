-- ADMIN-02B — alias d'affichage global, distinct de l'identité rôle.
-- Nullable, non UNIQUE : deux rôles peuvent afficher le même texte.

ALTER TABLE establishment_roles
  ADD COLUMN IF NOT EXISTS display_label TEXT;
