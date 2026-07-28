import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OPERATION_COLOR,
  MAX_OPERATION_NAME_LENGTH,
  isPostgresUniqueViolation,
  isUuid,
  parseCreateOperationInput,
  parsePatchOperationInput,
} from './validation';

describe('parseCreateOperationInput', () => {
  it('trims the name and normalizes a valid color', () => {
    expect(
      parseCreateOperationInput({ name: '  Loja online  ', color: '#A1B2C3' })
    ).toEqual({
      ok: true,
      value: { name: 'Loja online', color: '#a1b2c3' },
    });
  });

  it('uses the default color when color is omitted', () => {
    expect(parseCreateOperationInput({ name: 'Loja' })).toEqual({
      ok: true,
      value: { name: 'Loja', color: DEFAULT_OPERATION_COLOR },
    });
  });

  it('rejects invalid bodies and names outside 1..80 characters', () => {
    expect(parseCreateOperationInput(null).ok).toBe(false);
    expect(parseCreateOperationInput({ name: '   ' }).ok).toBe(false);
    expect(
      parseCreateOperationInput({
        name: 'x'.repeat(MAX_OPERATION_NAME_LENGTH + 1),
      }).ok
    ).toBe(false);
  });

  it('rejects colors outside #RRGGBB', () => {
    expect(parseCreateOperationInput({ name: 'Loja', color: '#fff' }).ok).toBe(
      false
    );
    expect(
      parseCreateOperationInput({ name: 'Loja', color: '3b82f6' }).ok
    ).toBe(false);
  });
});

describe('parsePatchOperationInput', () => {
  it('accepts a partial update and preserves false', () => {
    expect(parsePatchOperationInput({ is_active: false })).toEqual({
      ok: true,
      value: { is_active: false },
    });
  });

  it('rejects an empty patch and invalid field types', () => {
    expect(parsePatchOperationInput({}).ok).toBe(false);
    expect(parsePatchOperationInput({ is_active: 'false' }).ok).toBe(false);
    expect(parsePatchOperationInput({ color: null }).ok).toBe(false);
  });
});

describe('database and route helpers', () => {
  it('recognizes only Postgres unique violations', () => {
    expect(isPostgresUniqueViolation({ code: '23505' })).toBe(true);
    expect(isPostgresUniqueViolation({ code: '23503' })).toBe(false);
    expect(isPostgresUniqueViolation(null)).toBe(false);
  });

  it('recognizes UUIDs and rejects malformed route ids', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
