#!/usr/bin/env npx tsx
/**
 * Admin CLI for managing tenants and API keys.
 *
 * Usage:
 *   npx tsx scripts/admin.ts create-tenant --name "Acme Corp" --logiwa-url "https://api.logiwa.io" --logiwa-user "user" --logiwa-pass "pass"
 *   npx tsx scripts/admin.ts generate-key --tenant-id <id> --label "production"
 *   npx tsx scripts/admin.ts list-keys --tenant-id <id>
 *   npx tsx scripts/admin.ts revoke-key --key-id <id>
 *   npx tsx scripts/admin.ts list-tenants
 *
 * Add --local to operate against the local D1/KV instead of remote.
 */

import { execSync } from 'child_process';
import crypto from 'crypto';

const DB_NAME = 'client-api-gateway';
const KV_NAMESPACE_ID = '43692b54b0074c4692b279977e1a0aca';

// ── Helpers ──────────────────────────────────────────

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
      parsed[key] = value;
      if (value !== 'true') i++;
    }
  }
  return parsed;
}

function isLocal(flags: Record<string, string>): boolean {
  return flags['local'] === 'true';
}

function d1Execute(sql: string, flags: Record<string, string>): string {
  const remote = isLocal(flags) ? '--local' : '--remote';
  const escaped = sql.replace(/'/g, "'\\''");
  const cmd = `npx wrangler d1 execute ${DB_NAME} ${remote} --command '${escaped}'`;
  try {
    return execSync(cmd, { cwd: __dirname + '/..', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e: any) {
    console.error('D1 command failed:', e.stderr || e.message);
    process.exit(1);
  }
}

function kvPut(key: string, value: string, flags: Record<string, string>): void {
  const localFlag = isLocal(flags) ? '--local' : '';
  const escaped = value.replace(/'/g, "'\\''");
  const cmd = `npx wrangler kv key put --namespace-id ${KV_NAMESPACE_ID} "${key}" '${escaped}' ${localFlag}`;
  try {
    execSync(cmd, { cwd: __dirname + '/..', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e: any) {
    console.error('KV put failed:', e.stderr || e.message);
    process.exit(1);
  }
}

function kvDelete(key: string, flags: Record<string, string>): void {
  const localFlag = isLocal(flags) ? '--local' : '';
  const cmd = `npx wrangler kv key delete --namespace-id ${KV_NAMESPACE_ID} "${key}" ${localFlag} --force`;
  try {
    execSync(cmd, { cwd: __dirname + '/..', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e: any) {
    console.error('KV delete failed:', e.stderr || e.message);
    process.exit(1);
  }
}

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generateId(): string {
  return crypto.randomUUID();
}

function generateApiKey(): string {
  // Format: cgw_<32 random hex chars> (64-char key with prefix)
  return `cgw_${crypto.randomBytes(32).toString('hex')}`;
}

// ── Commands ─────────────────────────────────────────

function createTenant(flags: Record<string, string>): void {
  const name = flags['name'];
  const logiwaUrl = flags['logiwa-url'];
  const logiwaUser = flags['logiwa-user'];
  const logiwaPass = flags['logiwa-pass'];
  const callbackUrl = flags['callback-url'] || '';

  if (!name || !logiwaUrl || !logiwaUser || !logiwaPass) {
    console.error('Required: --name, --logiwa-url, --logiwa-user, --logiwa-pass');
    process.exit(1);
  }

  const id = generateId();
  const credentials = JSON.stringify({ username: logiwaUser, password: logiwaPass });

  const sql = `INSERT INTO tenants (id, name, logiwa_api_url, logiwa_credentials, callback_url, active) VALUES ('${id}', '${name.replace(/'/g, "''")}', '${logiwaUrl}', '${credentials.replace(/'/g, "''")}', '${callbackUrl}', 1)`;

  d1Execute(sql, flags);
  console.log(`\nTenant created successfully!`);
  console.log(`  ID:   ${id}`);
  console.log(`  Name: ${name}`);
  console.log(`  URL:  ${logiwaUrl}`);
}

function generateKey(flags: Record<string, string>): void {
  const tenantId = flags['tenant-id'];
  const label = flags['label'] || 'default';

  if (!tenantId) {
    console.error('Required: --tenant-id');
    process.exit(1);
  }

  const keyId = generateId();
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);

  // Insert into D1
  const sql = `INSERT INTO api_keys (id, key_hash, tenant_id, label, active, rate_limit) VALUES ('${keyId}', '${keyHash}', '${tenantId}', '${label.replace(/'/g, "''")}', 1, 60)`;
  d1Execute(sql, flags);

  // Insert into KV for fast lookup
  const kvValue = JSON.stringify({
    tenantId,
    tenantName: label, // Will be overwritten by actual tenant name on lookup
    rateLimit: 60,
    active: true,
  });
  kvPut(`apikey:${keyHash}`, kvValue, flags);

  console.log(`\nAPI key generated successfully!`);
  console.log(`  Key ID:    ${keyId}`);
  console.log(`  Tenant ID: ${tenantId}`);
  console.log(`  Label:     ${label}`);
  console.log(`  API Key:   ${rawKey}`);
  console.log(`\n  ⚠ Save this key now — it cannot be retrieved later.`);
}

function listKeys(flags: Record<string, string>): void {
  const tenantId = flags['tenant-id'];
  if (!tenantId) {
    console.error('Required: --tenant-id');
    process.exit(1);
  }

  const sql = `SELECT id, key_hash, label, active, rate_limit, last_used_at, created_at FROM api_keys WHERE tenant_id = '${tenantId}' ORDER BY created_at DESC`;
  const output = d1Execute(sql, flags);
  console.log(output);
}

function revokeKey(flags: Record<string, string>): void {
  const keyId = flags['key-id'];
  if (!keyId) {
    console.error('Required: --key-id');
    process.exit(1);
  }

  // Get the key hash before revoking so we can remove from KV
  const selectSql = `SELECT key_hash FROM api_keys WHERE id = '${keyId}'`;
  const output = d1Execute(selectSql, flags);

  // Deactivate in D1
  const sql = `UPDATE api_keys SET active = 0 WHERE id = '${keyId}'`;
  d1Execute(sql, flags);

  // Try to extract the hash and remove from KV
  const hashMatch = output.match(/([a-f0-9]{64})/);
  if (hashMatch) {
    kvDelete(`apikey:${hashMatch[1]}`, flags);
    console.log(`\nAPI key revoked and removed from KV.`);
  } else {
    console.log(`\nAPI key deactivated in D1. KV entry may need manual removal.`);
  }
  console.log(`  Key ID: ${keyId}`);
}

function listTenants(flags: Record<string, string>): void {
  const sql = `SELECT id, name, logiwa_api_url, active, created_at FROM tenants ORDER BY created_at DESC`;
  const output = d1Execute(sql, flags);
  console.log(output);
}

// ── Main ─────────────────────────────────────────────

const [command, ...rest] = process.argv.slice(2);
const flags = parseArgs(rest);

switch (command) {
  case 'create-tenant':
    createTenant(flags);
    break;
  case 'generate-key':
    generateKey(flags);
    break;
  case 'list-keys':
    listKeys(flags);
    break;
  case 'revoke-key':
    revokeKey(flags);
    break;
  case 'list-tenants':
    listTenants(flags);
    break;
  default:
    console.log(`
Client API Gateway — Admin CLI

Commands:
  create-tenant   Create a new tenant
  generate-key    Generate an API key for a tenant
  list-keys       List API keys for a tenant
  revoke-key      Revoke an API key
  list-tenants    List all tenants

Options:
  --local         Use local D1/KV instead of remote

Examples:
  npx tsx scripts/admin.ts create-tenant --name "Acme Corp" --logiwa-url "https://api.logiwa.io" --logiwa-user "user" --logiwa-pass "pass"
  npx tsx scripts/admin.ts generate-key --tenant-id <id> --label "production"
  npx tsx scripts/admin.ts list-keys --tenant-id <id>
  npx tsx scripts/admin.ts revoke-key --key-id <id>
  npx tsx scripts/admin.ts list-tenants
`);
}
