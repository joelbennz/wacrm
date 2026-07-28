import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation, normalizeKey } from '@/lib/contacts/dedupe';
import {
  isValidE164,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';

export type ContactIngestionStatus =
  | 'created'
  | 'linked_existing'
  | 'already_linked';

export interface OperationContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  externalId?: string | null;
}

export interface IngestOperationContactParams {
  accountId: string;
  userId: string;
  operationId: string;
  method: 'manual' | 'csv' | 'api' | 'event';
  input: OperationContactInput;
}

export interface IngestOperationContactResult {
  contactId: string;
  status: ContactIngestionStatus;
}

export class ContactIngestionError extends Error {
  readonly kind: 'invalid' | 'conflict';

  constructor(kind: 'invalid' | 'conflict', message: string) {
    super(message);
    this.name = 'ContactIngestionError';
    this.kind = kind;
  }
}

interface ContactSnapshot {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
}

interface SourceLink {
  id: string;
  contact_id: string;
  external_id: string | null;
}

function isInactiveOperationViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const dbError = error as {
    code?: string;
    constraint?: string;
    message?: string;
  };
  return (
    dbError.code === '23514' &&
    (dbError.constraint === 'contact_operations_active_operation' ||
      dbError.message?.includes('Archived operations cannot receive') === true)
  );
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

async function loadContact(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ContactSnapshot> {
  const { data, error } = await db
    .from('contacts')
    .select('id, phone, name, email, company')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle();

  if (error || !data) {
    throw new Error('Linked contact could not be loaded');
  }
  return data as ContactSnapshot;
}

async function findOrCreateExactContact(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  phone: string,
  input: OperationContactInput
): Promise<{ id: string; created: boolean }> {
  const findExact = () =>
    db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone_normalized', phone)
      .maybeSingle();

  const { data: existing, error: findError } = await findExact();
  if (findError) throw new Error('Contact identity could not be resolved');
  if (existing) return { id: existing.id as string, created: false };

  const { data: created, error: createError } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: userId,
      phone,
      name: cleanOptional(input.name) ?? phone,
      email: cleanOptional(input.email),
      company: cleanOptional(input.company),
    })
    .select('id')
    .single();
  if (!createError && created) {
    return { id: created.id as string, created: true };
  }
  if (isUniqueViolation(createError)) {
    const { data: winner, error: winnerError } = await findExact();
    if (!winnerError && winner) {
      return { id: winner.id as string, created: false };
    }
  }
  throw new Error('Contact identity could not be created');
}

/** Fill only missing profile data: an import never overwrites CRM edits. */
async function enrichBlankContactFields(
  db: SupabaseClient,
  accountId: string,
  contact: ContactSnapshot,
  input: OperationContactInput
): Promise<void> {
  const name = cleanOptional(input.name);
  const email = cleanOptional(input.email);
  const company = cleanOptional(input.company);
  const updates: Record<string, string> = {};

  if (
    name &&
    (!contact.name?.trim() || normalizeKey(contact.name) === normalizeKey(contact.phone))
  ) {
    updates.name = name;
  }
  if (email && !contact.email?.trim()) updates.email = email;
  if (company && !contact.company?.trim()) updates.company = company;
  if (Object.keys(updates).length === 0) return;

  const { error } = await db
    .from('contacts')
    .update(updates)
    .eq('account_id', accountId)
    .eq('id', contact.id);
  if (error) throw new Error('Contact profile could not be enriched');
}

async function touchLink(
  db: SupabaseClient,
  accountId: string,
  link: SourceLink,
  externalId: string | null
): Promise<void> {
  if (link.external_id && externalId && link.external_id !== externalId) {
    throw new ContactIngestionError(
      'conflict',
      'This contact is already linked to a different external identifier in this operation'
    );
  }

  const updates: { last_seen_at: string; external_id?: string } = {
    last_seen_at: new Date().toISOString(),
  };
  if (!link.external_id && externalId) updates.external_id = externalId;

  const { error } = await db
    .from('contact_operations')
    .update(updates)
    .eq('account_id', accountId)
    .eq('id', link.id);
  if (error) {
    if (isInactiveOperationViolation(error)) {
      throw new ContactIngestionError(
        'conflict',
        'Archived operations cannot receive imports'
      );
    }
    if (isUniqueViolation(error)) {
      throw new ContactIngestionError(
        'conflict',
        'This external identifier is already linked to another contact in the operation'
      );
    }
    throw new Error('Contact source link could not be refreshed');
  }
}

