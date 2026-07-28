'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import {
  parseContactCsv,
  type ParsedContactRow,
} from '@/lib/contacts/parse-contact-csv';
import type { Operation } from '@/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Network,
  Tag,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

const DEFAULT_TAG_COLOR = '#3b82f6';
const PREVIEW_LIMIT = 5;
const IMPORT_CHUNK_SIZE = 500;

interface ImportSummary {
  total: number;
  processed: number;
  created: number;
  linkedExisting: number;
  alreadyLinked: number;
  invalid: number;
  conflicts: number;
  failed: number;
  tagsAssigned: number;
  partial: boolean;
  issues: ImportIssue[];
}

interface ImportIssue {
  row: number;
  status: 'invalid' | 'conflict' | 'failed';
  error: string;
}

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

function PreviewCell({
  value,
  mono,
  maxWidth = 'max-w-[9rem]',
}: {
  value: string;
  mono?: boolean;
  maxWidth?: string;
}) {
  return (
    <span
      className={cn(
        'block truncate',
        maxWidth,
        mono && 'font-mono text-[11px]'
      )}
      title={value}
    >
      {value}
    </span>
  );
}

function ImportPreviewTags({
  tagNames,
  tagColorByKey,
  canCreateTags,
}: {
  tagNames: string[];
  tagColorByKey: Map<string, string>;
  canCreateTags: boolean;
}) {
  const t = useTranslations('Contacts.importModal');

  if (tagNames.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex min-w-[4.5rem] flex-wrap gap-1">
      {tagNames.map((name) => {
        const color =
          tagColorByKey.get(name.trim().toLowerCase()) ?? DEFAULT_TAG_COLOR;
        const isKnown = tagColorByKey.has(name.trim().toLowerCase());
        return (
          <span
            key={name}
            className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] leading-none font-medium"
            style={{
              backgroundColor: `${color}18`,
              color,
              border: `1px solid ${color}${isKnown ? '55' : '30'}`,
            }}
            title={
              isKnown
                ? name
                : canCreateTags
                  ? t('willBeCreated', { name })
                  : t('willBeSkipped', { name })
            }
          >
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="truncate">{name}</span>
          </span>
        );
      })}
    </div>
  );
}

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: ImportModalProps) {
  const t = useTranslations('Contacts.importModal');
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedContactRow[]>([]);
  const [hasTagsColumn, setHasTagsColumn] = useState(false);
  const [hasCompanyColumn, setHasCompanyColumn] = useState(false);
  const [hasExternalIdColumn, setHasExternalIdColumn] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [operationId, setOperationId] = useState('');
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [tagColorByKey, setTagColorByKey] = useState<Map<string, string>>(
    new Map()
  );
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setOperationsLoading(true);

    void fetch('/api/account/operations', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || t('operationsLoadError'));
        if (cancelled) return;
        const active = ((payload.operations ?? []) as Operation[]).filter(
          (operation) => operation.is_active
        );
        setOperations(active);
        setOperationId((current) =>
          active.some((operation) => operation.id === current)
            ? current
            : ''
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : t('operationsLoadError')
          );
        }
      })
      .finally(() => {
        if (!cancelled) setOperationsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, t]);

  function reset() {
    setFile(null);
    setParsedRows([]);
    setHasTagsColumn(false);
    setHasCompanyColumn(false);
    setHasExternalIdColumn(false);
    setTagColorByKey(new Map());
    setOperationId('');
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next && importing) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const {
      rows,
      hasTagsColumn: csvHasTags,
      hasCompanyColumn: csvHasCompany,
      hasExternalIdColumn: csvHasExternalId,
    } = parseContactCsv(text);

    if (rows.length === 0) {
      toast.error(t('toastNoValidRows'));
      setParsedRows([]);
      setHasTagsColumn(false);
      setHasCompanyColumn(false);
      setHasExternalIdColumn(false);
      setTagColorByKey(new Map());
      return;
    }

    setParsedRows(rows);
    setHasTagsColumn(csvHasTags);
    setHasCompanyColumn(csvHasCompany);
    setHasExternalIdColumn(csvHasExternalId);

    if (csvHasTags && accountId) {
      const { data: tags } = await supabase
        .from('tags')
        .select('name, color')
        .eq('account_id', accountId);

      const colors = new Map<string, string>();
      for (const tag of tags ?? []) {
        const key = tag.name.trim().toLowerCase();
        if (!colors.has(key)) colors.set(key, tag.color);
      }
      setTagColorByKey(colors);
    } else {
      setTagColorByKey(new Map());
    }
  }

  async function handleImport() {
    if (parsedRows.length === 0 || !operationId) return;
    setImporting(true);

    const combined: ImportSummary = {
      total: parsedRows.length,
      processed: 0,
      created: 0,
      linkedExisting: 0,
      alreadyLinked: 0,
      invalid: 0,
      conflicts: 0,
      failed: 0,
      tagsAssigned: 0,
      partial: false,
      issues: [],
    };
    const skippedTagNames = new Set<string>();
    let tagsWarning = false;

    try {
      for (let start = 0; start < parsedRows.length; start += IMPORT_CHUNK_SIZE) {
        const rows = parsedRows.slice(start, start + IMPORT_CHUNK_SIZE);
        const response = await fetch('/api/contacts/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationId, rows }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || t('toastError'));

        const summary = payload.summary as Omit<
          ImportSummary,
          'processed' | 'partial' | 'issues'
        >;
        combined.processed += rows.length;
        combined.created += summary.created;
        combined.linkedExisting += summary.linkedExisting;
        combined.alreadyLinked += summary.alreadyLinked;
        combined.invalid += summary.invalid;
        combined.conflicts += summary.conflicts;
        combined.failed += summary.failed;
        combined.tagsAssigned += summary.tagsAssigned;
        tagsWarning ||= payload.tagsWarning === true;
        for (const name of (payload.skippedTagNames ?? []) as string[]) {
          skippedTagNames.add(name);
        }
        for (const issue of (payload.results ?? []) as Array<{
          index: number;
          status: string;
          error?: string;
        }>) {
          if (
            combined.issues.length >= 20 ||
            !['invalid', 'conflict', 'failed'].includes(issue.status)
          ) {
            continue;
          }
          combined.issues.push({
            row: start + issue.index + 2,
            status: issue.status as ImportIssue['status'],
            error: issue.error || t('toastError'),
          });
        }
      }

      setResult({ ...combined, issues: [...combined.issues] });
      const changed = combined.created + combined.linkedExisting;
      const successful = changed + combined.alreadyLinked;
      if (changed > 0) {
        toast.success(
          t('toastProcessed', {
            created: combined.created,
            linked: combined.linkedExisting,
          })
        );
      }
      if (successful > 0 || combined.tagsAssigned > 0) onImported();
      if (combined.alreadyLinked > 0) {
        toast.info(t('toastAlreadyLinked', { count: combined.alreadyLinked }));
      }
      if (combined.tagsAssigned > 0) {
        toast.success(t('toastTagsAssigned', { count: combined.tagsAssigned }));
      }
      if (tagsWarning) toast.warning(t('toastTagsWarning'));
      if (skippedTagNames.size > 0) {
        const names = [...skippedTagNames];
        const sample = names.slice(0, 3).join(', ');
        const more = names.length > 3 ? ` (+${names.length - 3})` : '';
        toast.info(t('toastTagsSkipped', { sample, more }));
      }
      const problems = combined.invalid + combined.conflicts + combined.failed;
      if (problems > 0) toast.error(t('toastProblems', { count: problems }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('toastError');
      if (combined.processed > 0) {
        combined.partial = true;
        setResult({ ...combined, issues: [...combined.issues] });
        if (
          combined.created + combined.linkedExisting + combined.alreadyLinked >
            0 ||
          combined.tagsAssigned > 0
        ) {
          onImported();
        }
        toast.warning(
          t('toastPartial', {
            processed: combined.processed,
            total: combined.total,
          })
        );
        toast.error(message);
      } else {
        toast.error(message);
      }
    } finally {
      setImporting(false);
    }
  }

  const preview = parsedRows.slice(0, PREVIEW_LIMIT);
  // Tags: OR — show when the CSV declares a column or preview rows carry
  // values, so an all-empty tags column still renders for validation.
  const previewHasTags =
    hasTagsColumn || preview.some((row) => row.tagNames.length > 0);
  // Company: AND — hide unless the CSV declares it and preview has data,
  // avoiding an all-dash column that wastes horizontal space.
  const previewHasCompany =
    hasCompanyColumn && preview.some((row) => row.company?.trim());
  const previewHasExternalId =
    hasExternalIdColumn && preview.some((row) => row.externalId?.trim());

  const tagStats = useMemo(() => {
    const names = new Set<string>();
    let rowsWithTags = 0;
    for (const row of parsedRows) {
      if (row.tagNames.length === 0) continue;
      rowsWithTags++;
      for (const name of row.tagNames) names.add(name.trim().toLowerCase());
    }
    return { unique: names.size, rowsWithTags };
  }, [parsedRows]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-2xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg text-popover-foreground">
              {t('title')}
            </DialogTitle>
            <DialogDescription className="leading-relaxed text-muted-foreground"
              dangerouslySetInnerHTML={{
                __html: t.markup('desc', {
                  phoneCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  nameCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  emailCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  companyCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  tagsCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  externalIdCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                })
              }}
            />
          </DialogHeader>

          <div className="rounded-xl border border-border/80 bg-background/45 p-3">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Network className="size-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <label
                  htmlFor="import-operation"
                  className="block text-xs font-medium text-foreground"
                >
                  {t('operationLabel')}
                </label>
                <select
                  id="import-operation"
                  value={operationId}
                  onChange={(event) => setOperationId(event.target.value)}
                  disabled={
                    operationsLoading || operations.length === 0 || importing
                  }
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {operationsLoading ? (
                    <option value="">{t('operationsLoading')}</option>
                  ) : operations.length === 0 ? (
                    <option value="">{t('noOperationsOption')}</option>
                  ) : (
                    <>
                      <option value="" disabled>
                        {t('selectOperation')}
                      </option>
                      {operations.map((operation) => (
                        <option key={operation.id} value={operation.id}>
                          {operation.name}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  {operations.length === 0 && !operationsLoading
                    ? t('noOperationsHint')
                    : t('operationHint')}
                </p>
              </div>
            </div>
          </div>

          <div
            role="button"
            tabIndex={importing ? -1 : 0}
            aria-disabled={importing}
            onClick={() => {
              if (!importing) fileInputRef.current?.click();
            }}
            onKeyDown={(e) => {
              if (!importing && (e.key === 'Enter' || e.key === ' '))
                fileInputRef.current?.click();
            }}
            className={cn(
              'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 transition-all',
              file
                ? 'border-primary/35 bg-primary/[0.04]'
                : 'hover:border-primary/40 border-border/80 bg-background/40 hover:bg-background/70',
              importing && 'pointer-events-none opacity-60'
            )}
          >
            {file ? (
              <>
                <div className="bg-primary/15 ring-primary/25 flex size-10 items-center justify-center rounded-lg ring-1">
                  <FileText className="text-primary size-5" />
                </div>
                <p
                  className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground"
                  title={file.name}
                >
                  {truncateFilename(file.name)}
                </p>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t('rowsReady', { count: parsedRows.length })}
                </span>
              </>
            ) : (
              <>
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 transition-colors group-hover:bg-muted">
                  <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('uploadDropzone')}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('uploadHint')}
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            disabled={importing}
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {preview.length > 0 && !result && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                  {t('preview', { count: preview.length })}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tagStats.rowsWithTags > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/90 px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Tag className="text-primary/80 size-3" />
                      {t('previewTags', { tags: tagStats.unique, contacts: tagStats.rowsWithTags })}
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-border ring-1 ring-border/50">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-xs">
                    <thead>
                      <tr className="border-b border-border bg-background/60">
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.phone')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.name')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.email')}
                        </th>
                        {previewHasCompany && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.company')}
                          </th>
                        )}
                        {previewHasExternalId && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.externalId')}
                          </th>
                        )}
                        {previewHasTags && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.tags')}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className="bg-popover/40 transition-colors hover:bg-muted/30"
                        >
                          <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                            <PreviewCell
                              value={row.phone}
                              mono
                              maxWidth="max-w-[7.5rem]"
                            />
                          </td>
                          <td className="px-3 py-2 text-popover-foreground">
                            <PreviewCell
                              value={row.name || '—'}
                              maxWidth="max-w-[8.5rem]"
                            />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <PreviewCell
                              value={row.email || '—'}
                              maxWidth="max-w-[10rem]"
                            />
                          </td>
                          {previewHasCompany && (
                            <td className="px-3 py-2 text-muted-foreground">
                              <PreviewCell
                                value={row.company || '—'}
                                maxWidth="max-w-[7rem]"
                              />
                            </td>
                          )}
                          {previewHasExternalId && (
                            <td className="px-3 py-2 text-muted-foreground">
                              <PreviewCell
                                value={row.externalId || '—'}
                                mono
                                maxWidth="max-w-[8rem]"
                              />
                            </td>
                          )}
                          {previewHasTags && (
                            <td className="px-3 py-2 align-top">
                              <ImportPreviewTags
                                tagNames={row.tagNames}
                                tagColorByKey={tagColorByKey}
                                canCreateTags={canEditSettings}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {parsedRows.length > PREVIEW_LIMIT && (
                <p className="text-center text-[11px] text-muted-foreground">
                  {t('moreRows', { count: parsedRows.length - PREVIEW_LIMIT })}
                </p>
              )}
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <p className="text-sm font-medium text-popover-foreground">
                {result.partial ? t('importPartial') : t('importComplete')}
              </p>
              {result.partial && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('resultProcessed', {
                    processed: result.processed,
                    total: result.total,
                  })}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-3">
                {result.created > 0 && (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultCreated', { count: result.created })}
                  </div>
                )}
                {result.linkedExisting > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <Network className="size-4 shrink-0" />
                    {t('resultLinked', { count: result.linkedExisting })}
                  </div>
                )}
                {result.alreadyLinked > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultAlreadyLinked', { count: result.alreadyLinked })}
                  </div>
                )}
                {result.tagsAssigned > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-cyan-400">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultTags', { count: result.tagsAssigned })}
                  </div>
                )}
                {result.invalid + result.conflicts > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400">
                    <AlertTriangle className="size-4 shrink-0" />
                    {t('resultProblems', {
                      count: result.invalid + result.conflicts,
                    })}
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-400">
                    <XCircle className="size-4 shrink-0" />
                    {t('resultFailed', { count: result.failed })}
                  </div>
                )}
              </div>
              {result.issues.length > 0 && (
                <div className="mt-3 rounded-lg border border-border/70 bg-muted/35 p-3">
                  <p className="text-xs font-medium text-foreground">
                    {t('issuesTitle')}
                  </p>
                  <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                    {result.issues.slice(0, 8).map((issue) => (
                      <li key={`${issue.row}-${issue.status}`}>
                        {t('issueRow', { row: issue.row, error: issue.error })}
                      </li>
                    ))}
                  </ul>
                  {result.invalid + result.conflicts + result.failed > 8 && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {t('issuesMore', {
                        count:
                          result.invalid +
                          result.conflicts +
                          result.failed -
                          8,
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-0 shrink-0 gap-2 border-t border-border/80 bg-background/50 px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {result ? t('close') : t('cancel')}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={
                parsedRows.length === 0 ||
                !operationId ||
                importing ||
                operationsLoading
              }
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {parsedRows.length > 0 ? t('importBtn', { count: parsedRows.length }) : t('importBtn', { count: 0 })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
