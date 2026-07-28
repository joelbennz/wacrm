-- ============================================================
-- 037_contact_engagement_metrics.sql
--
-- Account-scoped contact engagement metrics. The next migration keeps
-- these values in sync from the messages table and backfills history.
-- ============================================================

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS message_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_response_time INTEGER,
  ADD COLUMN IF NOT EXISTS engagement_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing contacts predate first_seen_at. Their creation time is the
-- least surprising historical value and avoids assigning migration time.
UPDATE public.contacts
SET first_seen_at = COALESCE(created_at, NOW())
WHERE first_seen_at IS NULL;

ALTER TABLE public.contacts
  ALTER COLUMN first_seen_at SET DEFAULT NOW(),
  ALTER COLUMN first_seen_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_message_count_nonnegative'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_message_count_nonnegative
      CHECK (message_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_response_rate_range'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_response_rate_range
      CHECK (response_rate >= 0 AND response_rate <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_engagement_score_range'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_engagement_score_range
      CHECK (engagement_score >= 0 AND engagement_score <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_avg_response_time_nonnegative'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_avg_response_time_nonnegative
      CHECK (avg_response_time IS NULL OR avg_response_time >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_message_count
  ON public.contacts(message_count);
CREATE INDEX IF NOT EXISTS idx_contacts_last_message_at
  ON public.contacts(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_response_rate
  ON public.contacts(response_rate);
CREATE INDEX IF NOT EXISTS idx_contacts_engagement_score
  ON public.contacts(engagement_score);
CREATE INDEX IF NOT EXISTS idx_contacts_opt_out
  ON public.contacts(account_id)
  WHERE opt_out = TRUE;

COMMENT ON COLUMN public.contacts.message_count IS
  'Total inbound and outbound messages linked to this contact.';
COMMENT ON COLUMN public.contacts.last_message_at IS
  'Timestamp of the most recent message in either direction.';
COMMENT ON COLUMN public.contacts.response_rate IS
  'Percentage of inbound messages followed by an agent or bot response.';
COMMENT ON COLUMN public.contacts.avg_response_time IS
  'Average seconds from an inbound message to the next outbound response.';
COMMENT ON COLUMN public.contacts.engagement_score IS
  'Composite 0-100 score based on recency, volume, and response rate.';
COMMENT ON COLUMN public.contacts.first_seen_at IS
  'Earliest known timestamp for the contact or one of their messages.';
COMMENT ON COLUMN public.contacts.last_contacted_at IS
  'Timestamp of the most recent outbound agent or bot message.';
COMMENT ON COLUMN public.contacts.opt_out IS
  'Whether outbound marketing messages are disabled for this contact.';
