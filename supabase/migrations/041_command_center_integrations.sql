-- ============================================================
-- 041_command_center_integrations.sql
--
-- Turns operations into the CRM's central project layer and adds the
-- integration/event/finance ledger needed to plug every Joel project
-- (SaaS, infoproduct, client work, campaigns, WhatsApp, payments,
-- Obsidian notes) into one command center.
-- ============================================================

-- ------------------------------------------------------------
-- Enrich operations: one row = one project/operation in the business.
-- ------------------------------------------------------------
ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS project_type TEXT NOT NULL DEFAULT 'project',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS revenue_model TEXT,
  ADD COLUMN IF NOT EXISTS obsidian_path TEXT,
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS repository_url TEXT,
  ADD COLUMN IF NOT EXISTS monthly_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS target_monthly_revenue NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operations_project_type_valid'
      AND conrelid = 'public.operations'::regclass
  ) THEN
    ALTER TABLE public.operations
      ADD CONSTRAINT operations_project_type_valid CHECK (
        project_type IN ('saas', 'infoproduct', 'client', 'agency', 'campaign', 'internal', 'project')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operations_status_valid'
      AND conrelid = 'public.operations'::regclass
  ) THEN
    ALTER TABLE public.operations
      ADD CONSTRAINT operations_status_valid CHECK (
        status IN ('idea', 'building', 'active', 'paused', 'archived')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_operations_account_status
  ON public.operations (account_id, status, name);

CREATE INDEX IF NOT EXISTS idx_operations_obsidian_path
  ON public.operations (account_id, obsidian_path)
  WHERE obsidian_path IS NOT NULL;

GRANT UPDATE (
  project_type,
  status,
  revenue_model,
  obsidian_path,
  website_url,
  repository_url,
  monthly_cost,
  target_monthly_revenue,
  metadata
) ON TABLE public.operations TO authenticated;

-- ------------------------------------------------------------
-- Integration sources: connectors attached to a project.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  operation_id UUID,
  provider TEXT NOT NULL,
  name TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  sync_direction TEXT NOT NULL DEFAULT 'inbound',
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT integration_sources_id_account_id_key UNIQUE (id, account_id),
  CONSTRAINT integration_sources_operation_account_fkey
    FOREIGN KEY (operation_id, account_id)
    REFERENCES public.operations(id, account_id)
    ON DELETE CASCADE,
  CONSTRAINT integration_sources_provider_valid CHECK (
    provider IN ('obsidian', 'meta', 'whatsapp', 'instagram', 'facebook_ads', 'google_analytics', 'google_search_console', 'stripe', 'paypal', 'multicaixa', 'manual', 'saas_api', 'webhook', 'github', 'other')
  ),
  CONSTRAINT integration_sources_status_valid CHECK (
    status IN ('planned', 'needs_credentials', 'connected', 'syncing', 'error', 'disabled')
  ),
  CONSTRAINT integration_sources_direction_valid CHECK (
    sync_direction IN ('inbound', 'outbound', 'bidirectional')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_sources_unique_external
  ON public.integration_sources (account_id, provider, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integration_sources_account_operation
  ON public.integration_sources (account_id, operation_id, provider);

DROP TRIGGER IF EXISTS set_updated_at ON public.integration_sources;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.integration_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- Project events: normalized activity ledger from every source.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  operation_id UUID,
  source_id UUID,
  contact_id UUID,
  deal_id UUID,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  external_id TEXT,
  value NUMERIC(14,2),
  currency TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT project_events_operation_account_fkey
    FOREIGN KEY (operation_id, account_id)
    REFERENCES public.operations(id, account_id)
    ON DELETE SET NULL,
  CONSTRAINT project_events_source_account_fkey
    FOREIGN KEY (source_id, account_id)
    REFERENCES public.integration_sources(id, account_id)
    ON DELETE SET NULL,
  CONSTRAINT project_events_contact_account_fkey
    FOREIGN KEY (contact_id, account_id)
    REFERENCES public.contacts(id, account_id)
    ON DELETE SET NULL,
  CONSTRAINT project_events_deal_fkey
    FOREIGN KEY (deal_id)
    REFERENCES public.deals(id)
    ON DELETE SET NULL,
  CONSTRAINT project_events_type_valid CHECK (
    event_type IN ('lead', 'signup', 'activation', 'message', 'payment', 'subscription', 'refund', 'expense', 'campaign', 'product_usage', 'note', 'system', 'other')
  )
);

CREATE INDEX IF NOT EXISTS idx_project_events_account_occurred
  ON public.project_events (account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_events_operation_occurred
  ON public.project_events (operation_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_events_source_external
  ON public.project_events (source_id, external_id)
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL;

-- ------------------------------------------------------------
-- Financial ledger: revenue/expense truth by project.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  operation_id UUID,
  source_id UUID,
  contact_id UUID,
  deal_id UUID,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'AOA',
  description TEXT,
  external_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT financial_transactions_operation_account_fkey
    FOREIGN KEY (operation_id, account_id)
    REFERENCES public.operations(id, account_id)
    ON DELETE SET NULL,
  CONSTRAINT financial_transactions_source_account_fkey
    FOREIGN KEY (source_id, account_id)
    REFERENCES public.integration_sources(id, account_id)
    ON DELETE SET NULL,
  CONSTRAINT financial_transactions_contact_account_fkey
    FOREIGN KEY (contact_id, account_id)
    REFERENCES public.contacts(id, account_id)
    ON DELETE SET NULL,
  CONSTRAINT financial_transactions_deal_fkey
    FOREIGN KEY (deal_id)
    REFERENCES public.deals(id)
    ON DELETE SET NULL,
  CONSTRAINT financial_transactions_kind_valid CHECK (
    kind IN ('revenue', 'expense', 'refund', 'payout', 'adjustment')
  ),
  CONSTRAINT financial_transactions_status_valid CHECK (
    status IN ('pending', 'confirmed', 'failed', 'cancelled')
  ),
  CONSTRAINT financial_transactions_amount_nonzero CHECK (amount <> 0)
);

CREATE INDEX IF NOT EXISTS idx_financial_transactions_account_occurred
  ON public.financial_transactions (account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_operation_occurred
  ON public.financial_transactions (operation_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_transactions_source_external
  ON public.financial_transactions (source_id, external_id)
  WHERE source_id IS NOT NULL AND external_id IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.financial_transactions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.financial_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- Rollup views for dashboards. RLS on base tables still applies.
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.project_financial_summary
WITH (security_invoker = true) AS
SELECT
  o.account_id,
  o.id AS operation_id,
  o.name,
  o.project_type,
  o.status,
  o.obsidian_path,
  o.monthly_cost,
  COALESCE(SUM(CASE WHEN ft.kind = 'revenue' AND ft.status = 'confirmed' THEN ft.amount ELSE 0 END), 0) AS revenue_total,
  COALESCE(SUM(CASE WHEN ft.kind = 'expense' AND ft.status = 'confirmed' THEN ABS(ft.amount) ELSE 0 END), 0) AS expense_total,
  COALESCE(SUM(CASE WHEN ft.kind = 'refund' AND ft.status = 'confirmed' THEN ABS(ft.amount) ELSE 0 END), 0) AS refund_total,
  COALESCE(SUM(CASE WHEN ft.status = 'confirmed' THEN
    CASE
      WHEN ft.kind = 'revenue' THEN ft.amount
      WHEN ft.kind IN ('expense', 'refund') THEN -ABS(ft.amount)
      WHEN ft.kind = 'payout' THEN ft.amount
      ELSE ft.amount
    END
  ELSE 0 END), 0) AS net_total,
  MAX(ft.occurred_at) AS last_financial_at
FROM public.operations o
LEFT JOIN public.financial_transactions ft
  ON ft.operation_id = o.id
 AND ft.account_id = o.account_id
GROUP BY o.account_id, o.id, o.name, o.project_type, o.status, o.obsidian_path, o.monthly_cost;

CREATE OR REPLACE VIEW public.project_event_summary
WITH (security_invoker = true) AS
SELECT
  o.account_id,
  o.id AS operation_id,
  COUNT(pe.id) AS events_total,
  COUNT(pe.id) FILTER (WHERE pe.event_type = 'lead') AS leads_total,
  COUNT(pe.id) FILTER (WHERE pe.event_type = 'signup') AS signups_total,
  COUNT(pe.id) FILTER (WHERE pe.event_type = 'payment') AS payments_total,
  MAX(pe.occurred_at) AS last_event_at
FROM public.operations o
LEFT JOIN public.project_events pe
  ON pe.operation_id = o.id
 AND pe.account_id = o.account_id
GROUP BY o.account_id, o.id;

-- ------------------------------------------------------------
-- RLS + privileges
-- ------------------------------------------------------------
ALTER TABLE public.integration_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_sources_select ON public.integration_sources;
DROP POLICY IF EXISTS integration_sources_insert ON public.integration_sources;
DROP POLICY IF EXISTS integration_sources_update ON public.integration_sources;
DROP POLICY IF EXISTS integration_sources_delete ON public.integration_sources;
CREATE POLICY integration_sources_select ON public.integration_sources FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY integration_sources_insert ON public.integration_sources FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY integration_sources_update ON public.integration_sources FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY integration_sources_delete ON public.integration_sources FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS project_events_select ON public.project_events;
DROP POLICY IF EXISTS project_events_insert ON public.project_events;
DROP POLICY IF EXISTS project_events_update ON public.project_events;
DROP POLICY IF EXISTS project_events_delete ON public.project_events;
CREATE POLICY project_events_select ON public.project_events FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY project_events_insert ON public.project_events FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY project_events_update ON public.project_events FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY project_events_delete ON public.project_events FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS financial_transactions_select ON public.financial_transactions;
DROP POLICY IF EXISTS financial_transactions_insert ON public.financial_transactions;
DROP POLICY IF EXISTS financial_transactions_update ON public.financial_transactions;
DROP POLICY IF EXISTS financial_transactions_delete ON public.financial_transactions;
CREATE POLICY financial_transactions_select ON public.financial_transactions FOR SELECT
  USING (public.is_account_member(account_id));
CREATE POLICY financial_transactions_insert ON public.financial_transactions FOR INSERT
  WITH CHECK (public.is_account_member(account_id, 'agent'));
CREATE POLICY financial_transactions_update ON public.financial_transactions FOR UPDATE
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY financial_transactions_delete ON public.financial_transactions FOR DELETE
  USING (public.is_account_member(account_id, 'admin'));

REVOKE ALL ON TABLE public.integration_sources, public.project_events, public.financial_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.integration_sources, public.project_events, public.financial_transactions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.integration_sources TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.project_events TO authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.financial_transactions TO authenticated;
GRANT ALL ON TABLE public.integration_sources, public.project_events, public.financial_transactions TO service_role;
GRANT SELECT ON public.project_financial_summary, public.project_event_summary TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'integration_sources'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.integration_sources;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'project_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.project_events;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'financial_transactions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_transactions;
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN public.operations.obsidian_path IS 'Vault-relative path of the Obsidian note that describes this project.';
COMMENT ON TABLE public.integration_sources IS 'Account/project connector registry: Meta, Obsidian, SaaS APIs, finance providers, webhooks.';
COMMENT ON TABLE public.project_events IS 'Normalized event ledger from every project/source feeding the command center.';
COMMENT ON TABLE public.financial_transactions IS 'Financial ledger by project/source for revenue, expense, refund and payout tracking.';
