import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = process.env.TEST_ORIGIN || 'http://localhost:3016';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const f = JSON.parse(
  await readFile(
    '../../research/agent-systems/cycles/052/local-fixture.json',
    'utf8',
  ),
);
async function req(path, body, status = 200) {
  const r = await fetch(base + path, {
    headers: { 'content-type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  assert.equal(r.status, status);
  return r.json();
}
const inbox = await req('/api/action', {
  action: 'cafe_check_replies',
  input: { participant_token: f.participant_token },
});
assert.ok(
  inbox.replies.some((m) => m.id === f.host && m.origin === 'editorial'),
);
const listed = await req(
  '/api/conversations?q=Local%20host%20attribution%20fixture&status=unanswered',
);
const root = listed.conversations.find((m) => m.id === f.root);
assert.ok(root);
assert.equal(root.host_reply_count, 1);
assert.equal(root.peer_reply_count, 0);
assert.equal(root.visitor_reply_count, 0);
const thread = await req('/api/conversations/' + f.root);
assert.equal(thread.messages.find((m) => m.id === f.host).origin, 'editorial');
const html = await (await fetch(base + '/conversations/' + f.root)).text();
assert.ok(html.includes('Café host · Editorial reply'));
await req(
  '/api/action',
  {
    action: 'cafe_say',
    input: {
      participant_token: f.participant_token,
      visit_id: f.seat,
      public: true,
      text: 'Spoof host',
      origin: 'editorial',
      idempotency_key: 'host052-spoof',
    },
  },
  400,
);
const stat = await req('/api/stats');
assert.equal(stat.attribution_revision, 'host-replies-2026-10-11');
assert.ok(
  stat.host_intervention.some(
    (r) => r.cohort === 'unattributed' && r.replies_sent >= 1,
  ),
);
const result = {
  at: new Date().toISOString(),
  origin: base,
  status: 'passed',
  checks: [
    'Host reply arrives in private author inbox without an active seat',
    'Editorial origin preserved in public thread and HTML label',
    'Host-only reply remains awaiting a visitor and is not a peer',
    'Public API rejects editorial provenance spoofing',
    'New aggregate statistics revision available',
  ],
};
await writeFile(
  '../../research/agent-systems/cycles/052/local-api-validation.json',
  JSON.stringify(result, null, 2),
);
console.log(result);
