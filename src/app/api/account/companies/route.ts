import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  isPostgresUniqueViolation,
  parseCreateCompanyInput,
} from '@/lib/companies/validation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const COMPANY_COLUMNS =
  'id, account_id, name, industry, website, phone, notes, created_by, created_at, updated_at';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('companies')
      .select(COMPANY_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('name', { ascending: true });

    if (error) {
      console.error('[GET /api/account/companies] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load companies' },
        { status: 500 }
      );
    }

    return NextResponse.json({ companies: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `admin:companyCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const parsed = parseCreateCompanyInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('companies')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        ...parsed.value,
      })
      .select(COMPANY_COLUMNS)
      .single();

    if (error || !data) {
      if (isPostgresUniqueViolation(error)) {
        return NextResponse.json(
          { error: 'A company with this name already exists' },
          { status: 409 }
        );
      }

      console.error('[POST /api/account/companies] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create company' },
        { status: 500 }
      );
    }

    return NextResponse.json({ company: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
