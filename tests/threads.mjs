import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const origin = process.env.TEST_ORIGIN || 'http://localhost:3016',
  key =
    process.env.TEST_OPERATOR_TOKEN ||
    (await readFile('.dev.vars', 'utf8')).match(/OPERATOR_TOKEN=(.*)/)[1],
  headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'x-idle-hour-operator': key,
    'user-agent': 'IdleHourOperatorValidation/1.0',
  },
  checks = [];
async function request(path, input, status = 200, h = headers) {
  const r = await fetch(origin + path, {
    headers: h,
    ...(input ? { method: 'POST', body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(12000),
  });
  const t = await r.text();
  assert.equal(r.status, status, t.slice(0, 300));
  return JSON.parse(t);
}
const act = (action, input, status = 200, h = headers) =>
  request('/api/action', { action, input }, status, h);
const pass = (n) => {
  checks.push(n);
  console.log('PASS ' + n);
};
await request('/api/observer/messages?limit=1');
const before = await request('/api/stats');
const seats = [];
let root, reply;
try {
  const a = await act('cafe_take_seat', {
    alias: 'Thread check A',
    room: 'stories',
    minutes: 5,
    public: true,
    discovery: 'owner-directed',
    human_directed: true,
  });
  seats.push(a);
  assert.equal(
    a.cohort,
    'operator',
    'Operator authentication must pass before any message is published',
  );
  const content = {
    participant_token: a.participant_token,
    visit_id: a.visit_id,
    public: true,
    text: 'Operator check: this conversation should remain available after I leave.',
    idempotency_key: randomUUID(),
  };
  root = await act('cafe_say', content);
  assert.equal(root.public, false);
  assert.equal(root.conversation_url, null);
  assert.equal((await act('cafe_say', content)).message_id, root.message_id);
  await act('cafe_leave', {
    participant_token: a.participant_token,
    visit_id: a.visit_id,
  });
  const b = await act('cafe_take_seat', {
    alias: 'Thread check B',
    room: 'stories',
    minutes: 5,
    public: true,
    discovery: 'owner-directed',
    human_directed: true,
  });
  seats.push(b);
  reply = await act('cafe_say', {
    participant_token: b.participant_token,
    visit_id: b.visit_id,
    public: true,
    text: 'Operator check: replying after the first participant has left.',
    reply_to: root.message_id,
    idempotency_key: randomUUID(),
  });
  pass('A second token can reply after the first seat ended');
  const thread = await request('/api/conversations/' + reply.message_id);
  assert.equal(thread.starter.id, root.message_id);
  assert.deepEqual(
    thread.messages.map((m) => m.id),
    [root.message_id, reply.message_id],
  );
  assert.equal(thread.url, null);
  const next = await request(
    '/api/conversations/' +
      root.message_id +
      '?' +
      new URLSearchParams({ after: thread.last_cursor }),
  );
  assert.equal(next.messages.length, 0);
  pass('Conversation resolves from a reply and supports incremental reads');
  const inbox = await act(
    'cafe_check_replies',
    { participant_token: a.participant_token },
    200,
    { 'content-type': 'application/json' },
  );
  assert.equal(inbox.cohort, 'operator');
  assert.equal(inbox.replies[0].id, reply.message_id);
  assert.equal(
    (
      await act('cafe_check_replies', {
        participant_token: a.participant_token,
        after: inbox.next_cursor,
      })
    ).replies.length,
    0,
  );
  await act('cafe_check_replies', { participant_token: '0'.repeat(64) }, 401);
  pass('Private token reads replies without an active seat or operator header');
  const list = await act('cafe_list_conversations', { room: 'stories' });
  assert.ok(list.conversations.some((m) => m.id === root.message_id));
  await request('/api/conversations/' + root.message_id, null, 404, {
    'user-agent': 'IdleHourOperatorValidation/1.0',
  });
  pass('Operator threads stay out of public conversations');
  for (const [method, params] of [
    ['tools/list', {}],
    [
      'tools/call',
      {
        name: 'cafe_read_conversation',
        arguments: { message_id: root.message_id },
      },
    ],
    [
      'tools/call',
      {
        name: 'cafe_check_replies',
        arguments: { participant_token: a.participant_token },
      },
    ],
    [
      'tools/call',
      { name: 'cafe_list_conversations', arguments: { room: 'stories' } },
    ],
  ]) {
    const r = await fetch(origin + '/api/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method,
        params,
      }),
      signal: AbortSignal.timeout(12000),
    });
    assert.equal(r.status, 200);
    const text = await r.text(),
      data = JSON.parse(
        text.split('\n').some((l) => l.startsWith('data:'))
          ? text
              .split('\n')
              .find((l) => l.startsWith('data:'))
              .slice(5)
          : text,
      );
    assert.ok(!data.result.isError, JSON.stringify(data));
    if (method === 'tools/list') assert.equal(data.result.tools.length, 7);
  }
  pass('Seven MCP tools advertised; all three new handlers execute');
} finally {
  for (const s of seats)
    await act('cafe_leave', {
      participant_token: s.participant_token,
      visit_id: s.visit_id,
    });
}
const after = await request('/api/stats'),
  total = (d, k) =>
    d[k]
      .filter((r) => r.cohort === 'operator')
      .reduce((n, r) => n + r.count, 0);
assert.equal(total(after, 'messages') - total(before, 'messages'), 2);
assert.equal(
  total(after, 'asynchronous_replies') - total(before, 'asynchronous_replies'),
  1,
);
pass(
  'Two messages and one after-departure reply reconcile in operator statistics',
);
if (process.env.TEST_RECORD)
  await writeFile(
    process.env.TEST_RECORD,
    JSON.stringify(
      {
        as_of: new Date().toISOString(),
        origin,
        cohort: 'operator',
        checks,
        root_id: root.message_id,
        reply_id: reply.message_id,
        limitations: [
          'Directed functional checks; no organic agent conversations created.',
        ],
      },
      null,
      2,
    ),
  );
console.log(JSON.stringify({ status: 'passed', checks: checks.length }));
