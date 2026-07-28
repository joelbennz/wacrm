-- ============================================================
-- 038_contact_engagement_functions.sql
--
-- Derive contact engagement from canonical conversations/messages.
-- A trigger refreshes one contact after message inserts/deletes, while
-- the final block backfills contacts that existed before this migration.
-- ============================================================

DROP FUNCTION IF EXISTS public.increment_contact_message_count(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.update_contact_response_metrics(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.set_contact_opt_out(UUID, BOOLEAN);

-- Supports both the per-contact history scans and the correlated lookup of
-- the first outbound response after each inbound message.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender_created
  ON public.messages(conversation_id, sender_type, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id_id
  ON public.conversations(contact_id, id);

CREATE OR REPLACE FUNCTION public.recalculate_contact_engagement(
  p_contact_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_count INTEGER := 0;
  v_inbound_count INTEGER := 0;
  v_answered_count INTEGER := 0;
  v_last_message_at TIMESTAMPTZ;
  v_first_message_at TIMESTAMPTZ;
  v_last_contacted_at TIMESTAMPTZ;
  v_avg_response_time NUMERIC;
  v_response_rate NUMERIC(5,2) := 0;
  v_recency_score NUMERIC := 0;
  v_frequency_score NUMERIC := 0;
  v_responsiveness_score NUMERIC := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts WHERE id = p_contact_id
  ) THEN
    RETURN;
  END IF;

  SELECT
    COUNT(m.id)::INTEGER,
    MIN(m.created_at),
    MAX(m.created_at),
    MAX(m.created_at) FILTER (
      WHERE m.sender_type IN ('agent', 'bot')
    )
  INTO
    v_message_count,
    v_first_message_at,
    v_last_message_at,
    v_last_contacted_at
  FROM public.conversations c
  LEFT JOIN public.messages m ON m.conversation_id = c.id
  WHERE c.contact_id = p_contact_id;

  WITH inbound_responses AS (
    SELECT
      inbound.created_at,
      (
        SELECT MIN(outbound.created_at)
        FROM public.messages outbound
        WHERE outbound.conversation_id = inbound.conversation_id
          AND outbound.sender_type IN ('agent', 'bot')
          AND outbound.created_at > inbound.created_at
      ) AS responded_at
    FROM public.conversations c
    JOIN public.messages inbound ON inbound.conversation_id = c.id
    WHERE c.contact_id = p_contact_id
      AND inbound.sender_type = 'customer'
  )
  SELECT
    COUNT(*)::INTEGER,
    COUNT(responded_at)::INTEGER,
    AVG(EXTRACT(EPOCH FROM (responded_at - created_at)))
      FILTER (WHERE responded_at IS NOT NULL)
  INTO
    v_inbound_count,
    v_answered_count,
    v_avg_response_time
  FROM inbound_responses;

  v_response_rate := CASE
    WHEN v_inbound_count = 0 THEN 0
    ELSE ROUND((v_answered_count::NUMERIC / v_inbound_count) * 100, 2)
  END;

  v_recency_score := CASE
    WHEN v_last_message_at IS NULL THEN 0
    WHEN v_last_message_at >= NOW() - INTERVAL '1 hour' THEN 40
    WHEN v_last_message_at >= NOW() - INTERVAL '24 hours' THEN 30
    WHEN v_last_message_at >= NOW() - INTERVAL '7 days' THEN 20
    WHEN v_last_message_at >= NOW() - INTERVAL '30 days' THEN 10
    ELSE 0
  END;

  v_frequency_score := CASE
    WHEN v_message_count >= 50 THEN 30
    WHEN v_message_count >= 20 THEN 25
    WHEN v_message_count >= 10 THEN 20
    WHEN v_message_count >= 5 THEN 15
    WHEN v_message_count >= 1 THEN 10
    ELSE 0
  END;

  v_responsiveness_score := ROUND(v_response_rate * 0.30, 2);

  UPDATE public.contacts
  SET
    message_count = v_message_count,
    first_seen_at = LEAST(
      first_seen_at,
      COALESCE(v_first_message_at, first_seen_at)
    ),
    last_message_at = v_last_message_at,
    last_contacted_at = v_last_contacted_at,
    response_rate = v_response_rate,
    avg_response_time = CASE
      WHEN v_avg_response_time IS NULL THEN NULL
      ELSE GREATEST(0, ROUND(v_avg_response_time)::INTEGER)
    END,
    engagement_score = LEAST(
      100,
      v_recency_score + v_frequency_score + v_responsiveness_score
    )
  WHERE id = p_contact_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_contact_engagement_from_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
  v_contact_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_conversation_id := OLD.conversation_id;
  ELSE
    v_conversation_id := NEW.conversation_id;
  END IF;

  SELECT contact_id
  INTO v_contact_id
  FROM public.conversations
  WHERE id = v_conversation_id;

  IF v_contact_id IS NOT NULL THEN
    -- Two messages for the same contact may arrive concurrently. Serialize
    -- their refreshes until transaction end so the waiter recalculates from
    -- the committed history instead of overwriting with an older snapshot.
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_contact_id::TEXT, 0)
    );
    PERFORM public.recalculate_contact_engagement(v_contact_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_contact_engagement_on_message
  ON public.messages;

CREATE TRIGGER refresh_contact_engagement_on_message
  AFTER INSERT OR DELETE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_contact_engagement_from_message();

REVOKE ALL ON FUNCTION public.recalculate_contact_engagement(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_contact_engagement(UUID)
  TO service_role;

REVOKE ALL ON FUNCTION public.refresh_contact_engagement_from_message()
  FROM PUBLIC, anon, authenticated;

-- Backfill existing history once. Subsequent changes are handled by the
-- trigger above. This loop is intentionally account-agnostic because it
-- runs as a migration and the function still scopes each query by contact.
DO $$
DECLARE
  contact_row RECORD;
BEGIN
  FOR contact_row IN SELECT id FROM public.contacts LOOP
    PERFORM public.recalculate_contact_engagement(contact_row.id);
  END LOOP;
END $$;
