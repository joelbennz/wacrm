export const MAX_COMPANY_NAME_LENGTH = 160;
const MAX_INDUSTRY_LENGTH = 80;
const MAX_WEBSITE_LENGTH = 255;
const MAX_PHONE_LENGTH = 50;
const MAX_NOTES_LENGTH = 5000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ValidationResult<T> =
  { ok: true; value: T } | { ok: false; error: string };

export interface CreateCompanyInput {
  name: string;
  industry?: string | null;
  website?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export type PatchCompanyInput = Partial<CreateCompanyInput>;

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
  if (name.length > MAX_COMPANY_NAME_LENGTH) {
    return {
      ok: false,
      error: `Name must be ${MAX_COMPANY_NAME_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, value: name };
}

function validateOptionalString(
  value: unknown,
  field: string,
  max: number
): ValidationResult<string | null> {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, error: `'${field}' must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return { ok: false, error: `'${field}' must be ${max} characters or fewer` };
  }
  return { ok: true, value: trimmed || null };
}

export function parseCreateCompanyInput(
  value: unknown
): ValidationResult<CreateCompanyInput> {
  if (!isRecord(value)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const name = validateName(value.name);
  if (!name.ok) return name;

  const industry = validateOptionalString(value.industry, 'industry', MAX_INDUSTRY_LENGTH);
  if (!industry.ok) return industry;

  const website = validateOptionalString(value.website, 'website', MAX_WEBSITE_LENGTH);
  if (!website.ok) return website;

  const phone = validateOptionalString(value.phone, 'phone', MAX_PHONE_LENGTH);
  if (!phone.ok) return phone;

  const notes = validateOptionalString(value.notes, 'notes', MAX_NOTES_LENGTH);
  if (!notes.ok) return notes;

  return {
    ok: true,
    value: {
      name: name.value,
      industry: industry.value,
      website: website.value,
      phone: phone.value,
      notes: notes.value,
    },
  };
}

export function parsePatchCompanyInput(
  value: unknown
): ValidationResult<PatchCompanyInput> {
  if (!isRecord(value)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const patch: PatchCompanyInput = {};

  if (hasOwn(value, 'name')) {
    const name = validateName(value.name);
    if (!name.ok) return name;
    patch.name = name.value;
  }
  if (hasOwn(value, 'industry')) {
    const industry = validateOptionalString(value.industry, 'industry', MAX_INDUSTRY_LENGTH);
    if (!industry.ok) return industry;
    patch.industry = industry.value;
  }
  if (hasOwn(value, 'website')) {
    const website = validateOptionalString(value.website, 'website', MAX_WEBSITE_LENGTH);
    if (!website.ok) return website;
    patch.website = website.value;
  }
  if (hasOwn(value, 'phone')) {
    const phone = validateOptionalString(value.phone, 'phone', MAX_PHONE_LENGTH);
    if (!phone.ok) return phone;
    patch.phone = phone.value;
  }
  if (hasOwn(value, 'notes')) {
    const notes = validateOptionalString(value.notes, 'notes', MAX_NOTES_LENGTH);
    if (!notes.ok) return notes;
    patch.notes = notes.value;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'At least one field is required' };
  }

  return { ok: true, value: patch };
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export { isUniqueViolation as isPostgresUniqueViolation } from '@/lib/contacts/dedupe';
