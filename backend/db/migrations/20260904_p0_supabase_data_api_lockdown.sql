-- P0-1 — verrouillage Data API Supabase (anon / authenticated).
-- Idempotente. Ne touche pas service_role ni les schémas d'extensions.
-- INTERDIT : exécuter sur Somafrik-prod depuis Cursor. GO CTO obligatoire.
--
-- Cible : 0 privilège métier SELECT/INSERT/UPDATE/DELETE exploitable par
-- `anon`, `authenticated` ou PUBLIC sur le schéma public.
-- Le backend applicatif (rôle propriétaire / DATABASE_URL) n'est pas révoqué.

BEGIN;

DO $$
DECLARE
  target_role TEXT;
  owner_role TEXT;
  lockdown_roles TEXT[] := ARRAY['anon', 'authenticated'];
BEGIN
  FOREACH target_role IN ARRAY lockdown_roles
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', target_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', target_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', target_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', target_role);
      BEGIN
        EXECUTE format('REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM %I', target_role);
      EXCEPTION
        WHEN undefined_object THEN
          NULL;
      END;
    END IF;
  END LOOP;

  -- PUBLIC : les grants hérités ouvriraient sinon anon/authenticated.
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO PUBLIC;
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

  -- Default privileges : futures tables/séquences/fonctions.
  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin', current_user::text]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC',
        owner_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC',
        owner_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC',
        owner_role
      );
      FOREACH target_role IN ARRAY lockdown_roles
      LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target_role) THEN
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
            owner_role,
            target_role
          );
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
            owner_role,
            target_role
          );
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I',
            owner_role,
            target_role
          );
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- service_role : ne pas casser le rôle interne Supabase (bypass RLS).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
  END IF;
END $$;

COMMIT;
