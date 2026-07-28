import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { hasMinRole } from '@/lib/auth/roles';
import { isUuid } from '@/lib/operations/validation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from '@/lib/contacts/resolve-import-tags';
import {
  ContactIngestionError,
  ingestOperationContact,
  type ContactIngestionStatus,
} from '@/lib/operations/ingest-contact';

const MAX_ROWS = 500;

interface NormalizedImportRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  externalId?: string;
  tagNames: string[];
}

type NormalizedRowResult =
  | { ok: true; value: NormalizedImportRow }
  | { ok: false; error: string };

function normalizeImportRow(value: unknown): NormalizedRowResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'Row must be an object' };
  }
  const row = value as Record<string, unknown>;
  if (typeof row.phone !== 'string' || !row.phone.trim()) {
    return { ok: false, error: 'Phone is required' };
  }
  if (row.phone.length > 50) {
    return { ok: false, error: 'Phone must be 50 characters or fewer' };
  }

  const fields = [
    ['name', 200],
    ['email', 320],
    ['company', 200],
    ['externalId', 255],
  ] as const;
  const normalized: NormalizedImportRow = {
    phone: row.phone.trim(),
    tagNames: [],
  };
  for (const [field, max] of fields) {
    const raw = row[field];
    if (raw == null || raw === '') continue;
    if (typeof raw !== 'string') {
      return { ok: false, error: `${field} must be a string` };
    }
    const clean = raw.trim();
    if (clean.length > max) {
      return { ok: false, error: `${field} must be ${max} characters or fewer` };
    }
    if (clean) normalized[field] = clean;
  }

  if (row.tagNames != null) {
    if (!Array.isArray(row.tagNames) || row.tagNames.length > 50) {
      return { ok: false, error: 'tagNames must be an array of at most 50 names' };
    }
    const seen = new Set<string>();
    for (const raw of row.tagNames) {
      if (typeof raw !== 'string') {
        return { ok: false, error: 'Every tag name must be a string' };
      }
      const name = raw.trim();
      if (!name) continue;
      if (name.length > 80) {
        return { ok: false, error: 'Tag names must be 80 characters or fewer' };
      }
      const key = name.toLowerCase();
      if (!seen.has(key)) normalized.tagNames.push(name);
      seen.add(key);
    }
  }
  return { ok: true, value: normalized };
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(
      `contactImport:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = (await request.json().catch(() => null)) as {
      operationId?: unknown;
      rows?: unknown;
    } | null;

    const operationId =
      typeof body?.operationId === 'string' ? body.operationId.trim() : '';
    if (!operationId) {
      return NextResponse.json(
        { error: "'operationId' is required" },
        { status: 400 }
      );
    }
    if (!isUuid(operationId)) {
      return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
    }
    if (!Array.isArray(body?.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { error: "'rows' must be a non-empty array" },
        { status: 400 }
      );
    }
    if (body.rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `A single import is limited to ${MAX_ROWS} rows` },
        { status: 400 }
      );
    }

    const { data: operation, error: operationError } = await ctx.supabase
      .from('operations')
      .select('id, name, is_active')
      .eq('account_id', ctx.accountId)
      .eq('id', operationId)
      .maybeSingle();
    if (operationError) {
      console.error('[POST /api/contacts/import] operation lookup:', operationError);
      return NextResponse.json(
        { error: 'Could not load the selected operation' },
        { status: 500 }
      );
    }
    if (!operation) {
      return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
    }
    if (!operation.is_active) {
      return NextResponse.json(
        { error: 'Archived operations cannot receive imports' },
        { status: 409 }
      );
    }

    const rows = body.rows.map(normalizeImportRow);

    const summary = {
      total: rows.length,
      created: 0,
      linkedExisting: 0,
      alreadyLinked: 0,
      invalid: 0,
      conflicts: 0,
      failed: 0,
      tagsAssigned: 0,
    };
    const tagAssignments: ContactTagAssignment[] = [];
    const results: Array<{
      index: number;
      status: ContactIngestionStatus | 'invalid' | 'conflict' | 'failed';
      contactId?: string;
      error?: string;
    }> = [];

    // Ten concurrent rows keep a 500-row import within normal route
    // budgets while the unique constraints + race recovery in the
    // ingestion service preserve idempotency for duplicate phones/ids.
    const concurrency = 10;
    for (let start = 0; start < rows.length; start += concurrency) {
      await Promise.all(
        rows.slice(start, start + concurrency).map(async (normalized, offset) => {
          const index = start + offset;
          if (!normalized.ok) {
            summary.invalid++;
            results.push({ index, status: 'invalid', error: normalized.error });
            return;
          }
          const row = normalized.value;

          try {
            const result = await ingestOperationContact(ctx.supabase, {
              accountId: ctx.accountId,
              userId: ctx.userId,
              operationId,
              method: 'csv',
              input: {
                phone: row.phone,
                name: row.name,
                email: row.email,
                company: row.company,
                externalId: row.externalId,
              },
            });

            if (result.status === 'created') summary.created++;
            else if (result.status === 'linked_existing') summary.linkedExisting++;
            else summary.alreadyLinked++;

            if (row.tagNames.length > 0) {
              tagAssignments.push({
                contactId: result.contactId,
                tagNames: row.tagNames,
              });
            }
            results.push({
              index,
              status: result.status,
              contactId: result.contactId,
            });
          } catch (error) {
            if (error instanceof ContactIngestionError) {
              const status = error.kind === 'conflict' ? 'conflict' : 'invalid';
              if (status === 'conflict') summary.conflicts++;
              else summary.invalid++;
              results.push({ index, status, error: error.message });
              return;
            }

            summary.failed++;
            results.push({
              index,
              status: 'failed',
              error: 'Unexpected import error',
            });
            console.error(`[POST /api/contacts/import] row ${index} failed:`, error);
          }
        })
      );
    }
    results.sort((left, right) => left.index - right.index);

    // Resolve/create tags only for contacts that were actually ingested.
    // Invalid/conflicting rows must not leave unrelated tag definitions behind.
    let skippedNames: string[] = [];
    let tagsWarning = false;
    try {
      const { tagIdByKey, skippedNames: unresolvedNames } =
        await resolveImportTagIds(ctx.supabase, {
          accountId: ctx.accountId,
          userId: ctx.userId,
          tagNames: tagAssignments.flatMap((assignment) => assignment.tagNames),
          canCreateTags: hasMinRole(ctx.role, 'admin'),
        });
      skippedNames = unresolvedNames;
      summary.tagsAssigned = await assignImportedContactTags(
        ctx.supabase,
        tagAssignments,
        tagIdByKey
      );
    } catch (error) {
      tagsWarning = true;
      console.error('[POST /api/contacts/import] tag assignment failed:', error);
    }

    return NextResponse.json({
      operation: { id: operation.id, name: operation.name },
      summary,
      results,
      skippedTagNames: skippedNames,
      tagsWarning,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
