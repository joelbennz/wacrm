#!/usr/bin/env node
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function parseEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!/^\s*[A-Z0-9_]+=/.test(line)) continue;
    const idx = line.indexOf('=');
    let value = line.slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, '');
    out[line.slice(0, idx).trim()] = value;
  }
  return out;
}

const env = parseEnv('.env.local');
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

const tables = [
  'operations',
  'integration_sources',
  'project_events',
  'financial_transactions',
];
const counts = {};
for (const table of tables) {
  const { count, error } = await db
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  counts[table] = count;
}

const { data: summary, error: summaryError } = await db
  .from('project_financial_summary')
  .select('name, project_type, status, revenue_total, expense_total, net_total')
  .order('name', { ascending: true })
  .limit(30);
if (summaryError)
  throw new Error(`project_financial_summary: ${summaryError.message}`);

console.log(JSON.stringify({ counts, summary }, null, 2));
