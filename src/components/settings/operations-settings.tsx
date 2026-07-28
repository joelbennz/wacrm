'use client';

import { useCallback, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Loader2, Network, Pencil, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import type { Operation } from '@/types';

const DEFAULT_COLOR = '#3b82f6';

export function OperationsSettings() {
  const t = useTranslations('Settings.operations');
  const { canEditSettings } = useAuth();
  const [operations, setOperations] = useState<Operation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Operation | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/account/operations', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('loadFailed'));
      setOperations((payload.operations ?? []) as Operation[]);
    } catch (error) {
      console.error('[OperationsSettings] load:', error);
      toast.error(error instanceof Error ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(operation: Operation) {
    setEditing(operation);
    setDialogOpen(true);
  }

  async function toggleArchived(operation: Operation) {
    setSavingId(operation.id);
    try {
      const response = await fetch(`/api/account/operations/${operation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !operation.is_active }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('saveFailed'));
      setOperations((current) =>
        current.map((item) => (item.id === operation.id ? payload.operation : item))
      );
      toast.success(
        operation.is_active
          ? t('archiveSuccess', { name: operation.name })
          : t('restoreSuccess', { name: operation.name })
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveFailed'));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title={t('title')}
        description={t('description')}
        action={
          canEditSettings ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t('newOperation')}
            </Button>
          ) : undefined
        }
      />

      {operations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Network className="size-7 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium text-foreground">{t('emptyTitle')}</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {canEditSettings ? t('emptyAdminHint') : t('emptyMemberHint')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {operations.map((operation) => (
                <li
                  key={operation.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <span
                    className="size-3 shrink-0 rounded-full ring-2 ring-background"
                    style={{ backgroundColor: operation.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={`truncate text-sm font-medium ${
                          operation.is_active ? 'text-foreground' : 'text-muted-foreground'
                        }`}
                      >
                        {operation.name}
                      </p>
                      {!operation.is_active && (
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {t('archived')}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {operation.is_active ? t('activeHint') : t('archivedHint')}
                    </p>
                  </div>
                  {canEditSettings && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEdit(operation)}>
                        <Pencil className="size-3.5" />
                        {t('edit')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={savingId === operation.id}
                        onClick={() => void toggleArchived(operation)}
                      >
                        {savingId === operation.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : operation.is_active ? (
                          <Archive className="size-3.5" />
                        ) : (
                          <ArchiveRestore className="size-3.5" />
                        )}
                        {operation.is_active ? t('archive') : t('restore')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <OperationDialog
        open={dialogOpen}
        operation={editing}
        onOpenChange={setDialogOpen}
        onSaved={(saved) => {
          setOperations((current) => {
            const exists = current.some((item) => item.id === saved.id);
            return exists
              ? current.map((item) => (item.id === saved.id ? saved : item))
              : [saved, ...current];
          });
        }}
      />
    </section>
  );
}

function OperationDialog({
  open,
  operation,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  operation: Operation | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (operation: Operation) => void;
}) {
  const t = useTranslations('Settings.operations');
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(operation?.name ?? '');
    setColor(operation?.color ?? DEFAULT_COLOR);
  }, [open, operation]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        operation ? `/api/account/operations/${operation.id}` : '/api/account/operations',
        {
          method: operation ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed, color }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('saveFailed'));
      onSaved(payload.operation as Operation);
      onOpenChange(false);
      toast.success(operation ? t('updateSuccess') : t('createSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{operation ? t('editTitle') : t('createTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="operation-name">{t('nameLabel')}</Label>
            <Input
              id="operation-name"
              value={name}
              maxLength={80}
              placeholder={t('namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="operation-color">{t('colorLabel')}</Label>
            <div className="flex items-center gap-3">
              <Input
                id="operation-color"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-10 w-16 cursor-pointer p-1"
              />
              <code className="text-xs text-muted-foreground">{color}</code>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {operation ? t('saveChanges') : t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
