-- PR G — EMAIL opérationnel (demande d'essai) : destinataire payload.to,
-- sans faker school_id/user_id. PUSH et EMAIL tenant restent scoped user+school.
ALTER TABLE communication_channel_deliveries
  ALTER COLUMN school_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL;

DO $deliveries_recipient$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'communication_channel_deliveries_recipient_chk'
  ) THEN
    ALTER TABLE communication_channel_deliveries
      ADD CONSTRAINT communication_channel_deliveries_recipient_chk
      CHECK (
        (school_id IS NOT NULL AND user_id IS NOT NULL)
        OR (
          channel = 'EMAIL'
          AND notification_id IS NULL
          AND school_id IS NULL
          AND user_id IS NULL
          AND COALESCE(btrim(payload->>'to'), '') <> ''
        )
      );
  END IF;
END
$deliveries_recipient$;
