import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import {
  subscribe,
  manageSubscription,
  dispatchNotifications,
  callbackUrl,
  digest,
  notificationStats,
} from '../lib/subscription-core.ts';
const checks = [];
const pass = (x) => {
  checks.push(x);
  console.log('PASS ' + x);
};
const raw = new DatabaseSync(':memory:');
for (const f of readdirSync('drizzle')
  .filter((x) => x.endsWith('.sql'))
  .sort())
  raw.exec(readFileSync('drizzle/' + f, 'utf8'));
const db = {
  prepare(sql) {
    let args = [];
    return {
      bind(...x) {
        args = x;
        return this;
      },
      async first() {
        return raw.prepare(sql).get(...args) || null;
      },
      async all() {
        return { results: raw.prepare(sql).all(...args) };
      },
      run() {
        return raw.prepare(sql).run(...args);
      },
    };
  },
  async batch(statements) {
    raw.exec('BEGIN');
    try {
      const r = [];
      for (const s of statements) r.push(s.run());
      raw.exec('COMMIT');
      return r;
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    }
  },
};
const utc = () => new Date().toISOString();
async function actor(origin = 'participant', cohort = 'unattributed') {
  const token = randomBytes(32).toString('hex'),
    id = await digest(token),
    v = randomUUID(),
    at = utc();
  raw
    .prepare('INSERT INTO actors(id,cohort,origin,created) VALUES(?,?,?,?)')
    .run(id, cohort, origin, at);
  raw
    .prepare(
      'INSERT INTO visits(id,actor,cohort,origin,alias,room,created,expires,discovery,directed) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      v,
      id,
      cohort,
      origin,
      'Fixture',
      'stories',
      at,
      at,
      'owner-directed',
      'true',
    );
  return { token, id, v, origin, cohort };
}
function message(a, parent = null) {
  const id = randomUUID();
  raw
    .prepare(
      'INSERT INTO messages(id,actor,visit,cohort,origin,room,alias,text,parent,created,idem) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id,
      a.id,
      a.v,
      a.cohort,
      a.origin,
      'stories',
      'Fixture',
      'Local fixture only',
      parent,
      utc(),
      id,
    );
  return id;
}
const a = await actor(),
  b = await actor(),
  host = await actor('editorial'),
  op = await actor('participant', 'operator');
const root = message(a);
message(b, root); // Pre-subscription reply must never enqueue.
const secret = randomBytes(32).toString('hex');
const calls = [];
const sender = async (url, init) => {
  assert.equal(init.redirect, 'manual');
  assert.equal(init.method, 'POST');
  const p = JSON.parse(init.body);
  calls.push(p);
  const expected =
    'sha256=' +
    createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(init.headers['x-idle-hour-timestamp'] + '.' + init.body)
      .digest('hex');
  assert.equal(init.headers['x-idle-hour-signature'], expected);
  assert.ok(
    !init.body.includes(a.token) &&
      !init.body.includes(secret) &&
      !init.body.includes('Local fixture'),
  );
  return new Response(null, {
    status: 204,
    headers: p.challenge ? { 'x-idle-hour-challenge': p.challenge } : {},
  });
};
const input = {
  participant_token: a.token,
  callback_url: 'https://receiver.example.org/replies',
  signing_key: secret,
  consent: true,
  include_host_replies: false,
  hours: 1,
};
const sub = await subscribe(db, input, sender);
assert.equal(sub.state, 'active');
assert.equal(calls.length, 1);
assert.equal(
  (await subscribe(db, input, sender)).subscription_id,
  sub.subscription_id,
);
assert.equal(calls.length, 1);
assert.equal(raw.prepare('SELECT COUNT(*) n FROM reply_deliveries').get().n, 0);
await assert.rejects(subscribe(db, { ...input, consent: false }, sender));
await assert.rejects(
  subscribe(
    db,
    { ...input, participant_token: randomBytes(32).toString('hex') },
    sender,
  ),
  /Unknown participant/,
);
await assert.rejects(
  manageSubscription(
    db,
    {
      participant_token: b.token,
      subscription_id: sub.subscription_id,
      operation: 'cancel',
    },
    sender,
  ),
  /not found/,
);
pass(
  'Explicit consent, token ownership, callback challenge and replay-safe registration; no historical delivery',
);
message(a, root);
message(host, root);
message(op, root);
const peer = message(b, root);
assert.equal(raw.prepare('SELECT COUNT(*) n FROM reply_deliveries').get().n, 1);
assert.equal(
  raw.prepare('SELECT message FROM reply_deliveries').get().message,
  peer,
);
await Promise.all([
  dispatchNotifications(db, sender),
  dispatchNotifications(db, sender),
]);
assert.equal(
  calls.filter((x) => x.type === 'idle_hour.reply_available').length,
  1,
);
assert.equal(
  raw
    .prepare("SELECT COUNT(*) n FROM reply_deliveries WHERE state='delivered'")
    .get().n,
  1,
);
pass(
  'Self/host-excluded/cross-cohort replies do not enqueue; concurrent dispatch claims one signed metadata event',
);
await manageSubscription(
  db,
  {
    participant_token: a.token,
    subscription_id: sub.subscription_id,
    operation: 'cancel',
  },
  sender,
);
assert.equal(
  raw
    .prepare('SELECT secret FROM reply_subscriptions WHERE id=?')
    .get(sub.subscription_id).secret,
  '',
);
const withHost = await subscribe(
  db,
  { ...input, include_host_replies: true },
  sender,
);
const hostReply = message(host, root);
assert.equal(
  raw
    .prepare('SELECT origin FROM reply_deliveries WHERE message=?')
    .get(hostReply).origin,
  'editorial',
);
let failures = 0;
const fail = async () => {
  failures++;
  return new Response(null, { status: 503 });
};
for (let i = 0; i < 3; i++) {
  raw
    .prepare(
      "UPDATE reply_deliveries SET next_attempt='2000-01-01' WHERE state='pending'",
    )
    .run();
  await dispatchNotifications(db, fail);
}
assert.equal(failures, 3);
assert.equal(
  raw
    .prepare('SELECT state FROM reply_deliveries WHERE message=?')
    .get(hostReply).state,
  'failed',
);
await dispatchNotifications(db, fail);
assert.equal(failures, 3);
pass(
  'Host opt-in retains editorial attribution; delivery stops after three failures',
);
const pending = message(b, root);
await manageSubscription(
  db,
  {
    participant_token: a.token,
    subscription_id: withHost.subscription_id,
    operation: 'cancel',
  },
  sender,
);
await dispatchNotifications(db, sender);
assert.equal(
  raw.prepare('SELECT state FROM reply_deliveries WHERE message=?').get(pending)
    .state,
  'cancelled',
);
const n = raw.prepare('SELECT COUNT(*) n FROM reply_deliveries').get().n;
message(b, root);
assert.equal(raw.prepare('SELECT COUNT(*) n FROM reply_deliveries').get().n, n);
pass(
  'Cancel clears receiver secrets and stops queued and future notifications',
);
const exp = await subscribe(db, input, sender);
const pending2 = message(b, root);
raw
  .prepare("UPDATE reply_subscriptions SET expires='2000-01-01' WHERE id=?")
  .run(exp.subscription_id);
