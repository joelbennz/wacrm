import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateEngagementScore } from '@/lib/contacts/engagement';

import {
  serializeContact,
  findOrCreateContact,
  ContactError,
} from './contacts';

describe('serializeContact', () => {
  it('flattens contact_tags(tags(*)) onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      message_count: 9,
      last_message_at: '2026-01-02T11:00:00Z',
      response_rate: 75,
      avg_response_time: 180,
      engagement_score: 64,
      first_seen_at: '2025-12-20T00:00:00Z',
      last_contacted_at: '2026-01-02T11:00:00Z',
      opt_out: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      contact_tags: [
        { tags: { id: 't1', name: 'vip', color: '#fff' } },
        { tags: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      message_count: 9,
      last_message_at: '2026-01-02T11:00:00Z',
      response_rate: 75,
      avg_response_time: 180,
      engagement_score: calculateEngagementScore(row),
      first_seen_at: '2025-12-20T00:00:00Z',
      last_contacted_at: '2026-01-02T11:00:00Z',
      opt_out: false,
      tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('tolerates a row with no contact_tags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(serializeContact(row).tags).toEqual([]);
    expect(serializeContact(row)).toMatchObject({
      message_count: 0,
      last_message_at: null,
      response_rate: 0,
      avg_response_time: null,
      engagement_score: 0,
      first_seen_at: null,
      last_contacted_at: null,
      opt_out: false,
    });
  });
});

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  it('rejects a non-E.164 phone with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });
});
