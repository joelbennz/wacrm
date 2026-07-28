import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  Link2,
  PlugZap,
  RadioTower,
  WalletCards,
} from 'lucide-react';

import { getCurrentAccount } from '@/lib/auth/account';
import { formatCurrency } from '@/lib/currency';
import { ManualEntryPanel } from '@/components/command-center/manual-entry-panel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface ProjectRow {
  operation_id: string;
  name: string;
  project_type: string;
  status: string;
  obsidian_path: string | null;
  monthly_cost: number | string | null;
  target_monthly_revenue?: number | string | null;
  revenue_total: number | string | null;
  expense_total: number | string | null;
  net_total: number | string | null;
  last_financial_at: string | null;
}

interface OperationMetaRow {
  id: string;
  target_monthly_revenue: number | string | null;
}

interface EventRow {
  operation_id: string;
  events_total: number | string | null;
  leads_total: number | string | null;
  signups_total: number | string | null;
  payments_total: number | string | null;
  last_event_at: string | null;
}

interface SourceRow {
  id: string;
  operation_id: string | null;
  provider: string;
  name: string;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
}

function n(value: number | string | null | undefined): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    idea: 'Ideia',
    building: 'Em construção',
    active: 'Ativo',
    paused: 'Pausado',
    archived: 'Arquivado',
  };
  return labels[status] ?? status;
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    saas: 'SaaS',
    infoproduct: 'Infoproduto',
    client: 'Cliente',
    agency: 'Agência',
    campaign: 'Campanha',
    internal: 'Interno',
    project: 'Projeto',
  };
  return labels[type] ?? type;
}

function providerLabel(provider: string): string {
  return provider.replaceAll('_', ' ');
}

function paymentState(project: ProjectRow): {
  label: string;
  tone: 'paid' | 'partial' | 'unpaid' | 'unknown';
  outstanding: number | null;
} {
  const paid = n(project.revenue_total);
  const expected = n(project.target_monthly_revenue);

  if (paid <= 0) {
    return {
      label: 'Não pagou',
      tone: 'unpaid',
      outstanding: expected > 0 ? expected : null,
    };
  }

  if (expected > 0 && paid >= expected) {
    return { label: 'Pago', tone: 'paid', outstanding: 0 };
  }

  if (expected > 0 && paid < expected) {
    return {
      label: 'Pagou parcela',
      tone: 'partial',
      outstanding: expected - paid,
    };
  }

  return { label: 'Pagamento registado', tone: 'unknown', outstanding: null };
}

function paymentToneClass(
  tone: ReturnType<typeof paymentState>['tone']
): string {
  const classes = {
    paid: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    partial:
      'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    unpaid: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
    unknown: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  } as const;
  return classes[tone];
}

