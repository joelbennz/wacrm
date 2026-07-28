import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  isPostgresUniqueViolation,
  isUuid,
  parsePatchOperationInput,
} from '@/lib/operations/validation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const OPERATION_COLUMNS =
  'id, account_id, name, color, is_active, created_by, created_at, updated_at';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:operationUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json(
        { error: 'Operation not found' },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = parsePatchOperationInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('operations')
      .update(parsed.value)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(OPERATION_COLUMNS)
      .maybeSingle();

    if (error) {
      if (isPostgresUniqueViolation(error)) {
        return NextResponse.json(
          { error: 'An operation with this name already exists' },
          { status: 409 }
        );
      }

      console.error(
        '[PATCH /api/account/operations/[id]] update error:',
        error
      );
      return NextResponse.json(
        { error: 'Failed to update operation' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Operation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ operation: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
