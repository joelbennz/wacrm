// ============================================================
// POST /api/v1/deals — create a deal (scope: deals:write)
//
// Create-only for now — see src/lib/api/v1/deals.ts for why. Typical
// caller: an external system's payment-confirmed webhook, recording a
// won sale against a contact already synced via POST /api/v1/contacts.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { createDeal, DealError } from '@/lib/api/v1/deals';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { isUuid } from '@/lib/operations/validation';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const contactId = typeof body.contactId === 'string' ? body.contactId : '';
    if (!contactId || !isUuid(contactId)) {
      return fail('bad_request', "'contactId' must be a UUID", 400);
    }

    const pipelineId = typeof body.pipelineId === 'string' ? body.pipelineId : '';
    if (!pipelineId || !isUuid(pipelineId)) {
      return fail('bad_request', "'pipelineId' must be a UUID", 400);
    }

    const stageId = typeof body.stageId === 'string' ? body.stageId : undefined;
    if (stageId && !isUuid(stageId)) {
      return fail('bad_request', "'stageId' must be a UUID", 400);
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return fail('bad_request', "'title' is required", 400);
    }

    const value = typeof body.value === 'number' ? body.value : NaN;
    if (!Number.isFinite(value) || value < 0) {
      return fail('bad_request', "'value' must be a non-negative number", 400);
    }

    const currency = typeof body.currency === 'string' ? body.currency : undefined;
    const status = typeof body.status === 'string' ? body.status : undefined;
    const notes = typeof body.notes === 'string' ? body.notes : undefined;

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const deal = await createDeal(ctx.supabase, ctx.accountId, auditUserId, {
      contactId,
      pipelineId,
      stageId,
      title,
      value,
      currency,
      status,
      notes,
    });

    return ok(deal, 201);
  } catch (err) {
    if (err instanceof DealError) {
      return fail(
        err.status === 404 ? 'not_found' : 'bad_request',
        err.message,
        err.status
      );
    }
    return toApiErrorResponse(err);
  }
}