export default async function CommandCenterPage() {
  const ctx = await getCurrentAccount();

  const [projectsRes, operationMetaRes, eventsRes, sourcesRes] =
    await Promise.all([
      ctx.supabase
        .from('project_financial_summary')
        .select('*')
        .eq('account_id', ctx.accountId)
        .neq('status', 'archived')
        .order('status', { ascending: true })
        .order('name', { ascending: true }),
      ctx.supabase
        .from('operations')
        .select('id, target_monthly_revenue')
        .eq('account_id', ctx.accountId)
        .neq('status', 'archived'),
      ctx.supabase
        .from('project_event_summary')
        .select('*')
        .eq('account_id', ctx.accountId),
      ctx.supabase
        .from('integration_sources')
        .select(
          'id, operation_id, provider, name, status, last_sync_at, last_error'
        )
        .eq('account_id', ctx.accountId)
        .order('provider', { ascending: true }),
    ]);

  if (projectsRes.error) throw projectsRes.error;
  if (operationMetaRes.error) throw operationMetaRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (sourcesRes.error) throw sourcesRes.error;

  const operationMeta = new Map(
    ((operationMetaRes.data ?? []) as OperationMetaRow[]).map((row) => [
      row.id,
      row,
    ])
  );
  const projects = ((projectsRes.data ?? []) as ProjectRow[]).map(
    (project) => ({
      ...project,
      target_monthly_revenue: operationMeta.get(project.operation_id)
        ?.target_monthly_revenue,
    })
  );
  const events = (eventsRes.data ?? []) as EventRow[];
  const sources = (sourcesRes.data ?? []) as SourceRow[];
  const eventsByProject = new Map(events.map((row) => [row.operation_id, row]));

  const clients = projects.filter(
    (project) => project.project_type === 'client'
  );
  const ownAssets = projects.filter(
    (project) => project.project_type !== 'client'
  );
  const totalRevenue = projects.reduce((sum, p) => sum + n(p.revenue_total), 0);
  const clientRevenue = clients.reduce((sum, p) => sum + n(p.revenue_total), 0);
  const totalExpenses = projects.reduce(
    (sum, p) => sum + n(p.expense_total),
    0
  );
  const totalNet = projects.reduce((sum, p) => sum + n(p.net_total), 0);
  const totalLeads = events.reduce((sum, e) => sum + n(e.leads_total), 0);
  const clientPaymentCounts = clients.reduce(
    (counts, client) => {
      const state = paymentState(client);
      counts[state.tone] += 1;
      return counts;
    },
    { paid: 0, partial: 0, unpaid: 0, unknown: 0 }
  );
  const connectedSources = sources.filter(
    (s) => s.status === 'connected'
  ).length;
  const blockedSources = sources.filter(
    (s) => s.status === 'needs_credentials' || s.status === 'error'
  ).length;
  const projectOptions = projects.map((project) => ({
    id: project.operation_id,
    name:
      project.project_type === 'client'
        ? `Cliente · ${project.name}`
        : `${typeLabel(project.project_type)} · ${project.name}`,
    status: project.status,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">
            Centro de comando
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Ativos próprios separados dos clientes da agência, com eventos,
            cobranças e financeiro num só CRM.
          </p>
        </div>
        <Link
          href="/settings#api"
          className="border-border text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          Criar chave API <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ativos próprios</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <RadioTower className="text-primary h-5 w-5" /> {ownAssets.length}
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              Resultado geral: {formatCurrency(totalNet, 'AOA')}
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Clientes da agência</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <WalletCards className="h-5 w-5 text-amber-500" />{' '}
              {clients.length}
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              Receita de clientes: {formatCurrency(clientRevenue, 'AOA')}
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cobrança de clientes</CardDescription>
            <CardTitle className="text-2xl">
              {clientPaymentCounts.paid} pagos · {clientPaymentCounts.partial}{' '}
              parciais
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              {clientPaymentCounts.unpaid} sem pagamento ·{' '}
              {clientPaymentCounts.unknown} com pagamento sem valor fechado
            </p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Leads/eventos</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Activity className="h-5 w-5 text-sky-500" />{' '}
              {totalLeads.toLocaleString()}
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              Receita total {formatCurrency(totalRevenue, 'AOA')} · despesas{' '}
              {formatCurrency(totalExpenses, 'AOA')}
            </p>
          </CardHeader>
        </Card>
      </div>

      <ManualEntryPanel projects={projectOptions} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Clientes da agência</CardTitle>
            <CardDescription>
              Aqui entram clientes que contratam a Nexacos: quem já pagou, quem
              pagou uma parcela e quem ainda não tem pagamento registado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border-border overflow-hidden rounded-lg border">
              <div className="border-border bg-muted/50 text-muted-foreground grid grid-cols-12 gap-3 border-b px-3 py-2 text-xs font-medium tracking-wide uppercase">
                <span className="col-span-4">Cliente</span>
                <span className="col-span-2">Pagamento</span>
                <span className="col-span-2 text-right">Recebido</span>
                <span className="col-span-2 text-right">Em falta</span>
                <span className="col-span-2 text-right">Eventos</span>
              </div>
              {clients.length === 0 ? (
                <div className="text-muted-foreground px-3 py-8 text-center text-sm">
                  Ainda não há clientes mapeados. Clientes da agência devem ser
                  marcados como tipo “Cliente”.
                </div>
              ) : (
                clients.map((client) => {
                  const event = eventsByProject.get(client.operation_id);
                  const state = paymentState(client);
                  return (
                    <div
                      key={client.operation_id}
                      className="border-border grid grid-cols-12 gap-3 border-b px-3 py-3 text-sm last:border-b-0"
                    >
                      <div className="col-span-4 min-w-0">
                        <div className="text-foreground truncate font-medium">
                          {client.name}
                        </div>
                        {client.obsidian_path && (
                          <div className="text-muted-foreground mt-1 flex items-center gap-1 truncate text-xs">
                            <Link2 className="h-3 w-3" /> {client.obsidian_path}
                          </div>
                        )}
                      </div>
                      <span className="col-span-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${paymentToneClass(state.tone)}`}
                        >
                          {state.label}
                        </span>
                      </span>
                      <span className="text-foreground col-span-2 text-right">
                        {formatCurrency(n(client.revenue_total), 'AOA')}
                      </span>
                      <span className="text-muted-foreground col-span-2 text-right">
                        {state.outstanding === null
                          ? '—'
                          : formatCurrency(state.outstanding, 'AOA')}
                      </span>
                      <span className="text-muted-foreground col-span-2 text-right">
                        {n(event?.events_total).toLocaleString()}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              Nota: para classificar “pago” vs “pagou parcela” com precisão, o
              cliente precisa ter um valor contratado/meta registado. Sem isso,
              o CRM mostra “pagamento registado”.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conectores</CardTitle>
            <CardDescription>
              {connectedSources} ligados · {blockedSources} a pedir
              credenciais/configuração
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sources.length === 0 ? (
              <div className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                Ainda sem conectores. O primeiro sync cria Obsidian,
                Meta/WhatsApp, SaaS API e financeiro manual.
              </div>
            ) : (
              sources.map((source) => (
                <div
                  key={source.id}
                  className="border-border rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-foreground truncate text-sm font-medium">
                        {source.name}
                      </div>
                      <div className="text-muted-foreground truncate text-xs capitalize">
                        {providerLabel(source.provider)}
                      </div>
                    </div>
                    <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
                      {source.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  {source.last_error && (
                    <p className="text-destructive mt-2 text-xs">
                      {source.last_error}
                    </p>
                  )}
                </div>
              ))
            )}
            <div className="bg-muted/50 text-muted-foreground rounded-lg p-3 text-xs">
              <PlugZap className="mb-2 h-4 w-4" />
              Próximos conectores reais: Meta token permanente, VagaCertus API,
              QuantTradeAI eventos, pagamentos/receitas.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ativos próprios / empresas minhas</CardTitle>
          <CardDescription>
            SaaS, infoprodutos, campanhas e estruturas internas ficam separados
            dos clientes que contratam serviços.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border-border overflow-hidden rounded-lg border">
            <div className="border-border bg-muted/50 text-muted-foreground grid grid-cols-12 gap-3 border-b px-3 py-2 text-xs font-medium tracking-wide uppercase">
              <span className="col-span-4">Ativo</span>
              <span className="col-span-2">Tipo</span>
              <span className="col-span-2">Status</span>
              <span className="col-span-2 text-right">Resultado</span>
              <span className="col-span-2 text-right">Eventos</span>
            </div>
            {ownAssets.length === 0 ? (
              <div className="text-muted-foreground px-3 py-8 text-center text-sm">
                Ainda não há ativos próprios mapeados.
              </div>
            ) : (
              ownAssets.map((asset) => {
                const event = eventsByProject.get(asset.operation_id);
                return (
                  <div
                    key={asset.operation_id}
                    className="border-border grid grid-cols-12 gap-3 border-b px-3 py-3 text-sm last:border-b-0"
                  >
                    <div className="col-span-4 min-w-0">
                      <div className="text-foreground truncate font-medium">
                        {asset.name}
                      </div>
                      {asset.obsidian_path && (
                        <div className="text-muted-foreground mt-1 flex items-center gap-1 truncate text-xs">
                          <Link2 className="h-3 w-3" /> {asset.obsidian_path}
                        </div>
                      )}
                    </div>
                    <span className="text-muted-foreground col-span-2">
                      {typeLabel(asset.project_type)}
                    </span>
                    <span className="text-muted-foreground col-span-2">
                      {statusLabel(asset.status)}
                    </span>
                    <span className="text-foreground col-span-2 text-right">
                      {formatCurrency(n(asset.net_total), 'AOA')}
                    </span>
                    <span className="text-muted-foreground col-span-2 text-right">
                      {n(event?.events_total).toLocaleString()}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
