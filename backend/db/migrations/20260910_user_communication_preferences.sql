-- PR E — préférences de communication par user + school + channel (IN_APP | PUSH | EMAIL).
-- Aucune colonne fournisseur : le choix Expo/FCM ou SMTP reste infrastructurel.
CREATE TABLE IF NOT EXISTS user_communication_preferences (
  user_id UUID NOT NULL REFERENCES users(id),
  school_id UUID NOT NULL REFERENCES schools(id),
  channel TEXT NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'EMAIL')),
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, school_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_user_communication_preferences_school_user
  ON user_communication_preferences (school_id, user_id);