/**
 * Link one source record to the account's central contact identity.
 * Phone de-duplication follows the database's exact normalized-phone key;
 * externalId, when present, provides the stronger source idempotency key.
 */
export async function ingestOperationContact(
  db: SupabaseClient,
  params: IngestOperationContactParams
): Promise<IngestOperationContactResult> {
  const { accountId, userId, operationId, method, input } = params;
  const phone = sanitizePhoneForMeta(input.phone);
  if (!isValidE164(phone)) {
    throw new ContactIngestionError(
      'invalid',
      'Phone must be a valid E.164 number (for example +244923000000)'
    );
  }

  const externalId = cleanOptional(input.externalId);
  if (externalId && externalId.length > 255) {
    throw new ContactIngestionError(
      'invalid',
      'External identifier must be 255 characters or fewer'
    );
  }

  // A known source id wins over phone matching. If it arrives with a
  // materially different number, stop instead of silently relinking it.
  if (externalId) {
    const { data, error } = await db
      .from('contact_operations')
      .select('id, contact_id, external_id')
      .eq('account_id', accountId)
      .eq('operation_id', operationId)
      .eq('external_id', externalId)
      .maybeSingle();
    if (error) throw new Error('Contact source could not be resolved');

    if (data) {
      const link = data as SourceLink;
      const contact = await loadContact(db, accountId, link.contact_id);
      if (normalizeKey(contact.phone) !== phone) {
        throw new ContactIngestionError(
          'conflict',
          'The external identifier already belongs to a contact with another phone number'
        );
      }
      await touchLink(db, accountId, link, externalId);
      await enrichBlankContactFields(db, accountId, contact, input);
      return { contactId: contact.id, status: 'already_linked' };
    }
  }

  const resolved = await findOrCreateExactContact(
    db,
    accountId,
    userId,
    phone,
    input
  );
  const contact = await loadContact(db, accountId, resolved.id);

  const { data: currentLink, error: currentError } = await db
    .from('contact_operations')
    .select('id, contact_id, external_id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .eq('operation_id', operationId)
    .maybeSingle();
  if (currentError) throw new Error('Contact source link could not be resolved');

  if (currentLink) {
    await touchLink(db, accountId, currentLink as SourceLink, externalId);
    if (!resolved.created) {
      await enrichBlankContactFields(db, accountId, contact, input);
    }
    return { contactId: contact.id, status: 'already_linked' };
  }

  const { error: linkError } = await db.from('contact_operations').insert({
    account_id: accountId,
    contact_id: contact.id,
    operation_id: operationId,
    external_id: externalId,
    ingestion_method: method,
    linked_by: userId,
  });

  if (linkError) {
    if (isInactiveOperationViolation(linkError)) {
      throw new ContactIngestionError(
        'conflict',
        'Archived operations cannot receive imports'
      );
    }
    if (isUniqueViolation(linkError)) {
      // A concurrent import may have created the exact same link. Resolve
      // it once; a different contact using the same external id is a real conflict.
      const { data: racedBySource } = externalId
        ? await db
            .from('contact_operations')
            .select('id, contact_id, external_id')
            .eq('account_id', accountId)
            .eq('operation_id', operationId)
            .eq('external_id', externalId)
            .maybeSingle()
        : { data: null };
      if (racedBySource && racedBySource.contact_id !== contact.id) {
        throw new ContactIngestionError(
          'conflict',
          'This external identifier is already linked to another contact in the operation'
        );
      }

      const { data: racedByContact } = await db
        .from('contact_operations')
        .select('id, contact_id, external_id')
        .eq('account_id', accountId)
        .eq('operation_id', operationId)
        .eq('contact_id', contact.id)
        .maybeSingle();
      if (racedBySource) {
        await touchLink(db, accountId, racedBySource as SourceLink, externalId);
        if (!resolved.created) {
          await enrichBlankContactFields(db, accountId, contact, input);
        }
        return { contactId: contact.id, status: 'already_linked' };
      }
      if (racedByContact) {
        await touchLink(db, accountId, racedByContact as SourceLink, externalId);
        if (!resolved.created) {
          await enrichBlankContactFields(db, accountId, contact, input);
        }
        return { contactId: contact.id, status: 'already_linked' };
      }
    }
    throw new Error('Contact source link could not be created');
  }

  if (!resolved.created) {
    await enrichBlankContactFields(db, accountId, contact, input);
  }

  return {
    contactId: contact.id,
    status: resolved.created ? 'created' : 'linked_existing',
  };
}
