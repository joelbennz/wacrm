import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  isPostgresUniqueViolation,
  parseCreateOperationInput,
} from '@/lib/operations/validation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const OPERATION_COLUMNS =
  'id, account_id, name, color, is_active, created_by, created_at, updated_at';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('operations')
      .select(OPERATION_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('is_active', { ascending: false })
      .order('name', { ascending: true });

    if (error) {
      console.error('[GET /api/account/operations] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load operations' },
        { status: 500 }
      );
    }

    return NextResponse.json({ operations: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:operationCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const parsed = parseCreateOperationInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('operations')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        ...parsed.value,
      })
      .select(OPERATION_COLUMNS)
      .single();

    if (error || !data) {
      if (isPostgresUniqueViolation(error)) {
        return NextResponse.json(
          { error: 'An operation with this name already exists' },
          { status: 409 }
        );
      }

      console.error('[POST /api/account/operations] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create operation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ operation: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
