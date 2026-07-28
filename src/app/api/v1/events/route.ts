import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  AccountReferenceError,
  assertAccountReferences,
} from '@/lib/api/v1/account-references';
import { isUuid } from '@/lib/operations/validation';

const EVENT_TYPES = new Set([
  'lead',
  'signup',
  'activation',
  'message',
  'payment',
  'subscription',
  'refund',
  'expense',
  'campaign',
  'product_usage',
  'note',
  'system',
  'other',
]);

function optionalUuid(value: unknown, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new Error(`'${field}' must be a UUID`);
  }
  return value;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'events:write');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const eventType =
      typeof body.eventType === 'string' ? body.eventType : 'other';
    if (!EVENT_TYPES.has(eventType)) {
      return fail('bad_request', "'eventType' is invalid", 400);
    }

    const eventName =
      typeof body.eventName === 'string' ? body.eventName.trim() : '';
    if (!eventName) return fail('bad_request', "'eventName' is required", 400);

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

    const payload =
      body.payload &&
      typeof body.payload === 'object' &&
      !Array.isArray(body.payload)
        ? body.payload
        : {};
    const value =
      typeof body.value === 'number' && Number.isFinite(body.value)
        ? body.value
        : null;
    const currency =
      typeof body.currency === 'string'
        ? body.currency.trim().toUpperCase()
        : null;
    const occurredAt =
      typeof body.occurredAt === 'string'
        ? body.occurredAt
        : new Date().toISOString();
    const externalId =
      typeof body.externalId === 'string'
        ? body.externalId.trim() || null
        : null;

    const { data, error } = await ctx.supabase
      .from('project_events')
      .insert({
        account_id: ctx.accountId,
        operation_id: operationId,
        source_id: sourceId,
        contact_id: contactId,
        deal_id: dealId,
        event_type: eventType,
        event_name: eventName,
        external_id: externalId,
        value,
        currency,
        occurred_at: occurredAt,
        payload,
      })
      .select(
        'id, operation_id, source_id, contact_id, deal_id, event_type, event_name, external_id, value, currency, occurred_at, created_at'
      )
      .single();

    if (error || !data) {
      console.error('[api/v1/events] insert error:', error);
      return fail('internal', 'Failed to record event', 500);
    }

    return ok(data, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
