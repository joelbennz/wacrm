-- ============================================================
-- 039_operations_and_contact_sources.sql
--
-- Introduces account-scoped operations (the CRM/project a contact came
-- from) and the many-to-many links between contacts and operations.
--
-- A contact remains the account-wide identity (deduplicated by phone by
-- migration 022). contact_operations records every project in which that
-- identity appears, including an optional project-local external id. This
-- supports CSV/manual ingestion now and API/event ingestion later without
-- duplicating the contact.
--
-- Tenant isolation is enforced twice:
--   1. RLS gates every row by account membership and role;
--   2. composite foreign keys require the contact, operation and link to
--      carry the same account_id, preventing cross-account relationships
--      even in privileged server-side writes.
--
-- Idempotent: tables/indexes use IF NOT EXISTS, policies and triggers are
-- replaced, constraints/publication membership are guarded explicitly.
-- ============================================================

-- Foreign-key target for (contact_id, account_id). contacts.id is already
-- globally unique, but PostgreSQL needs a matching composite unique key for
-- the tenant-safe foreign key declared on contact_operations below.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contacts_id_account_id_key'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_id_account_id_key UNIQUE (id, account_id);
  END IF;
END $$;

-- ============================================================
-- OPERATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT operations_id_account_id_key UNIQUE (id, account_id),
  CONSTRAINT operations_name_valid CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 80
  ),
  CONSTRAINT operations_color_valid CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- Operation names are unique per account, case-insensitively. Archiving is
-- deliberately not part of this key: an archived operation keeps its stable
-- identity and cannot silently be replaced by a different row with the same
-- human-facing name.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operations_account_name_ci
  ON public.operations (account_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_operations_account_active
  ON public.operations (account_id, name)
  WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS set_updated_at ON public.operations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.operations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- CONTACT_OPERATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.contact_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  operation_id UUID NOT NULL,
  external_id TEXT,
  ingestion_method TEXT NOT NULL DEFAULT 'manual',
  linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT contact_operations_contact_account_fkey
    FOREIGN KEY (contact_id, account_id)
    REFERENCES public.contacts(id, account_id)
    ON DELETE CASCADE,
  CONSTRAINT contact_operations_operation_account_fkey
    FOREIGN KEY (operation_id, account_id)
    REFERENCES public.operations(id, account_id)
    ON DELETE CASCADE,
  CONSTRAINT contact_operations_contact_operation_key
    UNIQUE (contact_id, operation_id),
  CONSTRAINT contact_operations_external_id_valid CHECK (
    external_id IS NULL
    OR (
      external_id = btrim(external_id)
      AND char_length(external_id) BETWEEN 1 AND 255
    )
  ),
  CONSTRAINT contact_operations_ingestion_method_valid CHECK (
    ingestion_method IN ('manual', 'csv', 'api', 'event')
  )
);

