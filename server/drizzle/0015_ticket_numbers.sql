-- New tickets get the highest ticket number + 1. Imported tickets keep
-- their numbers (Freshdesk's), and those don't have to start at 1 (one
-- company's started at 256) or be without gaps (Freshdesk leaves them for
-- deleted and spam tickets), so new tickets carry on after the last one
-- instead of filling those numbers in. Deleting the newest ticket frees
-- its number again (the highest goes back down).
-- The lock makes tickets arriving at the same moment get different numbers.
CREATE OR REPLACE FUNCTION next_ticket_id() RETURNS integer
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(7342001);
  SELECT COALESCE(MAX(id), 0) + 1 INTO n FROM tickets;
  RETURN n;
END
$$;
