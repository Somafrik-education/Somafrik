-- Invalidation ciblée des sessions après réconciliation RBAC P0.
-- INTERDIT : DELETE FROM sessions ; TRUNCATE sessions.
-- INTERDIT : exécuter sur Somafrik-prod depuis Cursor. GO CTO obligatoire.

BEGIN;

UPDATE sessions s
SET
  revoked_at = NOW(),
  revoke_reason = 'rbac_system_roles_reconciliation_p0'
WHERE s.revoked_at IS NULL
  AND s.user_id IN (
    SELECT DISTINCT ur.user_id
    FROM user_roles ur
    WHERE ur.status = 'active'
      AND upper(ur.role_key) IN (
        'PROVISEUR',
        'PREFET_ETUDES',
        'PRINCIPAL',
        'SECRETARY',
        'TEACHER',
        'PARENT',
        'STUDENT',
        'ACCOUNTANT',
        'SUPERVISOR'
      )
  );

COMMIT;

-- Contrôle post-révocation (lecture)
SELECT
  s.revoke_reason,
  COUNT(*)::int AS revoked_count
FROM sessions s
WHERE s.revoke_reason = 'rbac_system_roles_reconciliation_p0'
GROUP BY s.revoke_reason;
