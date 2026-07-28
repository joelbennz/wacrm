export const MAX_OPERATION_NAME_LENGTH = 80;
export const DEFAULT_OPERATION_COLOR = '#3b82f6';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

export interface CreateOperationInput {
  name: string;
  color: string;
}

export interface PatchOperationInput {
  name?: string;
  color?: string;
  is_active?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateName(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: "'name' is required" };
  }

  const name = value.trim();
  if (name.length > MAX_OPERATION_NAME_LENGTH) {
    return {
      ok: false,
      error: `Name must be ${MAX_OPERATION_NAME_LENGTH} characters or fewer`,
    };
  }

  return { ok: true, value: name };
}

function validateColor(value: unknown): ValidationResult<string> {
  if (typeof value !== 'string') {
    return { ok: false, error: "'color' must use the #RRGGBB format" };
  }

  const color = value.trim();
  if (!HEX_COLOR_PATTERN.test(color)) {
    return { ok: false, error: "'color' must use the #RRGGBB format" };
  }

  return { ok: true, value: color.toLowerCase() };
}

export function parseCreateOperationInput(
  value: unknown
): ValidationResult<CreateOperationInput> {
  if (!isRecord(value)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const name = validateName(value.name);
  if (!name.ok) return name;

  const color = validateColor(value.color ?? DEFAULT_OPERATION_COLOR);
  if (!color.ok) return color;

  return {
    ok: true,
    value: { name: name.value, color: color.value },
  };
}

export function parsePatchOperationInput(
  value: unknown
): ValidationResult<PatchOperationInput> {
  if (!isRecord(value)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const patch: PatchOperationInput = {};

  if (hasOwn(value, 'name')) {
    const name = validateName(value.name);
    if (!name.ok) return name;
    patch.name = name.value;
  }

  if (hasOwn(value, 'color')) {
    const color = validateColor(value.color);
    if (!color.ok) return color;
    patch.color = color.value;
  }

  if (hasOwn(value, 'is_active')) {
    if (typeof value.is_active !== 'boolean') {
      return { ok: false, error: "'is_active' must be a boolean" };
    }
    patch.is_active = value.is_active;
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      error: "At least one of 'name', 'color', or 'is_active' is required",
    };
  }

  return { ok: true, value: patch };
}

// Re-exported so operations/* call sites don't need a separate import —
// same Postgres-error-code check already used by contact de-dup
// (src/lib/contacts/dedupe.ts), kept as one implementation.
export { isUniqueViolation as isPostgresUniqueViolation } from '@/lib/contacts/dedupe';

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
