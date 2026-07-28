import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ContactIngestionError,
  ingestOperationContact,
  type IngestOperationContactParams,
} from './ingest-contact';

interface ContactRow {
  id: string;
  account_id: string;
  user_id: string;
  phone: string;
  phone_normalized: string;
  name: string | null;
  email: string | null;
  company: string | null;
}

interface ContactOperationRow {
  id: string;
  account_id: string;
  contact_id: string;
  operation_id: string;
  external_id: string | null;
  ingestion_method: string;
  linked_by: string;
  last_seen_at: string;
}

interface FakeState {
  contacts: ContactRow[];
  links: ContactOperationRow[];
  contactInsertAttempts: number;
  linkInsertAttempts: number;
  contactUpdates: number;
  linkUpdates: number;
}

interface FakeOptions {
  /** Simulate another writer winning contacts(account_id, phone_normalized). */
  raceContactInsert?: boolean;
  /**
   * Simulate another writer winning the link insert. The callback can alter
   * the winning row, e.g. create it without the incoming external id.
   */
  raceLinkInsert?: (attempted: ContactOperationRow) => ContactOperationRow;
}

type DbResult = { data: unknown; error: { code?: string } | null };
type Mode = 'select' | 'insert' | 'update';

function makeDb(options: FakeOptions = {}): {
  client: SupabaseClient;
  state: FakeState;
} {
  const state: FakeState = {
    contacts: [],
    links: [],
    contactInsertAttempts: 0,
    linkInsertAttempts: 0,
    contactUpdates: 0,
    linkUpdates: 0,
  };
  let contactRaceUsed = false;
  let linkRaceUsed = false;
  let nextContactId = 1;
  let nextLinkId = 1;

  function from(table: string) {
    let mode: Mode = 'select';
    let payload: Record<string, unknown> | null = null;
    const filters: Array<[string, unknown]> = [];

    const matches = (row: object) =>
      filters.every(
        ([column, value]) => (row as Record<string, unknown>)[column] === value
      );

    async function execute(): Promise<DbResult> {
      if (table === 'contacts') {
        if (mode === 'select') {
          return {
            data: state.contacts.find(matches) ?? null,
            error: null,
          };
        }

        if (mode === 'update') {
          for (const contact of state.contacts.filter(matches)) {
            Object.assign(contact, payload);
            state.contactUpdates++;
          }
          return { data: null, error: null };
        }

        state.contactInsertAttempts++;
        const phone = String(payload?.phone ?? '');
        const candidate: ContactRow = {
          id: `contact-${nextContactId++}`,
          account_id: String(payload?.account_id ?? ''),
          user_id: String(payload?.user_id ?? ''),
          phone,
          phone_normalized: phone.replace(/\D/g, ''),
          name: (payload?.name as string | null | undefined) ?? null,
          email: (payload?.email as string | null | undefined) ?? null,
          company: (payload?.company as string | null | undefined) ?? null,
        };

        if (options.raceContactInsert && !contactRaceUsed) {
          contactRaceUsed = true;
          state.contacts.push({ ...candidate, id: 'contact-race-winner' });
          return { data: null, error: { code: '23505' } };
        }

        const duplicate = state.contacts.some(
          (contact) =>
            contact.account_id === candidate.account_id &&
            contact.phone_normalized === candidate.phone_normalized
        );
        if (duplicate) return { data: null, error: { code: '23505' } };

        state.contacts.push(candidate);
        return { data: { id: candidate.id }, error: null };
      }

      if (table === 'contact_operations') {
        if (mode === 'select') {
          return {
            data: state.links.find(matches) ?? null,
            error: null,
          };
        }

        if (mode === 'update') {
          const targets = state.links.filter(matches);
          const externalId = payload?.external_id;
          if (
            typeof externalId === 'string' &&
            targets.some((target) =>
              state.links.some(
                (link) =>
                  link.id !== target.id &&
                  link.operation_id === target.operation_id &&
                  link.external_id === externalId
              )
            )
          ) {
            return { data: null, error: { code: '23505' } };
          }

          for (const link of targets) {
            Object.assign(link, payload);
            state.linkUpdates++;
          }
          return { data: null, error: null };
        }

        state.linkInsertAttempts++;
        const attempted: ContactOperationRow = {
          id: `link-${nextLinkId++}`,
          account_id: String(payload?.account_id ?? ''),
          contact_id: String(payload?.contact_id ?? ''),
          operation_id: String(payload?.operation_id ?? ''),
          external_id:
            (payload?.external_id as string | null | undefined) ?? null,
          ingestion_method: String(payload?.ingestion_method ?? ''),
          linked_by: String(payload?.linked_by ?? ''),
          last_seen_at: new Date().toISOString(),
        };

        if (options.raceLinkInsert && !linkRaceUsed) {
          linkRaceUsed = true;
          state.links.push(options.raceLinkInsert(attempted));
          return { data: null, error: { code: '23505' } };
        }

        const duplicate = state.links.some(
          (link) =>
            (link.contact_id === attempted.contact_id &&
              link.operation_id === attempted.operation_id) ||
            (attempted.external_id !== null &&
              link.operation_id === attempted.operation_id &&
              link.external_id === attempted.external_id)
        );
        if (duplicate) return { data: null, error: { code: '23505' } };

        state.links.push(attempted);
        return { data: null, error: null };
      }

      throw new Error(`Unexpected table: ${table}`);
    }

    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.insert = (value: Record<string, unknown>) => {
      mode = 'insert';
      payload = value;
      return builder;
    };
    builder.update = (value: Record<string, unknown>) => {
      mode = 'update';
      payload = value;
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    };
    builder.maybeSingle = execute;
    builder.single = execute;
    builder.then = (
      resolve: (value: DbResult) => unknown,
      reject: (reason: unknown) => unknown
    ) => execute().then(resolve, reject);
    return builder;
  }

  return {
    client: { from } as unknown as SupabaseClient,
    state,
  };
}

