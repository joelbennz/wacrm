-- ============================================================
-- 040_companies.sql
--
-- Introduces account-scoped companies. A contact optionally belongs to
-- one company (contacts.company_id) — the existing free-text
-- contacts.company column is left untouched for backward compatibility
-- (existing rows, CSV import, the public API) and simply takes a back
-- seat once a contact is linked to a real company record.
--
-- Mirrors the tenant-isolation pattern from 039_operations_and_contact_sources.sql:
--   1. RLS gates every row by account membership and role;
--   2. a composite FK on (id, account_id) makes the contacts.company_id
--      link tenant-safe even from privileged server-side writes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  phone TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT companies_id_account_id_key UNIQUE (id, account_id),
  CONSTRAINT companies_name_valid CHECK (
    name = btrim(name)
    AND char_length(name) BETWEEN 1 AND 160
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_account_name_ci
  ON public.companies (account_id, lower(name));

DROP TRIGGER IF EXISTS set_updated_at ON public.companies;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_select ON public.companies;
DROP POLICY IF EXISTS companies_insert ON public.companies;
DROP POLICY IF EXISTS companies_update ON public.companies;
DROP POLICY IF EXISTS companies_delete ON public.companies;

CREATE POLICY companies_select ON public.companies FOR SELECT
  USING (public.is_account_member(account_id));

CREATE POLICY companies_insert ON public.companies FOR INSERT
  WITH CHECK (
    public.is_account_member(account_id, 'agent')
    AND (created_by IS NULL OR created_by = auth.uid())
  );

CREATE POLICY companies_update ON public.companies FOR UPDATE
  USING (public.is_account_member(account_id, 'agent'))
  WITH CHECK (public.is_account_member(account_id, 'agent'));

CREATE POLICY companies_delete ON public.companies FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

REVOKE ALL ON TABLE public.companies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.companies TO authenticated;
GRANT INSERT (account_id, name, industry, website, phone, notes, created_by)
  ON TABLE public.companies TO authenticated;
GRANT UPDATE (name, industry, website, phone, notes)
  ON TABLE public.companies TO authenticated;
GRANT DELETE ON TABLE public.companies TO authenticated;
GRANT ALL ON TABLE public.companies TO service_role;

-- ============================================================
-- CONTACTS.COMPANY_ID
-- ============================================================
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS company_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contacts_company_account_fkey'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_company_account_fkey
      FOREIGN KEY (company_id, account_id)
      REFERENCES public.companies(id, account_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_company_id
  ON public.contacts (company_id)
  WHERE company_id IS NOT NULL;

GRANT UPDATE (company_id) ON TABLE public.contacts TO authenticated;

-- ============================================================
-- REALTIME
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'companies'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.companies;
    END IF;
  END IF;
END $$;

COMMENT ON TABLE public.companies IS
  'Account-scoped companies. A contact optionally belongs to one via contacts.company_id.';
