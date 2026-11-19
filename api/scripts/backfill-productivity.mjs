// One-time backfill of productivity_daily from Logiwa's warehouse-task report.
// Same methodology as api/src/lib/productivity-agg.ts (pu = pack-type qty,
// eaches = UOM qty, per-user gap-capped active time allocated by task share).
//
// Usage (Git Bash, from api/):
//   LOGIWA_EMAIL=... LOGIWA_PASSWORD=... node scripts/backfill-productivity.mjs 2026-08-01 2026-11-17 out/
// Then apply each generated SQL file:
//   npx wrangler d1 execute client-api-gateway --remote --file out/prod-backfill-<n>.sql

import fs from 'fs';
import path from 'path';

const API = 'https://myapi.logiwa.com';
const EMAIL = process.env.LOGIWA_EMAIL;
const PASS = process.env.LOGIWA_PASSWORD;
const [, , FROM, TO, OUTDIR = '.'] = process.argv;
if (!EMAIL || !PASS || !FROM || !TO) {
  console.error('usage: LOGIWA_EMAIL=.. LOGIWA_PASSWORD=.. node backfill-productivity.mjs <from> <to> [outdir]');
  process.exit(1);
}

const GAP_CAP_MS = 5 * 60 * 1000;
const FIRST_TASK_MS = 60_000;
const ctDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function token() {
  const r = await fetch(`${API}/v3.1/Authorize/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  if (!r.ok) throw new Error(`auth ${r.status}`);
  return (await r.json()).token;
}

async function fetchWindow(tok, from, to) {
  const rows = [];
  for (let page = 0; page < 170; page++) {
    const r = await fetch(`${API}/v3.1/Report/WarehouseTask/order-operation/i/${page}/s/200?PlannedStartDateTime.bt=${from},${to}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) throw new Error(`report ${r.status} (${from})`);
    const b = await r.json();
    rows.push(...(b.data || []));
    if ((b.data || []).length < 200) break;
    if (page === 169) console.error(`WARNING: 170-page cap hit for window ${from},${to}`);
  }
  return rows;
}

