-- NFC-P0-R3 — preuve de cloisonnement inter-établissements (revue CTO, correction 1).
-- Base locale jetable du jeu d'essai uniquement. Tout est annulé par ROLLBACK
-- (rôles et politiques compris). JAMAIS sur préproduction ou production.
--
-- Montre que la séparation demandée peut être imposée par PostgreSQL lui-même :
--   C1. Étape 1 (recherche globale) sous un rôle qui n'a le droit de lire QUE
--       (nfc_uid, school_id) : la recherche fonctionne ; toute autre colonne est refusée.
--   C2. Étape 2 (détails) sous RLS limitée à l'établissement présentateur : la ligne
--       d'un autre établissement est invisible, même sans filtre dans la requête.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE r3_uid_lookup NOLOGIN;
CREATE ROLE r3_school_reader NOLOGIN;
GRANT USAGE ON SCHEMA public TO r3_uid_lookup, r3_school_reader;
GRANT SELECT (nfc_uid, school_id) ON student_access_cards TO r3_uid_lookup;
GRANT SELECT ON student_access_cards, students TO r3_school_reader;
ALTER TABLE student_access_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
CREATE POLICY r3_cards_own_school ON student_access_cards FOR SELECT TO r3_school_reader
  USING (school_id = current_setting('r3.school_id')::uuid);
CREATE POLICY r3_students_own_school ON students FOR SELECT TO r3_school_reader
  USING (school_id = current_setting('r3.school_id')::uuid);
CREATE POLICY r3_lookup_all ON student_access_cards FOR SELECT TO r3_uid_lookup USING (true);
SET LOCAL r3.school_id = '00000000-0000-4000-8000-00000000000a';

-- C1 — étape 1 sous le rôle restreint.
SET LOCAL ROLE r3_uid_lookup;
SELECT 'C1 recherche globale' AS preuve, left(nfc_uid, 2) || '••••••••' || right(nfc_uid, 4) AS uid_masque,
       school_id = '00000000-0000-4000-8000-00000000000a'::uuid AS same_school
  FROM student_access_cards WHERE nfc_uid IN ('04000000000002', '04000000000008') ORDER BY 2;
SAVEPOINT c1;
DO $$ BEGIN
  PERFORM status FROM student_access_cards WHERE nfc_uid = '04000000000002';
  RAISE EXCEPTION 'ÉCHEC : le rôle de recherche globale lit le statut';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'C1 OK : recherche globale limitée à (nfc_uid, school_id), statut refusé';
END $$;
ROLLBACK TO SAVEPOINT c1;
RESET ROLE;

-- C2 — étape 2 sous RLS : aucun filtre school_id dans la requête, la ligne de B reste invisible.
SET LOCAL ROLE r3_school_reader;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM student_access_cards c
    LEFT JOIN students s ON s.id = c.student_id
   WHERE c.nfc_uid IN ('04000000000002', '04000000000008');
  IF n <> 1 THEN RAISE EXCEPTION 'ÉCHEC : % ligne(s) visibles, 1 attendue', n; END IF;
  IF EXISTS (SELECT 1 FROM student_access_cards WHERE nfc_uid = '04000000000002') THEN
    RAISE EXCEPTION 'ÉCHEC : carte d''un autre établissement visible';
  END IF;
  RAISE NOTICE 'C2 OK : détails limités à l''établissement présentateur (carte de B invisible)';
END $$;
RESET ROLE;
ROLLBACK;
