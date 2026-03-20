/**
 * Quick script to fetch your Logiwa client and warehouse identifiers.
 *
 * Usage:
 *   npx tsx scripts/logiwa-info.ts <email> <password> [sandbox|production]
 *
 * Example:
 *   npx tsx scripts/logiwa-info.ts mike@ksp3pl.com mypassword sandbox
 */

const email = process.argv[2];
const password = process.argv[3];
const env = process.argv[4] || 'sandbox';

if (!email || !password) {
  console.log('Usage: npx tsx scripts/logiwa-info.ts <email> <password> [sandbox|production]');
  process.exit(1);
}

const baseUrl = env === 'production'
  ? 'https://myapi.logiwa.com'
  : 'https://myapisandbox.logiwa.com';

async function main() {
  console.log(`\nAuthenticating against ${baseUrl}...\n`);

  // Get token
  const authRes = await fetch(`${baseUrl}/v3.1/Authorize/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!authRes.ok) {
    console.error('Auth failed:', authRes.status, await authRes.text());
    process.exit(1);
  }

  const authData = await authRes.json() as any;
  const token = authData.token || authData.data?.token || authData;
  console.log('Authenticated successfully.\n');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${typeof token === 'string' ? token : JSON.stringify(token)}`,
  };

  // Try to list clients
  console.log('--- CLIENTS ---');
  try {
    const clientRes = await fetch(`${baseUrl}/v3.1/Client/list/i/0/s/50`, { headers });
    if (clientRes.ok) {
      const clientData = await clientRes.json() as any;
      const clients = clientData.data || clientData;
      if (Array.isArray(clients)) {
        clients.forEach((c: any) => {
          console.log(`  Name: ${c.name || c.clientName || 'N/A'}`);
          console.log(`  Identifier: ${c.identifier || c.id || 'N/A'}`);
          console.log(`  Code: ${c.code || 'N/A'}`);
          console.log('');
        });
      } else {
        console.log('  Response:', JSON.stringify(clients, null, 2).slice(0, 500));
      }
    } else {
      console.log(`  Failed (${clientRes.status}):`, await clientRes.text());
    }
  } catch (e) {
    console.log('  Error:', e);
  }

  // Try to list warehouses
  console.log('--- WAREHOUSES ---');
  try {
    const whRes = await fetch(`${baseUrl}/v3.1/Warehouse/list/i/0/s/50`, { headers });
    if (whRes.ok) {
      const whData = await whRes.json() as any;
      const warehouses = whData.data || whData;
      if (Array.isArray(warehouses)) {
        warehouses.forEach((w: any) => {
          console.log(`  Name: ${w.name || w.warehouseName || 'N/A'}`);
          console.log(`  Identifier: ${w.identifier || w.id || 'N/A'}`);
          console.log(`  Code: ${w.code || 'N/A'}`);
          console.log('');
        });
      } else {
        console.log('  Response:', JSON.stringify(warehouses, null, 2).slice(0, 500));
      }
    } else {
      console.log(`  Failed (${whRes.status}):`, await whRes.text());
    }
  } catch (e) {
    console.log('  Error:', e);
  }
}

main();
