import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import {
  PROJECT_SELECT,
  serializeProject,
  parseProjectInput,
  upsertProject,
  ProjectError,
} from '@/lib/api/v1/projects';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';

function sanitizeSearch(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} +@.\-_]/gu, '').trim();
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'projects:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const search = sanitizeSearch(url.searchParams.get('search') ?? '');
    const status = url.searchParams.get('status');
    const projectType = url.searchParams.get('projectType');

    let query = ctx.supabase
      .from('operations')
      .select(PROJECT_SELECT)
      .eq('account_id', ctx.accountId);

    if (search) query = query.ilike('name', `%${search}%`);
    if (status) query = query.eq('status', status);
    if (projectType) query = query.eq('project_type', projectType);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/projects] list error:', error);
      return fail('internal', 'Failed to list projects', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeProject(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'projects:write');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const input = parseProjectInput(body);
    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const project = await upsertProject(
      ctx.supabase,
      ctx.accountId,
      auditUserId,
      input
    );
    return ok(project, 201);
  } catch (err) {
    if (err instanceof ProjectError) {
      return fail(
        err.status === 400 ? 'bad_request' : 'internal',
        err.message,
        err.status
      );
    }
    return toApiErrorResponse(err);
  }
}
