import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  AccountReferenceError,
  assertAccountReferences,
} from '@/lib/api/v1/account-references';
import { isUuid } from '@/lib/operations/validation';

const KINDS = new Set(['revenue', 'expense', 'refund', 'payout', 'adjustment']);
const STATUSES = new Set(['pending', 'confirmed', 'failed', 'cancelled']);

function optionalUuid(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new Error(`'${field}' must be a UUID`);
  }
  return value;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'finance:write');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const kind = typeof body.kind === 'string' ? body.kind : 'revenue';
    if (!KINDS.has(kind)) return fail('bad_request', "'kind' is invalid", 400);

    const status = typeof body.status === 'string' ? body.status : 'confirmed';
    if (!STATUSES.has(status))
      return fail('bad_request', "'status' is invalid", 400);

    const amount = typeof body.amount === 'number' ? body.amount : NaN;
    if (!Number.isFinite(amount) || amount === 0) {
      return fail('bad_request', "'amount' must be a non-zero number", 400);
    }

    let operationId: string | null;
    let sourceId: string | null;
    let contactId: string | null;
    let dealId: string | null;
    try {
      operationId = optionalUuid(body.operationId, 'operationId');
      sourceId = optionalUuid(body.sourceId, 'sourceId');
      contactId = optionalUuid(body.contactId, 'contactId');
      dealId = optionalUuid(body.dealId, 'dealId');
    } catch (err) {
      return fail(
        'bad_request',
        err instanceof Error ? err.message : 'Invalid UUID',
        400
      );
    }

    try {
      await assertAccountReferences(ctx.supabase, ctx.accountId, {
        operationId,
        sourceId,
        contactId,
        dealId,
      });
    } catch (err) {
      if (err instanceof AccountReferenceError) {
        return fail('bad_request', err.message, err.status);
      }
      throw err;
    }

    const currency =
      typeof body.currency === 'string'
        ? body.currency.trim().toUpperCase()
        : 'AOA';
    const description =
      typeof body.description === 'string'
        ? body.description.trim() || null
        : null;
    const externalId =
      typeof body.externalId === 'string'
        ? body.externalId.trim() || null
        : null;
    const occurredAt =
      typeof body.occurredAt === 'string'
        ? body.occurredAt
        : new Date().toISOString();
    const payload =
      body.payload &&
      typeof body.payload === 'object' &&
      !Array.isArray(body.payload)
        ? body.payload
        : {};

    const { data, error } = await ctx.supabase
      .from('financial_transactions')
      .insert({
        account_id: ctx.accountId,
        operation_id: operationId,
        source_id: sourceId,
        contact_id: contactId,
        deal_id: dealId,
        kind,
        status,
        amount,
        currency,
        description,
        external_id: externalId,
        occurred_at: occurredAt,
        payload,
      })
      .select(
        'id, operation_id, source_id, contact_id, deal_id, kind, status, amount, currency, description, external_id, occurred_at, created_at'
      )
      .single();

    if (error || !data) {
      console.error('[api/v1/finance] insert error:', error);
      return fail('internal', 'Failed to record financial transaction', 500);
    }

    if (kind === 'revenue' && status === 'confirmed') {
      await ctx.supabase.from('project_events').insert({
        account_id: ctx.accountId,
        operation_id: operationId,
        source_id: sourceId,
        contact_id: contactId,
        deal_id: dealId,
        event_type: 'payment',
        event_name: description ?? 'Payment confirmed',
        external_id: externalId ? `payment:${externalId}` : null,
        value: amount,
        currency,
        occurred_at: occurredAt,
        payload: { financial_transaction_id: data.id },
      });
    }

    return ok(data, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
