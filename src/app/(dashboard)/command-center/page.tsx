import Link from 'next/link';
import {
  Activity,
  ArrowUpRight,
  CircleDollarSign,
  Link2,
  PlugZap,
  RadioTower,
} from 'lucide-react';

import { getCurrentAccount } from '@/lib/auth/account';
import { formatCurrency } from '@/lib/currency';
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
  revenue_total: number | string | null;
  expense_total: number | string | null;
  net_total: number | string | null;
  last_financial_at: string | null;
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

export default async function CommandCenterPage() {
  const ctx = await getCurrentAccount();

  const [projectsRes, eventsRes, sourcesRes] = await Promise.all([
    ctx.supabase
      .from('project_financial_summary')
      .select('*')
      .eq('account_id', ctx.accountId)
      .neq('status', 'archived')
      .order('status', { ascending: true })
      .order('name', { ascending: true }),
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
  if (eventsRes.error) throw eventsRes.error;
  if (sourcesRes.error) throw sourcesRes.error;

  const projects = (projectsRes.data ?? []) as ProjectRow[];
  const events = (eventsRes.data ?? []) as EventRow[];
  const sources = (sourcesRes.data ?? []) as SourceRow[];
  const eventsByProject = new Map(events.map((row) => [row.operation_id, row]));

  const totalRevenue = projects.reduce((sum, p) => sum + n(p.revenue_total), 0);
  const totalExpenses = projects.reduce(
    (sum, p) => sum + n(p.expense_total),
    0
  );
  const totalNet = projects.reduce((sum, p) => sum + n(p.net_total), 0);
  const totalLeads = events.reduce((sum, e) => sum + n(e.leads_total), 0);
  const connectedSources = sources.filter(
    (s) => s.status === 'connected'
  ).length;
  const blockedSources = sources.filter(
    (s) => s.status === 'needs_credentials' || s.status === 'error'
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">
            Centro de comando
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Projetos, SaaS, clientes, eventos e financeiro num só CRM —
            alimentado por APIs e pelo Obsidian.
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
            <CardDescription>Projetos mapeados</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <RadioTower className="text-primary h-5 w-5" /> {projects.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Receita confirmada</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <CircleDollarSign className="h-5 w-5 text-emerald-500" />{' '}
              {formatCurrency(totalRevenue, 'AOA')}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Resultado líquido</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totalNet, 'AOA')}
            </CardTitle>
            <p className="text-muted-foreground text-xs">
              Despesas registadas: {formatCurrency(totalExpenses, 'AOA')}
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
          </CardHeader>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Projetos no CRM</CardTitle>
            <CardDescription>
              Base central para todos os teus negócios: SaaS, clientes,
              campanhas e infoprodutos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border-border overflow-hidden rounded-lg border">
              <div className="border-border bg-muted/50 text-muted-foreground grid grid-cols-12 gap-3 border-b px-3 py-2 text-xs font-medium tracking-wide uppercase">
                <span className="col-span-4">Projeto</span>
                <span className="col-span-2">Tipo</span>
                <span className="col-span-2">Status</span>
                <span className="col-span-2 text-right">Receita</span>
                <span className="col-span-2 text-right">Eventos</span>
              </div>
              {projects.length === 0 ? (
                <div className="text-muted-foreground px-3 py-8 text-center text-sm">
                  Ainda não há projetos. Corre o sync do Obsidian ou cria
                  projetos pela API.
                </div>
              ) : (
                projects.map((project) => {
                  const event = eventsByProject.get(project.operation_id);
                  return (
                    <div
                      key={project.operation_id}
                      className="border-border grid grid-cols-12 gap-3 border-b px-3 py-3 text-sm last:border-b-0"
                    >
                      <div className="col-span-4 min-w-0">
                        <div className="text-foreground truncate font-medium">
                          {project.name}
                        </div>
                        {project.obsidian_path && (
                          <div className="text-muted-foreground mt-1 flex items-center gap-1 truncate text-xs">
                            <Link2 className="h-3 w-3" />{' '}
                            {project.obsidian_path}
                          </div>
                        )}
                      </div>
                      <span className="text-muted-foreground col-span-2">
                        {typeLabel(project.project_type)}
                      </span>
                      <span className="text-muted-foreground col-span-2">
                        {statusLabel(project.status)}
                      </span>
                      <span className="text-foreground col-span-2 text-right">
                        {formatCurrency(n(project.revenue_total), 'AOA')}
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
    </div>
  );
}
