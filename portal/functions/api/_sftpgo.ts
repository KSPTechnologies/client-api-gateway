// Shared helper: provision SFTPGo users via its REST API, reached through the
// Cloudflare Tunnel (sftp-admin.ksp3plhq.com) behind Access using a service token.
// Underscore-prefixed => not a route, importable by the API functions.
//
// New users are created as members of the `r2clients` group, which holds the R2
// storage config with key_prefix `sftp/%username%/` — so each user is auto-scoped
// to its own folder and the portal never needs the R2 credentials.

export interface ProvisionEnv {
  SFTPGO_API_URL?: string;        // https://sftp-admin.ksp3plhq.com
  SFTPGO_ADMIN_USER?: string;
  SFTPGO_ADMIN_PASS?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

export function provisioningConfigured(env: ProvisionEnv): boolean {
  return !!(
    env.SFTPGO_API_URL &&
    env.SFTPGO_ADMIN_USER &&
    env.SFTPGO_ADMIN_PASS &&
    env.CF_ACCESS_CLIENT_ID &&
    env.CF_ACCESS_CLIENT_SECRET
  );
}

function accessHeaders(env: ProvisionEnv): Record<string, string> {
  return {
    'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID as string,
    'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET as string,
  };
}

async function adminToken(env: ProvisionEnv): Promise<string> {
  const res = await fetch(`${env.SFTPGO_API_URL}/api/v2/token`, {
    headers: {
      ...accessHeaders(env),
      Authorization: 'Basic ' + btoa(`${env.SFTPGO_ADMIN_USER}:${env.SFTPGO_ADMIN_PASS}`),
    },
  });
  if (!res.ok) throw new Error(`SFTPGo auth failed (${res.status})`);
  const d = (await res.json()) as { access_token?: string };
  if (!d.access_token) throw new Error('SFTPGo auth returned no token');
  return d.access_token;
}

// Generate a strong, unambiguous password (like the API-key reveal).
function genPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += chars[bytes[i] % chars.length];
  return s;
}

// Create (or update) an SFTP user as a member of the r2clients group.
// If a public key is supplied → key auth. Otherwise a password is generated and
// returned once (the API-key model). Updates never silently reset credentials.
export async function provisionSftpUser(
  env: ProvisionEnv,
  username: string,
  publicKey: string | null
): Promise<{ created: boolean; password?: string }> {
  const token = await adminToken(env);
  const authed = {
    ...accessHeaders(env),
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const existing = await fetch(`${env.SFTPGO_API_URL}/api/v2/users/${encodeURIComponent(username)}`, {
    headers: { ...accessHeaders(env), Authorization: `Bearer ${token}` },
  });

  if (existing.ok) {
    const upd: Record<string, unknown> = {
      username,
      status: 1,
      permissions: { '/': ['*'] },
      groups: [{ name: 'r2clients', type: 1 }],
    };
    if (publicKey) upd.public_keys = [publicKey];
    const res = await fetch(`${env.SFTPGO_API_URL}/api/v2/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: authed,
      body: JSON.stringify(upd),
    });
    if (!res.ok) throw new Error(`SFTPGo update failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
    return { created: false };
  }

  const password = publicKey ? undefined : genPassword();
  const create: Record<string, unknown> = {
    username,
    status: 1,
    permissions: { '/': ['*'] },
    groups: [{ name: 'r2clients', type: 1 }],
    public_keys: publicKey ? [publicKey] : [],
  };
  if (password) create.password = password;
  const res = await fetch(`${env.SFTPGO_API_URL}/api/v2/users`, { method: 'POST', headers: authed, body: JSON.stringify(create) });
  if (!res.ok) throw new Error(`SFTPGo create failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
  return { created: true, password };
}
