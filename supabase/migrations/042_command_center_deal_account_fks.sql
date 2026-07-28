-- ============================================================
-- 042_command_center_deal_account_fks.sql
--
-- Hardens command-center ledgers so deal references are scoped to
-- the same account as the event/transaction row.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deals_id_account_id_key'
      AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_id_account_id_key UNIQUE (id, account_id);
  END IF;
END $$;

UPDATE public.project_events pe
SET deal_id = NULL
WHERE pe.deal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.deals d
    WHERE d.id = pe.deal_id
      AND d.account_id = pe.account_id
  );

UPDATE public.financial_transactions ft
SET deal_id = NULL
WHERE ft.deal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.deals d
    WHERE d.id = ft.deal_id
      AND d.account_id = ft.account_id
  );

ALTER TABLE public.project_events
  DROP CONSTRAINT IF EXISTS project_events_deal_fkey,
  ADD CONSTRAINT project_events_deal_account_fkey
    FOREIGN KEY (deal_id, account_id)
    REFERENCES public.deals(id, account_id)
    ON DELETE SET NULL (deal_id);

ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_deal_fkey,
  ADD CONSTRAINT financial_transactions_deal_account_fkey
    FOREIGN KEY (deal_id, account_id)
    REFERENCES public.deals(id, account_id)
    ON DELETE SET NULL (deal_id);
