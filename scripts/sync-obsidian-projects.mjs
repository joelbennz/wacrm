#!/usr/bin/env node
/*
 * Sync Joel's Obsidian project map into the CRM command center.
 *
 * Source vault: C:\Users\Joel Bennz\Documents\Cérebro
 * Writes only CRM rows: operations, integration_sources, project_events,
 * financial_transactions. Secrets are never read from Obsidian.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env.local');
const OWNER_EMAIL = process.env.CRM_OWNER_EMAIL ?? 'joel.ricardo2012@gmail.com';

function parseEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...parseEnv(ENV_PATH), ...process.env };
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
  );
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const projects = [
  {
    name: 'Nexacos Intelligence',
    type: 'agency',
    status: 'active',
    color: '#f59e0b',
    revenueModel:
      'Serviços de marketing, sites, landing pages, redes sociais e consultoria',
    obsidianPath:
      'Meu Cérebro/Projetos/Nexacos Intelligence/Nexacos Intelligence.md',
    metadata: {
      segment: 'marketing digital e automação',
      role: 'empresa principal',
      usefulNotes: [
        'Meu Cérebro/Projetos/Clientes.md',
        'Meu Cérebro/Projetos/Sistemas/Sistemas e Sites.md',
        'Meu Cérebro/Projetos/Nexacos Intelligence/Conversas Nexacos.md',
      ],
    },
    connectors: ['obsidian', 'manual'],
  },
  {
    name: 'VagaCertus',
    type: 'saas',
    status: 'active',
    color: '#2563eb',
    revenueModel: 'SaaS de currículos, vagas, pedidos e templates',
    obsidianPath: 'Meu Cérebro/Projects/VagaCertus/Redesign 2026.md',
    metadata: {
      aliases: ['Vaga Certa', 'VagaCertus'],
      stack: ['React', 'Vite', 'Tailwind'],
      metricsToSync: [
        'MRR',
        'pedidos',
        'leads',
        'receitas',
        'planos',
        'pagamentos',
      ],
      plannedPaymentProvider: 'ProxyPay',
    },
    connectors: ['obsidian', 'saas_api', 'webhook', 'multicaixa'],
  },
  {
    name: 'QuantTradeAI',
    type: 'saas',
    status: 'active',
    color: '#10b981',
    revenueModel:
      'Trading intelligence, sinais, referrals Binance e automações',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Estratégia de agentes de IA com CRM integrado.md',
    metadata: {
      aliases: ['crypto-wise'],
      metricsToSync: [
        'users',
        'signals',
        'trades',
        'referrals',
        'revenue',
        'subscriptions',
      ],
      plannedConnectors: ['Binance Square', 'Telegram', 'SaaS API'],
    },
    connectors: ['obsidian', 'saas_api', 'webhook', 'other'],
  },
  {
    name: 'concursando.ao',
    type: 'infoproduct',
    status: 'active',
    color: '#7c3aed',
    revenueModel: 'Conteúdo/infoproduto para concursos públicos em Angola',
    obsidianPath: 'Meu Cérebro/Projetos/Infoprodutos/Infoprodutos.md',
    metadata: {
      painAngle: 'estabilidade da família, medo de perder a janela do concurso',
      channels: ['Instagram', 'WhatsApp', 'landing pages'],
      metricsToSync: ['leads', 'conversions', 'sales', 'campaign ROI'],
    },
    connectors: ['obsidian', 'meta', 'whatsapp', 'instagram', 'facebook_ads'],
  },
  {
    name: 'Kiki.ao',
    type: 'project',
    status: 'active',
    color: '#ec4899',
    revenueModel: 'Checkout/pagamentos e entrega para infoprodutos/projetos',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Usando Cakto para produtor de conteúdo internacional.md',
    metadata: {
      role: 'plataforma/integração de checkout em vários projetos',
      metricsToSync: ['pagamentos', 'checkout', 'vendas', 'entregas'],
    },
    connectors: ['obsidian', 'webhook', 'manual'],
  },
  {
    name: 'Trans Valoré',
    type: 'client',
    status: 'building',
    color: '#64748b',
    revenueModel: 'Site institucional',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Site institucional para TRANS-VALORÉ.md',
    metadata: { service: 'site institucional', source: 'Nexacos' },
    finance: [
      {
        kind: 'revenue',
        amount: 100000,
        currency: 'AOA',
        description: 'Entrada registada nas notas de junho',
      },
    ],
    connectors: ['obsidian', 'manual'],
  },
  {
    name: 'Guindapa',
    type: 'client',
    status: 'building',
    color: '#22c55e',
    revenueModel: 'Site institucional + gestão/redes sociais',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Orçamento Guindapa- site institucional e gestão de redes sociais.md',
    websiteUrl: 'https://www.guindapa.com',
    metadata: {
      domain: 'www.guindapa.com',
      stack: ['Hostinger', 'Vercel'],
      service: 'site + gestão',
    },
    finance: [
      {
        kind: 'revenue',
        amount: 250000,
        currency: 'AOA',
        description: 'Primeira parcela registada nas notas',
      },
    ],
    connectors: ['obsidian', 'manual'],
  },
  {
    name: 'Paladar do Patriota',
    type: 'client',
    status: 'idea',
    color: '#ef4444',
    revenueModel:
      'Landing page, gestão de redes sociais e vídeos publicitários',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Novo cliente Paladar do Patriota.md',
    metadata: {
      proposedValues: {
        landingPageFrom: 70000,
        videosFrom: 25000,
        socialPackages: [30000, 70000, 150000],
      },
    },
    connectors: ['obsidian', 'manual', 'meta', 'instagram'],
  },
  {
    name: 'Começa Ebook',
    type: 'client',
    status: 'building',
    color: '#a855f7',
    revenueModel:
      'Plataforma de ebooks/e-commerce com pagamento e entrega automática',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Começa Ebook - novo cliente Notion.md',
    metadata: {
      person: 'Dona Luíza',
      payment: 'Kiki',
      suggestedRangeAoa: [250000, 450000],
    },
    finance: [
      {
        kind: 'revenue',
        amount: 1620000,
        currency: 'AOA',
        description: 'Primeira prestação mencionada nas notas',
      },
    ],
    connectors: ['obsidian', 'manual', 'webhook'],
  },
  {
    name: 'Geladinhos Gourmets',
    type: 'infoproduct',
    status: 'active',
    color: '#06b6d4',
    revenueModel: 'Funil/landing/checkout para ebook de receitas',
    obsidianPath: 'Meu Cérebro/Projetos/Clientes.md',
    metadata: {
      product: 'ebook de receitas',
      integrations: ['Kiki/checkout', 'Vercel'],
    },
    connectors: ['obsidian', 'manual', 'webhook'],
  },
  {
    name: 'Klienti',
    type: 'saas',
    status: 'active',
    color: '#14b8a6',
    revenueModel: 'CRM/micro SaaS de gestão de clientes em tempo real',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Micro SaaS de gestão de clientes em tempo real.md',
    metadata: {
      needsClarification: 'Distinguir produto próprio vs cliente externo',
    },
    connectors: ['obsidian', 'saas_api', 'webhook'],
  },
  {
    name: 'Mundo da Preciosa',
    type: 'client',
    status: 'building',
    color: '#f97316',
    revenueModel: 'Site institucional para eventos/casamentos/catering',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Site institucional para empresa de casamentos.md',
    metadata: {
      sector: 'eventos/casamentos/catering',
      packages: ['Essencial', 'Clássico', 'Premium', 'Diamante'],
    },
    connectors: ['obsidian', 'manual'],
  },
  {
    name: 'Nexacos Eco Clean',
    type: 'client',
    status: 'building',
    color: '#84cc16',
    revenueModel: 'Projeto/parceria de limpeza',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Página Notion para Nexacos Eco Clean.md',
    metadata: { partner: 'Ary Dallas' },
    finance: [
      {
        kind: 'expense',
        amount: -82500,
        currency: 'AOA',
        description: 'Equipamentos mencionados nas notas',
      },
      {
        kind: 'expense',
        amount: -100000,
        currency: 'AOA',
        description: 'Percentagem/formação Ary mencionada nas notas',
      },
    ],
    connectors: ['obsidian', 'manual'],
  },
  {
    name: 'Bennz Fit',
    type: 'saas',
    status: 'paused',
    color: '#f43f5e',
    revenueModel: 'Micro SaaS fitness para Angola',
    obsidianPath:
      'Meu Cérebro/Claude Chat/2026-06-30 - Bennz Fit SaaS para Angola com Google AI Studio.md',
    metadata: { note: 'Aparece como ideia/protótipo e adiado em Infoprodutos' },
    connectors: ['obsidian', 'saas_api'],
  },
  {
    name: 'Ebook Imigração Angola',
    type: 'infoproduct',
    status: 'active',
    color: '#0ea5e9',
    revenueModel: 'Ebook/guia de imigração',
    obsidianPath: 'Meu Cérebro/Projetos/Infoprodutos/Infoprodutos.md',
    metadata: {
      productLine: 'infoprodutos',
      platformsConsidered: ['Hotmart', 'Kiwify', 'Cakto', 'Kiki'],
    },
    connectors: ['obsidian', 'manual', 'webhook'],
  },
];

async function firstData(query, label) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function resolveOwner() {
  let profile = null;
  const { data: byEmail } = await db
    .from('profiles')
    .select('user_id, account_id, email, full_name')
    .eq('email', OWNER_EMAIL)
    .maybeSingle();
  profile = byEmail;

  if (!profile) {
    const rows = await firstData(
      db
        .from('profiles')
        .select('user_id, account_id, email, full_name')
        .limit(1),
      'load profiles'
    );
    profile = rows?.[0];
  }
  if (!profile?.account_id || !profile?.user_id) {
    throw new Error('Could not resolve CRM owner/account from profiles');
  }
  return profile;
}

async function upsertByExisting(
  table,
  find,
  insertPayload,
  updatePayload = insertPayload
) {
  const { data: existing, error: findError } = await find.maybeSingle();
  if (findError)
    throw new Error(`${table} lookup failed: ${findError.message}`);
  if (existing?.id) {
    const { data, error } = await db
      .from(table)
      .update(updatePayload)
      .eq('id', existing.id)
      .select('id')
      .single();
    if (error) throw new Error(`${table} update failed: ${error.message}`);
    return data.id;
  }
  const { data, error } = await db
    .from(table)
    .insert(insertPayload)
    .select('id')
    .single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  return data.id;
}

async function main() {
  const owner = await resolveOwner();
  const accountId = owner.account_id;
  const userId = owner.user_id;

  const operationIds = new Map();

  for (const project of projects) {
    const operationPayload = {
      account_id: accountId,
      created_by: userId,
      name: project.name,
      color: project.color,
      is_active: project.status !== 'archived',
      project_type: project.type,
      status: project.status,
      revenue_model: project.revenueModel,
      obsidian_path: project.obsidianPath,
      website_url: project.websiteUrl ?? null,
      repository_url: project.repositoryUrl ?? null,
      metadata: project.metadata ?? {},
    };

    const opId = await upsertByExisting(
      'operations',
      db
        .from('operations')
        .select('id')
        .eq('account_id', accountId)
        .ilike('name', project.name),
      operationPayload,
      operationPayload
    );
    operationIds.set(project.name, opId);

    for (const provider of project.connectors ?? ['obsidian']) {
      const externalId =
        provider === 'obsidian'
          ? project.obsidianPath
          : `${project.name}:${provider}`;
      await upsertByExisting(
        'integration_sources',
        db
          .from('integration_sources')
          .select('id')
          .eq('account_id', accountId)
          .eq('provider', provider)
          .eq('external_id', externalId),
        {
          account_id: accountId,
          operation_id: opId,
          provider,
          name:
            provider === 'obsidian'
              ? `Obsidian · ${project.name}`
              : `${provider} · ${project.name}`,
          external_id: externalId,
          status:
            provider === 'obsidian' || provider === 'manual'
              ? 'connected'
              : 'needs_credentials',
          sync_direction: provider === 'obsidian' ? 'bidirectional' : 'inbound',
          last_sync_at:
            provider === 'obsidian' ? new Date().toISOString() : null,
          config:
            provider === 'obsidian'
              ? { vault: 'Cérebro', path: project.obsidianPath }
              : {},
          created_by: userId,
        }
      );
    }

    await upsertByExisting(
      'project_events',
      db
        .from('project_events')
        .select('id')
        .eq('account_id', accountId)
        .eq('operation_id', opId)
        .eq('external_id', `obsidian-sync:${project.obsidianPath}`),
      {
        account_id: accountId,
        operation_id: opId,
        event_type: 'note',
        event_name: 'Projeto sincronizado do Obsidian',
        external_id: `obsidian-sync:${project.obsidianPath}`,
        occurred_at: new Date().toISOString(),
        payload: {
          obsidian_path: project.obsidianPath,
          source: 'sync-obsidian-projects',
        },
      }
    );

    for (const tx of project.finance ?? []) {
      await upsertByExisting(
        'financial_transactions',
        db
          .from('financial_transactions')
          .select('id')
          .eq('account_id', accountId)
          .eq('operation_id', opId)
          .eq(
            'external_id',
            `obsidian-finance:${project.name}:${tx.description}`
          ),
        {
          account_id: accountId,
          operation_id: opId,
          kind: tx.kind,
          status: 'confirmed',
          amount: tx.amount,
          currency: tx.currency,
          description: tx.description,
          external_id: `obsidian-finance:${project.name}:${tx.description}`,
          occurred_at: new Date().toISOString(),
          payload: { source: 'obsidian_audit', confidence: 'note_derived' },
        }
      );
    }
  }

  console.log(`Synced ${projects.length} projects into account ${accountId}.`);
  console.log(`Operations: ${[...operationIds.keys()].join(', ')}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