const accountId = 'account-1';
const userId = 'user-1';
const phone = '+244 923 000 001';

function ingest(
  db: SupabaseClient,
  operationId: string,
  input: IngestOperationContactParams['input']
) {
  return ingestOperationContact(db, {
    accountId,
    userId,
    operationId,
    method: 'csv',
    input,
  });
}

describe('ingestOperationContact', () => {
  it('links one canonical contact to two operations without duplicating it', async () => {
    const { client, state } = makeDb();

    const first = await ingest(client, 'operation-a', {
      phone,
      name: 'Alice',
      externalId: 'project-a-42',
    });
    const second = await ingest(client, 'operation-b', {
      phone: '244923000001',
      name: 'Alice from project B',
      externalId: 'project-b-91',
    });

    expect(first).toEqual({ contactId: 'contact-1', status: 'created' });
    expect(second).toEqual({
      contactId: 'contact-1',
      status: 'linked_existing',
    });
    expect(state.contacts).toHaveLength(1);
    expect(state.contactInsertAttempts).toBe(1);
    expect(state.links).toHaveLength(2);
    expect(state.links.map((link) => link.operation_id).sort()).toEqual([
      'operation-a',
      'operation-b',
    ]);
  });

  it('is idempotent when the same source record is re-imported', async () => {
    const { client, state } = makeDb();
    const input = {
      phone,
      name: 'Alice',
      externalId: 'source-42',
    };

    const first = await ingest(client, 'operation-a', input);
    const second = await ingest(client, 'operation-a', {
      ...input,
      phone: '244923000001',
    });

    expect(first.status).toBe('created');
    expect(second).toEqual({
      contactId: first.contactId,
      status: 'already_linked',
    });
    expect(state.contacts).toHaveLength(1);
    expect(state.links).toHaveLength(1);
    expect(state.contactInsertAttempts).toBe(1);
    expect(state.linkInsertAttempts).toBe(1);
    expect(state.linkUpdates).toBe(1);
  });

  it('rejects one external id arriving with a different exact phone', async () => {
    const { client, state } = makeDb();
    await ingest(client, 'operation-a', {
      phone,
      externalId: 'source-42',
    });

    await expect(
      ingest(client, 'operation-a', {
        phone: '+351 923 000 001',
        externalId: 'source-42',
      })
    ).rejects.toMatchObject({
      kind: 'conflict',
    });

    expect(state.contacts).toHaveLength(1);
    expect(state.links).toHaveLength(1);
  });

  it('rejects a second external id for the same contact and operation without enriching it', async () => {
    const { client, state } = makeDb();
    await ingest(client, 'operation-a', {
      phone,
      externalId: 'source-42',
    });

    const error = await ingest(client, 'operation-a', {
      phone,
      email: 'should-not-be-saved@example.com',
      externalId: 'source-99',
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ContactIngestionError);
    expect(error).toMatchObject({ kind: 'conflict' });
    expect(state.contacts[0].email).toBeNull();
    expect(state.links).toHaveLength(1);
    expect(state.links[0].external_id).toBe('source-42');
  });

  it('re-resolves the contact when another writer wins the phone unique constraint', async () => {
    const { client, state } = makeDb({ raceContactInsert: true });

    const result = await ingest(client, 'operation-a', {
      phone,
      externalId: 'source-42',
    });

    expect(result).toEqual({
      contactId: 'contact-race-winner',
      status: 'linked_existing',
    });
    expect(state.contacts).toHaveLength(1);
    expect(state.links).toHaveLength(1);
    expect(state.contactInsertAttempts).toBe(1);
  });

  it('recovers a link unique race and applies the incoming external id to the winner', async () => {
    const { client, state } = makeDb({
      raceLinkInsert: (attempted) => ({
        ...attempted,
        id: 'link-race-winner',
        external_id: null,
      }),
    });

    const result = await ingest(client, 'operation-a', {
      phone,
      externalId: 'source-42',
    });

    expect(result).toEqual({
      contactId: 'contact-1',
      status: 'already_linked',
    });
    expect(state.contacts).toHaveLength(1);
    expect(state.links).toHaveLength(1);
    expect(state.links[0]).toMatchObject({
      id: 'link-race-winner',
      contact_id: 'contact-1',
      operation_id: 'operation-a',
      external_id: 'source-42',
    });
    expect(state.linkInsertAttempts).toBe(1);
    expect(state.linkUpdates).toBe(1);
  });
});
