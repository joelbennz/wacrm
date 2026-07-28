// ============================================================
// Shared deal-creation logic for the public API (v1) deals endpoint.
//
// Deliberately create-only for now: external integrations (e.g. a
// payment webhook confirming a sale) need to record a deal, not manage
// a full pipeline lifecycle from outside the CRM. Read/update/list can
// be added the same way contacts' were, once a real caller needs them.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export const DEAL_SELECT =
  'id, account_id, pipeline_id, stage_id, contact_id, title, value, currency, status, notes, created_at, updated_at';

export interface ApiDeal {
  id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string;
  title: string;
  value: number;
  currency: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export class DealError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DealError';
    this.status = status;
  }
}

export function serializeDeal(row: Record<string, unknown>): ApiDeal {
  return {
    id: row.id as string,
    pipeline_id: row.pipeline_id as string,
    stage_id: row.stage_id as string,
    contact_id: row.contact_id as string,
    title: row.title as string,
    value: Number(row.value) || 0,
    currency: (row.currency as string) ?? 'USD',
    status: row.status as string,
    notes: (row.notes as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export interface CreateDealInput {
  contactId: string;
  pipelineId: string;
  /** Omit to use the pipeline's first stage (lowest `position`). */
  stageId?: string;
  title: string;
  value: number;
  currency?: string;
  /** Defaults to 'open'. Pass 'won' to record an already-closed sale
   *  (e.g. a payment-confirmed webhook). */
  status?: string;
  notes?: string;
}

/**
 * Create a deal on behalf of an API-key caller. Validates that the
 * contact and pipeline belong to the caller's account (the service-role
 * client used by `requireApiKey` bypasses RLS, so this check is the
 * only tenant boundary on this path) and resolves a default stage when
 * none is given.
 */
export async function createDeal(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: CreateDealInput
): Promise<ApiDeal> {
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id')
    .eq('id', input.contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (contactErr || !contact) {
    throw new DealError('Contact not found for this account', 404);
  }

  const { data: pipeline, error: pipelineErr } = await db
    .from('pipelines')
    .select('id')
    .eq('id', input.pipelineId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (pipelineErr || !pipeline) {
    throw new DealError('Pipeline not found for this account', 404);
  }

  let stageId = input.stageId;
  if (stageId) {
    const { data: stage, error: stageErr } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('id', stageId)
      .eq('pipeline_id', input.pipelineId)
      .maybeSingle();
    if (stageErr || !stage) {
      throw new DealError('Stage not found in this pipeline', 404);
    }
  } else {
    const { data: firstStage, error: firstStageErr } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', input.pipelineId)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstStageErr || !firstStage) {
      throw new DealError('Pipeline has no stages', 409);
    }
    stageId = firstStage.id as string;
  }

  const { data, error } = await db
    .from('deals')
    .insert({
      account_id: accountId,
      user_id: userId,
      pipeline_id: input.pipelineId,
      stage_id: stageId,
      contact_id: input.contactId,
      title: input.title,
      value: input.value,
      currency: input.currency ?? 'USD',
      status: input.status ?? 'open',
      notes: input.notes ?? null,
    })
    .select(DEAL_SELECT)
    .single();

  if (error || !data) {
    throw new DealError('Failed to create deal', 500);
  }

  return serializeDeal(data as Record<string, unknown>);
}
