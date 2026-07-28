import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/operations/validation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const KINDS = new Set(['revenue', 'expense', 'refund', 'payout', 'adjustment']);

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOccurredAt(value: unknown): string {
  if (typeof value !== 'string' || !value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `agent:commandCenterFinance:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }

    const operationId = cleanString(body.operationId);
    if (!operationId || !isUuid(operationId)) {
      return NextResponse.json({ error: 'Projeto inválido' }, { status: 400 });
    }

    const kind = cleanString(body.kind) ?? 'revenue';
    if (!KINDS.has(kind)) {
      return NextResponse.json(
        { error: 'Tipo financeiro inválido' },
        { status: 400 }
      );
    }

    const amount = typeof body.amount === 'number' ? body.amount : NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'Valor deve ser positivo' },
        { status: 400 }
      );
    }

    const description = cleanString(body.description);
    if (!description) {
      return NextResponse.json(
        { error: 'Descrição é obrigatória' },
        { status: 400 }
      );
    }
    if (description.length > 180) {
      return NextResponse.json(
        { error: 'Descrição deve ter até 180 caracteres' },
        { status: 400 }
      );
    }

    const currency = cleanString(body.currency)?.toUpperCase() ?? 'AOA';

    const { data: operation, error: operationError } = await ctx.supabase
      .from('operations')
      .select('id')
      .eq('id', operationId)
      .eq('account_id', ctx.accountId)
      .neq('status', 'archived')
      .maybeSingle();

    if (operationError) {
      console.error(
        '[POST /api/account/command-center/finance] operation lookup error:',
        operationError
      );
      return NextResponse.json(
        { error: 'Falha ao validar projeto' },
        { status: 500 }
      );
    }
    if (!operation) {
      return NextResponse.json(
        { error: 'Projeto não encontrado' },
        { status: 404 }
      );
    }

    const occurredAt = parseOccurredAt(body.occurredAt);
    const payload = {
      ...parsePayload(body.payload),
      manual_entry: true,
      created_from: 'command_center',
    };

    const { data, error } = await ctx.supabase
      .from('financial_transactions')
      .insert({
        account_id: ctx.accountId,
        operation_id: operationId,
        kind,
        status: 'confirmed',
        amount,
        currency,
        description,
        occurred_at: occurredAt,
        payload,
      })
      .select(
        'id, operation_id, kind, status, amount, currency, description, occurred_at, created_at'
      )
      .single();

    if (error || !data) {
      console.error(
        '[POST /api/account/command-center/finance] insert error:',
        error
      );
      return NextResponse.json(
        { error: 'Falha ao guardar lançamento' },
        { status: 500 }
      );
    }

    if (kind === 'revenue') {
      await ctx.supabase.from('project_events').insert({
        account_id: ctx.accountId,
        operation_id: operationId,
        event_type: 'payment',
        event_name: description,
        value: amount,
        currency,
        occurred_at: occurredAt,
        payload: {
          financial_transaction_id: data.id,
          manual_entry: true,
          created_from: 'command_center_finance',
        },
      });
    }

    return NextResponse.json({ transaction: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
