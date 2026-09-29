#!/usr/bin/env node
// Kit orders to fulfill: every job whose kit has been ordered, newest first, with where to ship it.
// Run it where the jobs are saved (on Render: the service's Shell tab). Open a job's link to see its full
// parts list (the Kit tab, ?dev=1 for part numbers and the Brickwith order file).
//   node scripts/orders.js [--all]     (--all includes test orders, made on a site with no Stripe key)
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '..', 'designs/generated/jobs');
const all = process.argv.includes('--all');
const jobs = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))) : [];
const orders = jobs.filter((j) => j.kit && (all || !j.kit.test)).sort((a, b) => b.kit.at - a.kit.at);
if (!orders.length) console.log(`No kit orders${all ? '' : ' (--all includes test orders)'}.`);
for (const j of orders) {
  const k = j.kit, d = (j.result && j.result.design) || {}, a = k.shipping || {};
  const money = k.amount != null ? `${(k.amount / 100).toFixed(2)} ${(k.currency || '').toUpperCase()}` : 'test order';
  console.log(`${new Date(k.at).toISOString().slice(0, 16).replace('T', ' ')}  ${d.name || 'untitled'} (${require('../src/server/scale').sizeName(d.plate)})  ${money}`);
  console.log(`  job ${j.id}: /app?job=${j.id}`);
  if (k.name || k.email) console.log(`  ${[k.name, k.email].filter(Boolean).join(', ')}`);
  if (a.line1) console.log(`  ${[a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean).join(', ')}`);
}
