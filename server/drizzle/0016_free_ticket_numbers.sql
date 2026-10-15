-- Ticket numbers freed by deleting a ticket in the helpdesk (the Delete
-- button, or deleting a customer with their tickets: tickets.js,
-- customers.js). A new ticket takes the lowest of these first, then the
-- highest number + 1. Gaps nobody freed here (numbers below the first
-- imported ticket, gaps in Freshdesk's numbering) are never used, so new
-- tickets after an import carry on after the last one (#8123 → #8124).
CREATE TABLE IF NOT EXISTS "free_ticket_numbers" (
	"number" integer PRIMARY KEY NOT NULL,
	"freed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION next_ticket_id() RETURNS integer
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  n integer;
BEGIN
  -- Tickets arriving at the same moment get different numbers
  PERFORM pg_advisory_xact_lock(7342001);
  -- The lowest freed number that no ticket has (it's taken off the list;
  -- if the new ticket isn't saved after all, that's undone with it)
  LOOP
    SELECT "number" INTO n FROM free_ticket_numbers ORDER BY "number" LIMIT 1;
    EXIT WHEN n IS NULL;
    DELETE FROM free_ticket_numbers WHERE "number" = n;
    IF NOT EXISTS (SELECT 1 FROM tickets WHERE id = n) THEN
      RETURN n;
    END IF;
  END LOOP;
  SELECT COALESCE(MAX(id), 0) + 1 INTO n FROM tickets;
  RETURN n;
END
$$;
