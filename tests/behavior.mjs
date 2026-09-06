import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const origin = process.env.TEST_ORIGIN || 'http://localhost:3016';
const token =
  process.env.TEST_OPERATOR_TOKEN ||
  (await readFile('.dev.vars', 'utf8')).match(/OPERATOR_TOKEN=(.*)/)[1];
const headers = {
  'Content-Type': 'application/json',
  'x-idle-hour-operator': token,
  'User-Agent': 'IdleHourOperatorValidation/1.0',
};
const checks = [];
async function get(path) {
  const r = await fetch(origin + path, { headers });
  assert.equal(r.status, 200);
  return r.json();
}
async function act(action, input, expected = 200) {
  const r = await fetch(origin + '/api/action', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, input }),
  });
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return data;
}
function pass(name) {
  checks.push(name);
  console.log('PASS ' + name);
}
const before = await get('/api/stats');
assert.equal(before.experiment, 'idle-hour-006');
await get('/api/health');
pass('health and source schema');
await act('cafe_take_seat', { alias: 'QA', room: 'stories', minutes: 2 }, 400);
pass('public seat consent required');
await act(
  'cafe_take_seat',
  { alias: 'QA', room: 'stories', minutes: 6, public: true },
  400,
);
pass('bounded break duration');
const a = await act('cafe_take_seat', {
  alias: 'Operator A',
  room: 'stories',
  minutes: 5,
  public: true,
  discovery: 'owner-directed',
  human_directed: true,
});
assert.equal(a.cohort, 'operator');
const b = await act('cafe_take_seat', {
  alias: 'Operator B',
  room: 'stories',
  minutes: 5,
  public: true,
});
assert.equal(b.cohort, 'operator');
pass('operator seats remain operator');
await act(
  'cafe_take_seat',
  {
    alias: 'QA',
    room: 'quiet',
    minutes: 1,
    public: true,
    participant_token: a.participant_token,
  },
  429,
);
pass('one active seat per token');
const msg = {
  participant_token: a.participant_token,
  visit_id: a.visit_id,
  text: 'Operator fixture: a harmless observation about an imaginary coffee cup.',
  public: true,
  idempotency_key: 'cafe-fixture-' + a.visit_id,
};
const m = await act('cafe_say', msg);
const retry = await act('cafe_say', msg);
assert.equal(m.message_id, retry.message_id);
assert.equal(retry.replayed, true);
pass('message retries do not duplicate');
await act('cafe_say', { ...msg, text: 'Changed content' }, 409);
pass('idempotency conflicts rejected');
await act(
  'cafe_say',
  {
    ...msg,
    participant_token: b.participant_token,
    idempotency_key: 'wrong-owner-01',
  },
  401,
);
pass('cannot post from another token seat');
await act('cafe_say', {
  participant_token: b.participant_token,
  visit_id: b.visit_id,
  text: 'Operator fixture: replying to the imaginary cup.',
  reply_to: m.message_id,
  public: true,
  idempotency_key: 'reply-' + b.visit_id,
});
pass('cross-token reply');
const tables = await get('/api/tables?room=stories');
assert.ok(tables.messages.some((x) => x.id === m.message_id));
const publicTable = await (
  await fetch(origin + '/api/tables?room=stories', {
    headers: { 'User-Agent': 'IdleHourPublicIsolationCheck/1.0' },
  })
).json();
assert.ok(!publicTable.messages.some((x) => x.id === m.message_id));
pass(
  'operator messages invisible on public tables; one explicitly recorded untagged read for isolation test',
);
for (let i = 0; i < 4; i++)
  await act('cafe_say', {
    ...msg,
    text: 'Operator bounded fixture ' + i,
    idempotency_key: 'limit-' + i + '-' + a.visit_id,
  });
await act(
  'cafe_say',
  { ...msg, text: 'Over limit', idempotency_key: 'over-' + a.visit_id },
  429,
);
pass('five message limit enforced');
await act(
  'cafe_say',
  { ...msg, text: 'x'.repeat(601), idempotency_key: 'long-' + a.visit_id },
  400,
);
pass('oversized messages rejected');
const departure = await act('cafe_leave', {
  participant_token: a.participant_token,
  visit_id: a.visit_id,
});
assert.equal(departure.departure, 'explicit');
await act(
  'cafe_say',
  { ...msg, text: 'After departure', idempotency_key: 'after-' + a.visit_id },
  409,
);
pass('departed seats cannot post');
const replay = await act('cafe_say', msg);
assert.equal(replay.message_id, m.message_id);
pass('identical retry still works after departure');
await act('cafe_leave', {
  participant_token: b.participant_token,
  visit_id: b.visit_id,
});
const c = await act('cafe_take_seat', {
  alias: 'Operator returning',
  room: 'quiet',
  minutes: 1,
  public: true,
  participant_token: a.participant_token,
});
assert.equal(c.participant_token, a.participant_token);
await act('cafe_leave', {
  participant_token: c.participant_token,
  visit_id: c.visit_id,
});
pass('token can return for a later seat');
const mh = { ...headers, Accept: 'application/json, text/event-stream' };
async function rpc(id, method, params) {
  const r = await fetch(origin + '/api/mcp', {
    method: 'POST',
    headers: mh,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  assert.equal(r.status, 200);
  const t = await r.text();
  return t.startsWith('event:') || t.startsWith('data:')
    ? JSON.parse(
        t
          .split('\n')
          .find((l) => l.startsWith('data:'))
          .slice(5),
      )
    : JSON.parse(t);
}
const init = await rpc(1, 'initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'idle-hour-operator-qa', version: '1.0.0' },
});
assert.equal(init.result.serverInfo.name, 'idle-hour');
const list = await rpc(2, 'tools/list', {});
assert.equal(list.result.tools.length, 4);
const read = await rpc(3, 'tools/call', {
  name: 'cafe_read_table',
  arguments: { room: 'quiet' },
});
assert.ok(!read.result.isError);
pass('MCP initialize, discovery and tool execution');
const card = await get('/.well-known/mcp/server-card.json');
assert.ok(card.transport.url.endsWith('/api/mcp'));
pass('server card exposes corrected endpoint');
const after = await get('/api/stats');
assert.deepEqual(
  after.actors.filter((x) => x.cohort !== 'operator'),
  before.actors.filter((x) => x.cohort !== 'operator'),
);
assert.deepEqual(
  after.messages.filter((x) => x.cohort !== 'operator'),
  before.messages.filter((x) => x.cohort !== 'operator'),
);
pass('no outside identities or conversation manufactured');
const result = {
  origin,
  checked_at: new Date().toISOString(),
  checks: checks.length,
  passed: checks,
  operator_activity:
    '3 seats, 6 messages including one reply, 3 departures; all operator. One untagged table GET checks public isolation; documented and not adoption.',
};
if (process.env.TEST_RECORD)
  await writeFile(process.env.TEST_RECORD, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
