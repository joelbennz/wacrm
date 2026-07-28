import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { isUuid } from '@/lib/operations/validation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

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
      `agent:commandCenterEvent:${ctx.userId}`,
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

    const eventName = cleanString(body.eventName);
    if (!eventName) {
      return NextResponse.json(
        { error: 'Nome do evento é obrigatório' },
        { status: 400 }
      );
    }
    if (eventName.length > 120) {
      return NextResponse.json(
        { error: 'Nome do evento deve ter até 120 caracteres' },
        { status: 400 }
      );
    }

    const eventType = cleanString(body.eventType) ?? 'note';
    if (!EVENT_TYPES.has(eventType)) {
      return NextResponse.json(
        { error: 'Tipo de evento inválido' },
        { status: 400 }
      );
    }

    const value =
      typeof body.value === 'number' && Number.isFinite(body.value)
        ? body.value
        : null;
    const currency =
      cleanString(body.currency)?.toUpperCase() ?? (value ? 'AOA' : null);

    const { data: operation, error: operationError } = await ctx.supabase
      .from('operations')
      .select('id')
      .eq('id', operationId)
      .eq('account_id', ctx.accountId)
      .neq('status', 'archived')
      .maybeSingle();

    if (operationError) {
      console.error(
        '[POST /api/account/command-center/events] operation lookup error:',
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

    const { data, error } = await ctx.supabase
      .from('project_events')
      .insert({
        account_id: ctx.accountId,
        operation_id: operationId,
        event_type: eventType,
        event_name: eventName,
        value,
        currency,
        occurred_at: parseOccurredAt(body.occurredAt),
        payload: {
          ...parsePayload(body.payload),
          manual_entry: true,
          created_from: 'command_center',
        },
      })
      .select(
        'id, operation_id, event_type, event_name, value, currency, occurred_at, created_at'
      )
      .single();

    if (error || !data) {
      console.error(
        '[POST /api/account/command-center/events] insert error:',
        error
      );
      return NextResponse.json(
        { error: 'Falha ao guardar evento' },
        { status: 500 }
      );
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
