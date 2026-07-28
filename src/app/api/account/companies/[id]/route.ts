import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  isPostgresUniqueViolation,
  isUuid,
  parsePatchCompanyInput,
} from '@/lib/companies/validation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const COMPANY_COLUMNS =
  'id, account_id, name, industry, website, phone, notes, created_by, created_at, updated_at';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `admin:companyUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const parsed = parsePatchCompanyInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('companies')
      .update(parsed.value)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(COMPANY_COLUMNS)
      .maybeSingle();

    if (error) {
      if (isPostgresUniqueViolation(error)) {
        return NextResponse.json(
          { error: 'A company with this name already exists' },
          { status: 409 }
        );
      }
      console.error('[PATCH /api/account/companies/[id]] update error:', error);
      return NextResponse.json(
        { error: 'Failed to update company' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    return NextResponse.json({ company: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:companyDelete:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    const { error, count } = await ctx.supabase
      .from('companies')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[DELETE /api/account/companies/[id]] delete error:', error);
      return NextResponse.json(
        { error: 'Failed to delete company' },
        { status: 500 }
      );
    }

    if (!count) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
