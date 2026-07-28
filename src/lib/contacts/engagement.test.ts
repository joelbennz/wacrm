import { describe, expect, it } from 'vitest';

import { calculateEngagementScore } from './engagement';

const NOW = Date.parse('2026-07-13T12:00:00Z');

describe('calculateEngagementScore', () => {
  it('combines recency, frequency and response rate', () => {
    expect(
      calculateEngagementScore(
        {
          message_count: 12,
          response_rate: 50,
          last_message_at: '2026-07-13T11:30:00Z',
        },
        NOW
      )
    ).toBe(75);
  });

  it('decays recency without needing a database write', () => {
    const input = {
      message_count: 5,
      response_rate: 0,
      last_message_at: '2026-07-13T11:30:00Z',
    };
    expect(calculateEngagementScore(input, NOW)).toBe(55);
    expect(calculateEngagementScore(input, NOW + 31 * 24 * 60 * 60 * 1000)).toBe(15);
  });

  it('clamps malformed inputs into the 0..100 range', () => {
    expect(
      calculateEngagementScore({ message_count: -1, response_rate: 999 }, NOW)
    ).toBe(30);
  });
});
