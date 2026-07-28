/**
 * CSV parsing for the contacts import modal. Shared + unit-tested so
 * tag-column handling stays aligned with phone/name/email/company.
 */

export interface ParsedContactRow {
  phone: string;
  name?: string;
  email?: string;
  company?: string;
  /** Identifier used by the source operation (optional but useful for idempotent re-imports). */
  externalId?: string;
  /** Tag names from the optional `tags` column (comma/semicolon separated). */
  tagNames: string[];
}

/** Split a CSV cell into unique tag names (case-insensitive de-dupe). */
export function parseTagCell(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of value.split(/[,;]/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

export interface ParseContactCsvResult {
  rows: ParsedContactRow[];
  /** True when the CSV header includes a `tags` column. */
  hasTagsColumn: boolean;
  /** True when the CSV header includes a `company` column. */
  hasCompanyColumn: boolean;
  /** True when the CSV header includes `external_id`. */
  hasExternalIdColumn: boolean;
}

/**
 * Parse RFC-4180-style CSV records, including escaped quotes and newlines in
 * quoted cells. Delimiting quotes are removed, while quote/apostrophe
 * characters that are part of the value are preserved.
 */
function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let current = '';
  let inQuotes = false;

  const pushRecord = () => {
    record.push(current);
    current = '';
    if (record.some((value) => value.trim().length > 0)) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' && current.trim().length === 0) {
      inQuotes = true;
    } else if (char === ',') {
      record.push(current);
      current = '';
    } else if (char === '\n') {
      pushRecord();
    } else if (char === '\r') {
      if (text[i + 1] === '\n') i++;
      pushRecord();
    } else {
      current += char;
    }
  }

  if (current.length > 0 || record.length > 0) pushRecord();
  return records;
}

export function parseContactCsv(text: string): ParseContactCsvResult {
  const records = parseCsvRecords(text);
  if (records.length < 2) {
    return {
      rows: [],
      hasTagsColumn: false,
      hasCompanyColumn: false,
      hasExternalIdColumn: false,
    };
  }

  const headers = records[0].map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, '') : header)
      .trim()
      .toLowerCase()
  );

  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) {
    return {
      rows: [],
      hasTagsColumn: false,
      hasCompanyColumn: false,
      hasExternalIdColumn: false,
    };
  }

  const nameIdx = headers.indexOf('name');
  const emailIdx = headers.indexOf('email');
  const companyIdx = headers.indexOf('company');
  const tagsIdx = headers.indexOf('tags');
  const externalIdIdx = headers.indexOf('external_id');

  const rows: ParsedContactRow[] = [];

  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    const phone = values[phoneIdx]?.trim();
    if (!phone) continue;

    rows.push({
      phone,
      name:
        nameIdx >= 0
          ? values[nameIdx]?.trim() || undefined
          : undefined,
      email:
        emailIdx >= 0
          ? values[emailIdx]?.trim() || undefined
          : undefined,
      company:
        companyIdx >= 0
          ? values[companyIdx]?.trim() || undefined
          : undefined,
      externalId:
        externalIdIdx >= 0
          ? values[externalIdIdx]?.trim() || undefined
          : undefined,
      tagNames: tagsIdx >= 0 ? parseTagCell(values[tagsIdx]) : [],
    });
  }

  return {
    rows,
    hasTagsColumn: tagsIdx >= 0,
    hasCompanyColumn: companyIdx >= 0,
    hasExternalIdColumn: externalIdIdx >= 0,
  };
}
