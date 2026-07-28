'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, CircleDollarSign, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface CommandCenterProjectOption {
  id: string;
  name: string;
  status: string;
}

interface ManualEntryPanelProps {
  projects: CommandCenterProjectOption[];
}

const eventTypes = [
  { value: 'lead', label: 'Lead' },
  { value: 'message', label: 'Mensagem' },
  { value: 'payment', label: 'Pagamento' },
  { value: 'campaign', label: 'Campanha' },
  { value: 'product_usage', label: 'Uso do produto' },
  { value: 'note', label: 'Nota' },
  { value: 'other', label: 'Outro' },
];

const financeKinds = [
  { value: 'revenue', label: 'Receita' },
  { value: 'expense', label: 'Despesa' },
  { value: 'refund', label: 'Reembolso' },
  { value: 'payout', label: 'Saque/Payout' },
  { value: 'adjustment', label: 'Ajuste' },
];

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function toIsoFromDateInput(
  value: FormDataEntryValue | null
): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  return new Date(`${value}T12:00:00`).toISOString();
}

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? 'Falha ao guardar lançamento');
  }
  return payload;
}

export function ManualEntryPanel({ projects }: ManualEntryPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [eventMessage, setEventMessage] = useState<string | null>(null);
  const [financeMessage, setFinanceMessage] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [eventKey, setEventKey] = useState(0);
  const [financeKey, setFinanceKey] = useState(0);

  const defaultProjectId = useMemo(() => projects[0]?.id ?? '', [projects]);
  const disabled = projects.length === 0 || isPending;

  function handleEventSubmit(formData: FormData) {
    setEventError(null);
    setEventMessage(null);

    const operationId = String(formData.get('operationId') ?? '');
    const eventName = String(formData.get('eventName') ?? '').trim();
    const eventType = String(formData.get('eventType') ?? 'note');
    const notes = String(formData.get('notes') ?? '').trim();
    const valueRaw = String(formData.get('value') ?? '').trim();

    if (!operationId || !eventName) {
      setEventError('Escolhe um projeto e escreve o nome do evento.');
      return;
    }

    startTransition(async () => {
      try {
        await postJson('/api/account/command-center/events', {
          operationId,
          eventType,
          eventName,
          value: valueRaw ? Number(valueRaw) : null,
          currency: valueRaw ? 'AOA' : null,
          occurredAt: toIsoFromDateInput(formData.get('occurredAt')),
          payload: notes ? { notes } : {},
        });
        setEventMessage('Evento guardado.');
        setEventKey((key) => key + 1);
        router.refresh();
      } catch (err) {
        setEventError(
          err instanceof Error ? err.message : 'Falha ao guardar evento.'
        );
      }
    });
  }

  function handleFinanceSubmit(formData: FormData) {
    setFinanceError(null);
    setFinanceMessage(null);

    const operationId = String(formData.get('operationId') ?? '');
    const kind = String(formData.get('kind') ?? 'revenue');
    const amount = Number(formData.get('amount') ?? 0);
    const description = String(formData.get('description') ?? '').trim();
    const notes = String(formData.get('notes') ?? '').trim();

    if (
      !operationId ||
      !description ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      setFinanceError(
        'Escolhe um projeto, descreve o lançamento e usa um valor positivo.'
      );
      return;
    }

    startTransition(async () => {
      try {
        await postJson('/api/account/command-center/finance', {
          operationId,
          kind,
          amount,
          currency: 'AOA',
          description,
          occurredAt: toIsoFromDateInput(formData.get('occurredAt')),
          payload: notes ? { notes } : {},
        });
        setFinanceMessage('Lançamento financeiro guardado.');
        setFinanceKey((key) => key + 1);
        router.refresh();
      } catch (err) {
        setFinanceError(
          err instanceof Error ? err.message : 'Falha ao guardar lançamento.'
        );
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-sky-500" /> Lançar evento
          </CardTitle>
          <CardDescription>
            Regista manualmente leads, notas, campanhas, pagamentos ou marcos
            enquanto os conectores automáticos não entram.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form key={eventKey} action={handleEventSubmit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="event-operation">Projeto</Label>
                <select
                  id="event-operation"
                  name="operationId"
                  defaultValue={defaultProjectId}
                  disabled={disabled}
                  className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm disabled:opacity-50"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-type">Tipo</Label>
                <select
                  id="event-type"
                  name="eventType"
                  defaultValue="note"
                  disabled={disabled}
                  className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm disabled:opacity-50"
                >
                  {eventTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-name">Nome do evento</Label>
              <Input
                id="event-name"
                name="eventName"
                placeholder="Ex.: Lead vindo do Instagram"
                disabled={disabled}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="event-value">Valor opcional (AOA)</Label>
                <Input
                  id="event-value"
                  name="value"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-date">Data</Label>
                <Input
                  id="event-date"
                  name="occurredAt"
                  type="date"
                  defaultValue={todayDateInput()}
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-notes">Notas</Label>
              <Textarea
                id="event-notes"
                name="notes"
                placeholder="Contexto, origem, próximos passos…"
                disabled={disabled}
              />
            </div>

            {eventError && (
              <p className="text-destructive text-sm">{eventError}</p>
            )}
            {eventMessage && (
              <p className="text-sm text-emerald-500">{eventMessage}</p>
            )}
            <Button type="submit" disabled={disabled}>
              {isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Guardar evento
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 text-emerald-500" /> Lançar
            financeiro
          </CardTitle>
          <CardDescription>
            Regista receitas, despesas, reembolsos e payouts por projeto. Isto
            já alimenta o resultado líquido do Command Center.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            key={financeKey}
            action={handleFinanceSubmit}
            className="space-y-3"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="finance-operation">Projeto</Label>
                <select
                  id="finance-operation"
                  name="operationId"
                  defaultValue={defaultProjectId}
                  disabled={disabled}
                  className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm disabled:opacity-50"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="finance-kind">Tipo</Label>
                <select
                  id="finance-kind"
                  name="kind"
                  defaultValue="revenue"
                  disabled={disabled}
                  className="border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm disabled:opacity-50"
                >
                  {financeKinds.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="finance-description">Descrição</Label>
              <Input
                id="finance-description"
                name="description"
                placeholder="Ex.: 1ª prestação Guindapa"
                disabled={disabled}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="finance-amount">Valor (AOA)</Label>
                <Input
                  id="finance-amount"
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="finance-date">Data</Label>
                <Input
                  id="finance-date"
                  name="occurredAt"
                  type="date"
                  defaultValue={todayDateInput()}
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="finance-notes">Notas</Label>
              <Textarea
                id="finance-notes"
                name="notes"
                placeholder="Meio de pagamento, comprovativo, observações…"
                disabled={disabled}
              />
            </div>

            {financeError && (
              <p className="text-destructive text-sm">{financeError}</p>
            )}
            {financeMessage && (
              <p className="text-sm text-emerald-500">{financeMessage}</p>
            )}
            <Button type="submit" disabled={disabled}>
              {isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Guardar financeiro
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