CREATE INDEX IF NOT EXISTS idx_contact_operations_account_contact
  ON public.contact_operations (account_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_operations_account_operation
  ON public.contact_operations (account_id, operation_id);

CREATE INDEX IF NOT EXISTS idx_contact_operations_operation_last_seen
  ON public.contact_operations (operation_id, last_seen_at DESC);

-- An external id identifies one contact inside one operation. NULL means the
-- source has no stable id and is intentionally excluded from uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_operations_operation_external_id
  ON public.contact_operations (operation_id, external_id)
  WHERE external_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.contact_operations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.contact_operations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Archived operations retain their historical links but cannot receive new
-- imports or have source links refreshed. Keeping this invariant in the
-- database closes the race between the API's active check and a concurrent
-- archive, and protects future direct/API ingestion paths as well.
CREATE OR REPLACE FUNCTION public.ensure_contact_operation_is_active()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.operations
    WHERE id = NEW.operation_id
      AND account_id = NEW.account_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Archived operations cannot receive contact links'
      USING ERRCODE = '23514',
            CONSTRAINT = 'contact_operations_active_operation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_contact_operation_is_active()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ensure_contact_operation_is_active
  ON public.contact_operations;
CREATE TRIGGER ensure_contact_operation_is_active
  BEFORE INSERT OR UPDATE ON public.contact_operations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_contact_operation_is_active();

-- Realtime consumers use these events as invalidation signals and refetch
-- account-scoped rows, so the primary key carried by DEFAULT identity is enough
-- (and avoids the WAL overhead of REPLICA IDENTITY FULL).
ALTER TABLE public.operations REPLICA IDENTITY DEFAULT;
ALTER TABLE public.contact_operations REPLICA IDENTITY DEFAULT;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operations_select ON public.operations;
DROP POLICY IF EXISTS operations_insert ON public.operations;
DROP POLICY IF EXISTS operations_update ON public.operations;
DROP POLICY IF EXISTS operations_delete ON public.operations;

-- Operations are settings-class data: all members may read them, while only
-- admins/owners may create, rename or archive them. There is intentionally no
-- DELETE policy; archiving preserves contact-source history.
CREATE POLICY operations_select ON public.operations FOR SELECT
  USING (public.is_account_member(account_id));

CREATE POLICY operations_insert ON public.operations FOR INSERT
  WITH CHECK (
    public.is_account_member(account_id, 'admin')
    AND (created_by IS NULL OR created_by = auth.uid())
  );

CREATE POLICY operations_update ON public.operations FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_operations_select ON public.contact_operations;
DROP POLICY IF EXISTS contact_operations_insert ON public.contact_operations;
DROP POLICY IF EXISTS contact_operations_update ON public.contact_operations;
DROP POLICY IF EXISTS contact_operations_delete ON public.contact_operations;

-- Linking a contact is operational CRM work. Viewers can inspect sources;
-- agents+ can create, refresh and remove links. Composite FKs above guarantee
-- that every referenced row belongs to the same account accepted by RLS.
CREATE POLICY contact_operations_select ON public.contact_operations FOR SELECT
  USING (public.is_account_member(account_id));

CREATE POLICY contact_operations_insert ON public.contact_operations FOR INSERT
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND (linked_by IS NULL OR linked_by = auth.uid())
  );

CREATE POLICY contact_operations_update ON public.contact_operations FOR UPDATE
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE POLICY contact_operations_delete ON public.contact_operations FOR DELETE
  USING (public.is_account_member(account_id, 'agent'));

-- Explicit privileges complement RLS and make the intended client surface
-- independent of project-wide default privileges. Anonymous access is denied;
-- authenticated users still remain constrained by the policies above.
REVOKE ALL ON TABLE public.operations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.contact_operations FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.operations TO authenticated;
GRANT INSERT (account_id, name, color, created_by)
  ON TABLE public.operations TO authenticated;
GRANT UPDATE (name, color, is_active)
  ON TABLE public.operations TO authenticated;

GRANT SELECT, DELETE ON TABLE public.contact_operations TO authenticated;
GRANT INSERT (
  account_id,
  contact_id,
  operation_id,
  external_id,
  ingestion_method,
  linked_by
)
  ON TABLE public.contact_operations TO authenticated;
GRANT UPDATE (external_id, last_seen_at)
  ON TABLE public.contact_operations TO authenticated;
GRANT ALL ON TABLE public.operations, public.contact_operations TO service_role;

-- ============================================================
-- REALTIME
-- ============================================================
DO $$
BEGIN
  -- Supabase provides this publication. The existence guard also keeps local
  -- plain-Postgres validation environments from failing unnecessarily.
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'operations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.operations;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'contact_operations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_operations;
    END IF;

    -- Contact fields and engagement metrics are updated by several paths
    -- (imports, WhatsApp and metric triggers). Publishing the canonical row
    -- lets the contacts screen converge without polling.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'contacts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;
    END IF;
  END IF;
END $$;

COMMENT ON TABLE public.operations IS
  'Account-scoped CRM projects/operations used to identify contact sources.';
COMMENT ON TABLE public.contact_operations IS
  'Tenant-safe links between a canonical contact and each operation where it appears.';
COMMENT ON COLUMN public.contact_operations.external_id IS
  'Optional stable identifier assigned to the contact by the source operation.';
COMMENT ON COLUMN public.contact_operations.ingestion_method IS
  'How the latest source link was introduced: manual, csv, api, or event.';
