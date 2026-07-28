'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Building2,
  Globe,
  Loader2,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import type { Company } from '@/types';

export default function CompaniesPage() {
  const t = useTranslations('Companies');
  const canEdit = useCan('send-messages');
  const canDelete = useCan('edit-settings');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [contactCounts, setContactCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/account/companies', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('toastLoadFailed'));
      const list = (payload.companies ?? []) as Company[];
      setCompanies(list);

      if (list.length > 0) {
        const supabase = createClient();
        const { data } = await supabase
          .from('contacts')
          .select('company_id')
          .in(
            'company_id',
            list.map((c) => c.id)
          );
        const counts: Record<string, number> = {};
        for (const row of (data ?? []) as { company_id: string | null }[]) {
          if (!row.company_id) continue;
          counts[row.company_id] = (counts[row.company_id] ?? 0) + 1;
        }
        setContactCounts(counts);
      } else {
        setContactCounts({});
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/account/companies/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('toastDeleteFailed'));
      setCompanies((current) => current.filter((c) => c.id !== deleteTarget.id));
      toast.success(t('toastDeleted', { name: deleteTarget.name }));
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toastDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <GatedButton
          canAct={canEdit}
          gateReason="create companies"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          {t('newCompany')}
        </GatedButton>
      </div>

      <div className="relative w-full max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="pl-8"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <Building2 className="size-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">
            {companies.length === 0 ? t('emptyTitle') : t('noMatchTitle')}
          </p>
          {companies.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{t('emptyHint')}</p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.name')}</TableHead>
                <TableHead>{t('columns.industry')}</TableHead>
                <TableHead>{t('columns.details')}</TableHead>
                <TableHead>{t('columns.contacts')}</TableHead>
                <TableHead className="text-right">{t('columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((company) => (
                <TableRow key={company.id}>
                  <TableCell className="font-medium text-foreground">
                    {company.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {company.industry || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="flex flex-col gap-0.5 text-xs">
                      {company.website && (
                        <span className="inline-flex items-center gap-1">
                          <Globe className="size-3" />
                          {company.website}
                        </span>
                      )}
                      {company.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3" />
                          {company.phone}
                        </span>
                      )}
                      {!company.website && !company.phone && '—'}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {contactCounts[company.id] ?? 0}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!canEdit}
                        onClick={() => {
                          setEditing(company);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={!canDelete}
                        className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        onClick={() => setDeleteTarget(company)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CompanyFormDialog
        open={formOpen}
        company={editing}
        onOpenChange={setFormOpen}
        onSaved={(saved) => {
          setCompanies((current) => {
            const exists = current.some((c) => c.id === saved.id);
            return exists
              ? current.map((c) => (c.id === saved.id ? saved : c))
              : [...current, saved].sort((a, b) => a.name.localeCompare(b.name));
          });
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {deleteTarget && t('deleteDesc', { name: deleteTarget.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CompanyFormDialog({
  open,
  company,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  company: Company | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (company: Company) => void;
}) {
  const t = useTranslations('Companies');
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(company?.name ?? '');
    setIndustry(company?.industry ?? '');
    setWebsite(company?.website ?? '');
    setPhone(company?.phone ?? '');
    setNotes(company?.notes ?? '');
  }, [open, company]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        company ? `/api/account/companies/${company.id}` : '/api/account/companies',
        {
          method: company ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmed,
            industry: industry.trim() || null,
            website: website.trim() || null,
            phone: phone.trim() || null,
            notes: notes.trim() || null,
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('toastSaveFailed'));
      onSaved(payload.company as Company);
      onOpenChange(false);
      toast.success(company ? t('toastUpdated') : t('toastCreated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toastSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{company ? t('editTitle') : t('createTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">{t('nameLabel')}</Label>
            <Input
              id="company-name"
              value={name}
              maxLength={160}
              placeholder={t('namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-industry">{t('industryLabel')}</Label>
            <Input
              id="company-industry"
              value={industry}
              maxLength={80}
              placeholder={t('industryPlaceholder')}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="company-website">{t('websiteLabel')}</Label>
              <Input
                id="company-website"
                value={website}
                maxLength={255}
                placeholder="https://…"
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-phone">{t('phoneLabel')}</Label>
              <Input
                id="company-phone"
                value={phone}
                maxLength={50}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-notes">{t('notesLabel')}</Label>
            <Textarea
              id="company-notes"
              value={notes}
              maxLength={5000}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {company ? t('saveChanges') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