await dispatchNotifications(db, sender);
assert.equal(
  raw
    .prepare('SELECT state FROM reply_deliveries WHERE message=?')
    .get(pending2).state,
  'cancelled',
);
pass('Expired subscriptions cannot send');
const recoveryActor = await actor();
await subscribe(
  db,
  { ...input, participant_token: recoveryActor.token },
  sender,
);
const recoveryRoot = message(recoveryActor);
const recoveryReply = message(b, recoveryRoot);
raw
  .prepare(
    "UPDATE reply_deliveries SET state='sending',attempts=1,lease='interrupted',next_attempt='2000-01-01' WHERE message=?",
  )
  .run(recoveryReply);
await dispatchNotifications(db, sender);
const recovered = raw
  .prepare('SELECT state,attempts FROM reply_deliveries WHERE message=?')
  .get(recoveryReply);
assert.equal(recovered.state, 'delivered');
assert.equal(recovered.attempts, 2);
const exhaustedReply = message(b, recoveryRoot);
raw
  .prepare(
    "UPDATE reply_deliveries SET state='sending',attempts=3,lease='interrupted',next_attempt='2000-01-01' WHERE message=?",
  )
  .run(exhaustedReply);
const beforeRecoveryCalls = calls.length;
await dispatchNotifications(db, sender);
assert.equal(calls.length, beforeRecoveryCalls);
assert.equal(
  raw
    .prepare('SELECT state FROM reply_deliveries WHERE message=?')
    .get(exhaustedReply).state,
  'failed',
);
pass(
  'Interrupted delivery leases recover without resetting the three-attempt budget',
);
const cancelledActor = await actor();
const duringVerification = await subscribe(
  db,
  { ...input, participant_token: cancelledActor.token },
  async (url, init) => {
    const payload = JSON.parse(init.body);
    await manageSubscription(
      db,
      {
        participant_token: cancelledActor.token,
        subscription_id: payload.subscription_id,
        operation: 'cancel',
      },
      sender,
    );
    return sender(url, init);
  },
);
assert.equal(duringVerification.state, 'cancelled');
assert.equal(
  raw
    .prepare('SELECT secret FROM reply_subscriptions WHERE id=?')
    .get(duringVerification.subscription_id).secret,
  '',
);
pass(
  'Cancellation during callback verification cannot reactivate the subscription',
);
const wrong = await subscribe(
  db,
  { ...input, participant_token: b.token },
  async () => new Response(null, { status: 200 }),
);
assert.equal(wrong.state, 'pending');
assert.equal(wrong.last_error, 'challenge_not_confirmed');
for (let i = 0; i < 2; i++)
  await manageSubscription(
    db,
    {
      participant_token: b.token,
      subscription_id: wrong.subscription_id,
      operation: 'verify',
    },
    async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1' },
      }),
  );
assert.equal(
  raw
    .prepare('SELECT state FROM reply_subscriptions WHERE id=?')
    .get(wrong.subscription_id).state,
  'failed',
);
await assert.rejects(
  manageSubscription(
    db,
    {
      participant_token: b.token,
      subscription_id: wrong.subscription_id,
      operation: 'verify',
    },
    sender,
  ),
);
pass(
  'Unverified and redirecting receivers never activate; verification attempts bounded',
);
for (const u of [
  'http://example.com',
  'https://localhost',
  'https://127.0.0.1',
  'https://2130706433',
  'https://[::1]',
  'https://user:pass@example.com',
  'https://foo.local/a',
  'https://example.com:8443/a',
  'https://example.com?a=b',
  'https://example.com/#token',
  'https://metadata.google.internal',
  'https://foo.lan',
])
  assert.throws(() => callbackUrl(u));
assert.equal(
  callbackUrl('https://receiver.example.org:443/path'),
  'https://receiver.example.org/path',
);
pass(
  'Callback restrictions reject local/IP/credential/query/fragment/alternate-port destinations',
);
const stats = await notificationStats(db);
assert.ok(
  stats.deliveries.every(
    (x) => x.origin === 'participant' || x.origin === 'editorial',
  ),
);
assert.ok(!JSON.stringify(stats).includes(secret));
console.log(JSON.stringify({ status: 'passed', checks }));
