import type { SupabaseClient } from '@supabase/supabase-js';

import { DEFAULT_OPERATION_COLOR } from '@/lib/operations/validation';

export const PROJECT_SELECT = `
  id,
  account_id,
  name,
  color,
  is_active,
  project_type,
  status,
  revenue_model,
  obsidian_path,
  website_url,
  repository_url,
  monthly_cost,
  target_monthly_revenue,
  metadata,
  created_at,
  updated_at
`;

export interface ApiProject {
  id: string;
  name: string;
  color: string;
  is_active: boolean;
  project_type: string;
  status: string;
  revenue_model: string | null;
  obsidian_path: string | null;
  website_url: string | null;
  repository_url: string | null;
  monthly_cost: number;
  target_monthly_revenue: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export class ProjectError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ProjectError';
    this.status = status;
  }
}

const PROJECT_TYPES = new Set([
  'saas',
  'infoproduct',
  'client',
  'agency',
  'campaign',
  'internal',
  'project',
]);

const PROJECT_STATUSES = new Set([
  'idea',
  'building',
  'active',
  'paused',
  'archived',
]);

function asOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function asMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function serializeProject(row: Record<string, unknown>): ApiProject {
  return {
    id: row.id as string,
    name: row.name as string,
    color: (row.color as string) ?? DEFAULT_OPERATION_COLOR,
    is_active: (row.is_active as boolean) ?? true,
    project_type: (row.project_type as string) ?? 'project',
    status: (row.status as string) ?? 'active',
    revenue_model: (row.revenue_model as string | null) ?? null,
    obsidian_path: (row.obsidian_path as string | null) ?? null,
    website_url: (row.website_url as string | null) ?? null,
    repository_url: (row.repository_url as string | null) ?? null,
    monthly_cost: Number(row.monthly_cost) || 0,
    target_monthly_revenue:
      row.target_monthly_revenue == null
        ? null
        : Number(row.target_monthly_revenue),
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export interface UpsertProjectInput {
  name: string;
  color?: string;
  projectType?: string;
  status?: string;
  revenueModel?: string | null;
  obsidianPath?: string | null;
  websiteUrl?: string | null;
  repositoryUrl?: string | null;
  monthlyCost?: number | null;
  targetMonthlyRevenue?: number | null;
  metadata?: Record<string, unknown>;
}

export function parseProjectInput(
  body: Record<string, unknown>
): UpsertProjectInput {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new ProjectError("'name' is required", 400);
  if (name.length > 80)
    throw new ProjectError("'name' must be 80 characters or fewer", 400);

  const projectType =
    typeof body.projectType === 'string' ? body.projectType : 'project';
  if (!PROJECT_TYPES.has(projectType))
    throw new ProjectError("'projectType' is invalid", 400);

  const status = typeof body.status === 'string' ? body.status : 'active';
  if (!PROJECT_STATUSES.has(status))
    throw new ProjectError("'status' is invalid", 400);

  const monthlyCost = asOptionalNumber(body.monthlyCost);
  if (monthlyCost === undefined && body.monthlyCost !== undefined) {
    throw new ProjectError("'monthlyCost' must be a number or null", 400);
  }
  const targetMonthlyRevenue = asOptionalNumber(body.targetMonthlyRevenue);
  if (
    targetMonthlyRevenue === undefined &&
    body.targetMonthlyRevenue !== undefined
  ) {
    throw new ProjectError(
      "'targetMonthlyRevenue' must be a number or null",
      400
    );
  }

  const metadata = asMetadata(body.metadata);
  if (metadata === undefined && body.metadata !== undefined) {
    throw new ProjectError("'metadata' must be an object", 400);
  }

  return {
    name,
    color: typeof body.color === 'string' ? body.color : undefined,
    projectType,
    status,
    revenueModel: asOptionalString(body.revenueModel),
    obsidianPath: asOptionalString(body.obsidianPath),
    websiteUrl: asOptionalString(body.websiteUrl),
    repositoryUrl: asOptionalString(body.repositoryUrl),
    monthlyCost,
    targetMonthlyRevenue,
    metadata,
  };
}

export async function upsertProject(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  input: UpsertProjectInput
): Promise<ApiProject> {
  const payload = {
    account_id: accountId,
    created_by: userId,
    name: input.name,
    color: input.color ?? DEFAULT_OPERATION_COLOR,
    project_type: input.projectType ?? 'project',
    status: input.status ?? 'active',
    is_active: input.status !== 'archived',
    revenue_model: input.revenueModel ?? null,
    obsidian_path: input.obsidianPath ?? null,
    website_url: input.websiteUrl ?? null,
    repository_url: input.repositoryUrl ?? null,
    monthly_cost: input.monthlyCost ?? 0,
    target_monthly_revenue: input.targetMonthlyRevenue ?? null,
    metadata: input.metadata ?? {},
  };

  const { data: existing } = await db
    .from('operations')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', input.name)
    .maybeSingle();

  const query = existing?.id
    ? db
        .from('operations')
        .update(payload)
        .eq('id', existing.id)
        .eq('account_id', accountId)
    : db.from('operations').insert(payload);

  const { data, error } = await query.select(PROJECT_SELECT).single();

  if (error || !data) {
    console.error('[api/v1/projects] upsert error:', error);
    throw new ProjectError('Failed to upsert project', 500);
  }

  return serializeProject(data as Record<string, unknown>);
}
