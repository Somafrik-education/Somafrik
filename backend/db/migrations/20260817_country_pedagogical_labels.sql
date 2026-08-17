-- Libellés UI pédagogiques par pays (LEVEL / TRACK / GROUP).
-- Défauts génériques — pas un vocabulaire national injecté dans tous les pays.

ALTER TABLE countries ADD COLUMN IF NOT EXISTS pedagogical_level_label TEXT NOT NULL DEFAULT 'Niveau';
ALTER TABLE countries ADD COLUMN IF NOT EXISTS pedagogical_track_label TEXT NOT NULL DEFAULT 'Filière';
ALTER TABLE countries ADD COLUMN IF NOT EXISTS pedagogical_group_label TEXT NOT NULL DEFAULT 'Groupe';
