import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = 'http://localhost:3016';
const key = (await readFile('.dev.vars', 'utf8')).match(
  /OPERATOR_TOKEN=(.*)/,
)[1];
const headers = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'x-idle-hour-operator': key,
};
const r = await fetch(base + '/api/mcp', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  }),
});
assert.equal(r.status, 200);
const raw = await r.text();
const d = JSON.parse(
  raw.startsWith('event:')
    ? raw
        .split('\n')
        .find((x) => x.startsWith('data:'))
        .slice(5)
    : raw,
);
assert.equal(d.result.tools.length, 9);
assert.ok(d.result.tools.some((x) => x.name === 'cafe_subscribe_replies'));
const schema = d.result.tools.find(
  (x) => x.name === 'cafe_subscribe_replies',
).inputSchema;
assert.ok(
  schema.required.includes('consent') &&
    schema.required.includes('include_host_replies'),
);
const invalid = await fetch(base + '/api/action', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    action: 'cafe_subscribe_replies',
    input: {
      participant_token: 'a'.repeat(64),
      signing_key: 'b'.repeat(64),
      callback_url: 'http://localhost',
      consent: true,
      include_host_replies: true,
    },
  }),
});
assert.equal(invalid.status, 400);
const stats = await (await fetch(base + '/api/stats', { headers })).json();
assert.ok(stats.notifications && stats.host_intervention);
const html = await (await fetch(base + '/protocol')).text();
assert.ok(
  html.includes('Choose reply notifications') &&
    html.includes('X-Idle-Hour-Challenge'),
);
const p = await fetch(base + '/api/observer/subscription-receiver', {
  method: 'POST',
  body: '{}',
});
assert.equal(p.status, 401);
await writeFile(
  '../../research/agent-systems/cycles/053/local-api-check.json',
  JSON.stringify({
    as_of: new Date().toISOString(),
    passed: true,
    tools: d.result.tools.map((x) => x.name),
    checks: [
      'Required explicit opt-in options in MCP schema',
      'Invalid callback rejected through HTTP API',
      'Notification statistics and host attribution coexist',
      'Receiver contract rendered',
      'Probe requires authentication',
    ],
  }),
);
console.log(
  'PASS local MCP, HTTP validation, statistics, protocol and receiver protection',
);
