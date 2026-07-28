#!/usr/bin/env node
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3001';
const EVENT_EXTERNAL_ID = 'openclaw-api-smoke-event';
const FINANCE_EXTERNAL_ID = 'openclaw-api-smoke-finance';

function parseEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!/^\s*[A-Z0-9_]+=/.test(line)) continue;
    const idx = line.indexOf('=');
    out[line.slice(0, idx).trim()] = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return out;
}

function generateApiKey() {
  const body = randomBytes(32).toString('base64url');
  const plaintext = `wacrm_live_${body}`;
  return {
    plaintext,
    hash: createHash('sha256').update(plaintext).digest('hex'),
    prefix: `wacrm_live_${body.slice(0, 8)}`,
  };
}

async function api(path, key, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed ${res.status}: ${text.slice(0, 500)}`
    );
  }
  return body;
}

const env = parseEnv('.env.local');
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

const key = generateApiKey();
let keyId;

try {
  const { data: account, error: accountError } = await db
    .from('accounts')
    .select('id, owner_user_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();
  if (accountError || !account)
    throw accountError ?? new Error('No account found');

  const { data: operation, error: operationError } = await db
    .from('operations')
    .select('id, name')
    .eq('account_id', account.id)
    .neq('status', 'archived')
    .order('name', { ascending: true })
    .limit(1)
    .single();
  if (operationError || !operation)
    throw operationError ?? new Error('No operation found');

  const { data: insertedKey, error: keyError } = await db
    .from('api_keys')
    .insert({
      account_id: account.id,
      created_by: account.owner_user_id,
      name: 'OpenClaw command-center smoke test',
      key_prefix: key.prefix,
      key_hash: key.hash,
      scopes: ['projects:read', 'events:write', 'finance:write'],
    })
    .select('id')
    .single();
  if (keyError || !insertedKey)
    throw keyError ?? new Error('Failed to create temp API key');
  keyId = insertedKey.id;

  const projects = await api('/api/v1/projects?limit=3', key.plaintext);
  if (!Array.isArray(projects.data) || projects.data.length < 1) {
    throw new Error('Projects endpoint returned no projects');
  }

  const event = await api('/api/v1/events', key.plaintext, {
    method: 'POST',
    body: JSON.stringify({
      operationId: operation.id,
      eventType: 'system',
      eventName: 'OpenClaw API smoke test',
      externalId: EVENT_EXTERNAL_ID,
      payload: { smokeTest: true },
    }),
  });
  if (!event.data?.id) throw new Error('Events endpoint did not return an id');

  const finance = await api('/api/v1/finance', key.plaintext, {
    method: 'POST',
    body: JSON.stringify({
      operationId: operation.id,
      kind: 'adjustment',
      status: 'confirmed',
      amount: 1,
      currency: 'AOA',
      description: 'OpenClaw API smoke test',
      externalId: FINANCE_EXTERNAL_ID,
      payload: { smokeTest: true },
    }),
  });
  if (!finance.data?.id)
    throw new Error('Finance endpoint did not return an id');

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBase: API_BASE,
        projectCountSample: projects.data.length,
        operation: operation.name,
        eventId: event.data.id,
        financeId: finance.data.id,
      },
      null,
      2
    )
  );
} finally {
  await db
    .from('financial_transactions')
    .delete()
    .eq('external_id', FINANCE_EXTERNAL_ID);
  await db
    .from('project_events')
    .delete()
    .in('external_id', [EVENT_EXTERNAL_ID, `payment:${FINANCE_EXTERNAL_ID}`]);
  if (keyId) await db.from('api_keys').delete().eq('id', keyId);
}