function aggregateDay(day, allRows) {
  const windowDone = allRows
    .filter((t) => t.warehouseTaskStatusName === 'Completed' && t.executedByDisplayName && t.actualFinishDateTime)
    .map((t) => ({
      u: t.executedByDisplayName, c: t.clientDisplayName || '(no client)',
      jt: t.jobTypeName || '(untyped)', tt: t.warehouseTaskTypeName || '?',
      pk: t.fromPackTypeName || 'Unit',
      p: Number(t.fromTaskQuantity ?? t.toTaskQuantity ?? 1) || 1,
      e: Number(t.fromTaskUOMQuantity ?? t.fromTaskQuantity ?? 1) || 1,
      f: Date.parse(t.actualFinishDateTime),
      // GUID, not code: shipmentOrderCode is a per-client sequence and
      // collides across clients (see productivity-agg.ts).
      oc: t.shipmentOrderIdentifier || t.shipmentOrderCode || null,
      ln: t.shipmentOrderLineIdentifier || null,
    }))
    .filter((r) => isFinite(r.f));
  const done = windowDone.filter((r) => ctDay(r.f) === day);

  const userF = new Map(), userT = new Map();
  for (const r of done) {
    if (!userF.has(r.u)) userF.set(r.u, []);
    userF.get(r.u).push(r.f);
    userT.set(r.u, (userT.get(r.u) || 0) + 1);
  }
  const userMs = new Map();
  for (const [u, fs] of userF) {
    const s = fs.sort((a, b) => a - b);
    let ms = FIRST_TASK_MS;
    for (let i = 1; i < s.length; i++) ms += Math.min(s[i] - s[i - 1], GAP_CAP_MS);
    userMs.set(u, ms);
  }
  const agg = new Map();
  for (const r of done) {
    const k = [r.u, r.c, r.jt, r.tt, r.pk].join('\u0001');
    let a = agg.get(k);
    if (!a) { a = { ...r, pu: 0, ea: 0, tasks: 0 }; agg.set(k, a); }
    a.pu += r.p; a.ea += r.e; a.tasks++;
  }
  const stmts = [];
  for (const a of agg.values()) {
    const alloc = Math.round((userMs.get(a.u) || 0) * (a.tasks / (userT.get(a.u) || 1)));
    stmts.push(`INSERT INTO productivity_daily (day, environment, user_name, client, job_type, task_type, pack_type, pu, eaches, tasks, alloc_ms) VALUES (${q(day)},'production',${q(a.u)},${q(a.c)},${q(a.jt)},${q(a.tt)},${q(a.pk)},${a.pu},${a.ea},${a.tasks},${alloc});`);
  }

  // Finance workload counts (productivity_daily_work, 0020) — same math as
  // buildWorkRows in api/src/lib/productivity-agg.ts: orders/lines are
  // distinct, attributed to the first completed task's CT day + cell;
  // picked PU/eaches come from Picking tasks only.
  const firstOf = (idOf) => {
    const m = new Map();
    for (const r of windowDone) {
      const id = idOf(r);
      if (!id) continue;
      const cur = m.get(id);
      if (!cur || r.f < cur.f) m.set(id, r);
    }
    return m;
  };
  const cells = new Map();
  const cell = (c, jt) => {
    const k = c + '\u0001' + jt;
    let v = cells.get(k);
    if (!v) { v = { c, jt, orders: 0, lines: 0, pu: 0, eaches: 0, tasks: 0 }; cells.set(k, v); }
    return v;
  };
  for (const r of firstOf((r) => r.oc).values()) if (ctDay(r.f) === day) cell(r.c, r.jt).orders++;
  for (const r of firstOf((r) => r.ln).values()) if (ctDay(r.f) === day) cell(r.c, r.jt).lines++;
  for (const r of done) {
    const v = cell(r.c, r.jt);
    v.tasks++;
    if (/pick/i.test(r.tt)) { v.pu += r.p; v.eaches += r.e; }
  }
  for (const w of cells.values()) {
    stmts.push(`INSERT INTO productivity_daily_work (day, environment, client, job_type, orders, lines, picked_pu, picked_eaches, tasks) VALUES (${q(day)},'production',${q(w.c)},${q(w.jt)},${w.orders},${w.lines},${w.pu},${w.eaches},${w.tasks});`);
  }
  return stmts;
}

const tok = await token();
fs.mkdirSync(OUTDIR, { recursive: true });
let fileIdx = 0, buf = [], totalRows = 0;
const flush = () => {
  if (!buf.length) return;
  const f = path.join(OUTDIR, `prod-backfill-${fileIdx++}.sql`);
  fs.writeFileSync(f, buf.join('\n'));
  console.log(`wrote ${f} (${buf.length} statements)`);
  buf = [];
};

// Walk in ~15-day chunks: fetch one padded window per chunk, then aggregate
// each CT day inside it from that single window (far fewer Logiwa calls).
const start = new Date(`${FROM}T12:00:00Z`).getTime();
const end = new Date(`${TO}T12:00:00Z`).getTime();
const CHUNK_DAYS = 15;
for (let c = start; c <= end; c += CHUNK_DAYS * 86_400_000) {
  const chunkEnd = Math.min(c + (CHUNK_DAYS - 1) * 86_400_000, end);
  const wFrom = new Date(c - 2 * 86_400_000).toISOString().split('T')[0];
  const wTo = new Date(chunkEnd + 2 * 86_400_000).toISOString().split('T')[0];
  const rows = await fetchWindow(tok, wFrom, wTo);
  console.log(`window ${wFrom}..${wTo}: ${rows.length} task rows`);
  for (let t = c; t <= chunkEnd; t += 86_400_000) {
    const day = new Date(t).toISOString().split('T')[0];
    const stmts = aggregateDay(day, rows);
    buf.push(
      `DELETE FROM productivity_daily WHERE day=${q(day)} AND environment='production';`,
      `DELETE FROM productivity_daily_work WHERE day=${q(day)} AND environment='production';`,
      ...stmts
    );
    totalRows += stmts.length;
    console.log(`  ${day}: ${stmts.length} agg rows`);
    if (buf.length >= 800) flush();
  }
  await new Promise((r) => setTimeout(r, 500));
}
flush();
console.log(`DONE: ${totalRows} aggregate rows across files`);
