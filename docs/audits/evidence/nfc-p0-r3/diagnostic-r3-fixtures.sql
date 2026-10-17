-- NFC-P0-R3 — jeu d'essai SYNTHÉTIQUE pour valider diagnostic-r3-readonly.sql.
-- Uniquement sur une base locale jetable chargée avec backend/db/schema.sql.
-- JAMAIS sur la préproduction ni la production. Aucune donnée réelle.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO countries (id, name, iso_code, phone_code, currency)
VALUES ('00000000-0000-4000-8000-0000000000c1', 'Pays test', 'ZZ', '+000', 'XXX');
INSERT INTO schools (id, country_id, name, school_code) VALUES
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000c1', 'École A (présentatrice)', 'R3A'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000c1', 'École B (autre)', 'R3B');

-- Élèves synthétiques : s01..s14 dans A, sb dans B. s09 est inactif.
INSERT INTO students (id, school_id, first_name, last_name, student_code, status)
SELECT ('00000000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-00000000000a', 'Synthétique', 'E' || n, 'R3-' || n,
       CASE WHEN n = 9 THEN 'inactive' ELSE 'active' END
  FROM generate_series(1, 14) n;
INSERT INTO students (id, school_id, first_name, last_name, student_code)
VALUES ('00000000-0000-4000-8000-0000000002bb', '00000000-0000-4000-8000-00000000000b', 'Synthétique', 'B', 'R3-B');

-- Helper: one card row. Times are relative to now() so the deadlines are deterministic.
CREATE TEMP TABLE fx (n int, school uuid, student uuid, uid text, status text, reason text, state text,
  encoded boolean, locked boolean, issued interval, expires interval, replaces uuid, replaced_by uuid, card uuid);
INSERT INTO fx VALUES
 -- n  school  student  uid               status     reason                    state      enc   lock  issued        expires(after issued)
 (2,  '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000002bb', '04000000000002', 'revoked', 'nfc_reservation_expired', 'pending', false, false, '-3 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c002'),
 (3,  null, null, '04000000000003', 'active',   null,                      'encoded', true,  false, '-3 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c003'),
 (4,  null, null, '04000000000004', 'lost',     'lost',                    'encoded', true,  false, '-3 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c004'),
 (6,  null, null, '04000000000006', 'issued',   null,                      'pending', false, false, '-5 min',  '30 min', null, null, '00000000-0000-4000-8000-00000000c006'),
 (7,  null, null, '04000000000007', 'issued',   null,                      'pending', false, false, '-2 hours','30 min', null, null, '00000000-0000-4000-8000-00000000c007'),
 (8,  null, null, '04000000000008', 'revoked',  'nfc_reservation_expired', 'pending', false, false, '-3 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c008'),
 (9,  null, null, '04000000000009', 'revoked',  'nfc_reservation_expired', 'pending', false, false, '-3 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c009'),
 (12, null, null, '0400000000000C', 'revoked',  'nfc_abandoned',           'pending', false, false, '-3 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c012'),
 (13, null, null, '0400000000000D', 'revoked',  'revoked',                 'encoded', true,  false, '-3 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c013'),
 (14, null, null, '0400000000000E', 'active',   null,                      'locked',  true,  true,  '-3 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c014');

-- s10 owns an active card (other UID) + an expired reservation => EXPIRED_HOLDER_HAS_CARD.
-- s11 owns an active card (other UID) + an expired replacement reservation => EXPIRED_REPLACEMENT.
-- s05 owns a replaced card (UID ...05) and its active successor (UID ...15) => REPLACED.
INSERT INTO fx VALUES
 (10, null, '00000000-0000-4000-8000-000000000110', '04000000000010', 'active',  null, 'encoded', true, false, '-9 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c110'),
 (10, null, null, '0400000000000A', 'revoked', 'nfc_reservation_expired', 'pending', false, false, '-3 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c010'),
 (11, null, '00000000-0000-4000-8000-000000000111', '04000000000011', 'active',  null, 'encoded', true, false, '-9 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c111'),
 (11, null, null, '0400000000000B', 'revoked', 'nfc_reservation_expired', 'pending', false, false, '-3 days', '30 min', '00000000-0000-4000-8000-00000000c111', null, '00000000-0000-4000-8000-00000000c011'),
 (5,  null, null, '04000000000015', 'active',  null, 'encoded', true, false, '-2 days', '30 min', null, null, '00000000-0000-4000-8000-00000000c015'),
 (5,  null, null, '04000000000005', 'replaced','replaced', 'encoded', true, false, '-9 days', '30 min', null, '00000000-0000-4000-8000-00000000c015', '00000000-0000-4000-8000-00000000c005');

INSERT INTO student_access_cards (id, school_id, student_id, medium, status, public_id, token_hash,
  issued_at, revoked_at, revoke_reason, replaced_by_card_id, nfc_uid, nfc_tag_type, nfc_encoding_state,
  nfc_encoded_at, nfc_locked_at, nfc_operation_id, nfc_reservation_expires_at, nfc_replaces_card_id)
SELECT f.card,
       coalesce(f.school, '00000000-0000-4000-8000-00000000000a'),
       coalesce(f.student, ('00000000-0000-4000-8000-0000000001' || lpad(f.n::text, 2, '0'))::uuid),
       'nfc', f.status, 'pub-r3-' || f.uid, encode(sha256(convert_to('r3-fixture-' || f.uid, 'UTF8')), 'hex'),
       now() + f.issued,
       CASE WHEN f.status IN ('lost', 'revoked', 'replaced') THEN now() + f.issued + interval '1 hour' END,
       f.reason, f.replaced_by, f.uid, 'NTAG216', f.state,
       CASE WHEN f.encoded THEN now() + f.issued + interval '1 min' END,
       CASE WHEN f.locked THEN now() + f.issued + interval '2 min' END,
       gen_random_uuid(), now() + f.issued + f.expires, f.replaces
  FROM fx f
 ORDER BY (f.replaced_by IS NOT NULL), (f.replaces IS NOT NULL);
COMMIT;
