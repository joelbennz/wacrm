import type { SupabaseClient } from '@supabase/supabase-js';

export class AccountReferenceError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'AccountReferenceError';
  }
}

async function assertBelongsToAccount(
  db: SupabaseClient,
  table: string,
  id: string | null,
  accountId: string,
  field: string
): Promise<void> {
  if (!id) return;

  const { data, error } = await db
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    console.error(`[api/v1] failed to validate ${field}:`, error);
    throw new AccountReferenceError(`Could not validate '${field}'`);
  }
  if (!data) {
    throw new AccountReferenceError(
      `'${field}' was not found for this account`
    );
  }
}

async function getSourceOperationId(
  db: SupabaseClient,
  sourceId: string | null,
  accountId: string
): Promise<string | null> {
  if (!sourceId) return null;

  const { data, error } = await db
    .from('integration_sources')
    .select('operation_id')
    .eq('id', sourceId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    console.error('[api/v1] failed to validate source operation:', error);
    throw new AccountReferenceError("Could not validate 'sourceId'");
  }
  return (data?.operation_id as string | null | undefined) ?? null;
}

export interface AccountReferences {
  operationId?: string | null;
  sourceId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
}

export async function assertAccountReferences(
  db: SupabaseClient,
  accountId: string,
  refs: AccountReferences
): Promise<void> {
  await Promise.all([
    assertBelongsToAccount(
      db,
      'operations',
      refs.operationId ?? null,
      accountId,
      'operationId'
    ),
    assertBelongsToAccount(
      db,
      'integration_sources',
      refs.sourceId ?? null,
      accountId,
      'sourceId'
    ),
    assertBelongsToAccount(
      db,
      'contacts',
      refs.contactId ?? null,
      accountId,
      'contactId'
    ),
    assertBelongsToAccount(
      db,
      'deals',
      refs.dealId ?? null,
      accountId,
      'dealId'
    ),
  ]);

  const sourceOperationId = await getSourceOperationId(
    db,
    refs.sourceId ?? null,
    accountId
  );
  if (
    refs.operationId &&
    sourceOperationId &&
    sourceOperationId !== refs.operationId
  ) {
    throw new AccountReferenceError(
      "'sourceId' belongs to a different operation than 'operationId'"
    );
  }
}
