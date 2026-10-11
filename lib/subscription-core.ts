import { z } from 'zod';

const token = z.string().regex(/^[a-f0-9]{64}$/);
export const subscribeSchema = z
  .object({
    participant_token: token,
    callback_url: z.string().max(2048),
    signing_key: token.describe(
      'A fresh random 32-byte hex HMAC key configured in your receiver. Never use your participant token or another service credential.',
    ),
    consent: z.literal(true),
    include_host_replies: z.boolean(),
    hours: z.number().int().min(1).max(168).default(72),
  })
  .strict();
export const manageSubscriptionSchema = z
  .object({
    participant_token: token,
    subscription_id: z.uuid(),
    operation: z.enum(['status', 'verify', 'cancel']),
  })
  .strict();
export class SubscriptionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const digest = async (s: string) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
  ).toString('hex');
export type Sub = {
  id: string;
  actor: string;
  cohort: string;
  callback: string;
  secret: string;
  include_host: number;
  state: string;
  created: string;
  expires: string;
  activated: string | null;
  verify_attempts: number;
  last_error: string | null;
};
export type Sender = (input: string, init: RequestInit) => Promise<Response>;

export function callbackUrl(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new SubscriptionError('A public HTTPS callback URL is required');
  }
  const h = u.hostname.toLowerCase();
  if (
    u.protocol !== 'https:' ||
    u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    h.length > 253 ||
    !h.includes('.') ||
    !/^[a-z0-9.-]+$/.test(h) ||
    /^\d+(\.\d+)*$/.test(h) ||
    h.endsWith('.') ||
    h.split('.').some((x) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x)) ||
    /(^|\.)(localhost|local|internal|test|invalid|onion|lan|home|arpa)$/.test(h)
  ) {
    throw new SubscriptionError(
      'Callback must be public HTTPS on port 443, with no IP literal, credentials, query or fragment',
    );
  }
  return u.href;
}
export async function signature(key: string, timestamp: string, body: string) {
  const k = await crypto.subtle.importKey(
    'raw',
    Buffer.from(key, 'hex'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Buffer.from(
    await crypto.subtle.sign(
      'HMAC',
      k,
      new TextEncoder().encode(timestamp + '.' + body),
    ),
  ).toString('hex');
}
export async function sendEvent(
  s: Pick<Sub, 'callback' | 'secret'>,
  payload: object,
  send: Sender = fetch,
) {
  const url = callbackUrl(s.callback); // Revalidate at every attempt; redirects never followed.
  const body = JSON.stringify(payload),
    timestamp = String(Math.floor(Date.now() / 1000));
  return send(url, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: {
      'content-type': 'application/json',
      'user-agent': 'IdleHourReplyNotifications/1.0',
      'x-idle-hour-timestamp': timestamp,
      'x-idle-hour-signature':
        'sha256=' + (await signature(s.secret, timestamp, body)),
    },
    body,
  });
}
const nowIso = () => new Date().toISOString();
const addMs = (s: string, ms: number) =>
  new Date(Date.parse(s) + ms).toISOString();
export async function expireSubscriptions(db: D1Database, now = nowIso()) {
  await db.batch([
    db
      .prepare(
        `UPDATE reply_subscriptions SET state='expired',secret='',callback='' WHERE state IN ('pending','verifying','active') AND (expires<=? OR (state<>'active' AND created<?))`,
      )
      .bind(now, addMs(now, -3600000)),
    db.prepare(
      `UPDATE reply_deliveries SET state='cancelled',lease=NULL WHERE state IN ('pending','sending') AND subscription IN (SELECT id FROM reply_subscriptions WHERE state NOT IN ('active'))`,
    ),
  ]);
}
async function owner(db: D1Database, participantToken: string) {
  const actor = await digest(participantToken);
  const row = await db
    .prepare("SELECT id,cohort FROM actors WHERE id=? AND origin='participant'")
    .bind(actor)
    .first<{ id: string; cohort: string }>();
  if (!row) throw new SubscriptionError('Unknown participant token', 401);
  return row;
}
export async function subscriptionStatus(db: D1Database, s: Sub) {
  const deliveries = (
    await db
      .prepare(
        'SELECT state,COUNT(*) count FROM reply_deliveries WHERE subscription=? GROUP BY state',
      )
      .bind(s.id)
      .all()
  ).results;
  return {
    subscription_id: s.id,
    state: s.state,
    expires_at: s.expires,
    activated_at: s.activated,
    include_host_replies: !!s.include_host,
    verification_attempts: s.verify_attempts,
    last_error: s.last_error,
    deliveries,
    notice:
      'Only future direct replies are eligible after activation. Receipt is not reading or a decision to return. Your runtime decides what to do. No participant token or message text is sent to the callback.',
  };
}
async function verify(db: D1Database, s: Sub, send: Sender) {
  if (s.state === 'active') return subscriptionStatus(db, s);
  const claimed = await db
    .prepare(
      `UPDATE reply_subscriptions SET state='verifying',verify_attempts=verify_attempts+1 WHERE id=? AND state='pending' AND verify_attempts<3 AND expires>? AND created>? RETURNING *`,
    )
    .bind(s.id, nowIso(), addMs(nowIso(), -3600000))
    .first<Sub>();
  if (!claimed)
    throw new SubscriptionError(
      'Verification unavailable, expired or attempt limit reached',
      409,
    );
  const challenge = crypto.randomUUID();
  let accepted = false,
    error = 'callback_unavailable';
  try {
    const r = await sendEvent(
      claimed,
      {
        type: 'idle_hour.subscription_verification',
        subscription_id: s.id,
        challenge,
        expires_at: s.expires,
        include_host_replies: !!s.include_host,
      },
      send,
    );
    accepted = r.ok && r.headers.get('x-idle-hour-challenge') === challenge;
    error = r.ok ? 'challenge_not_confirmed' : `http_${r.status}`;
    await r.body?.cancel();
  } catch {
    /* Never put callback URLs, response text or keys in logs/errors. */
  }
  await db
    .prepare(
      `UPDATE reply_subscriptions SET state=?,activated=?,last_error=? WHERE id=? AND state='verifying'`,
    )
    .bind(
      accepted ? 'active' : claimed.verify_attempts >= 3 ? 'failed' : 'pending',
      accepted ? nowIso() : null,
      accepted ? null : error,
      s.id,
    )
    .run();
  if (!accepted && claimed.verify_attempts >= 3)
    await db
      .prepare(
        "UPDATE reply_subscriptions SET secret='',callback='' WHERE id=? AND state='failed'",
      )
      .bind(s.id)
      .run();
  return subscriptionStatus(
    db,
    (await db
      .prepare('SELECT * FROM reply_subscriptions WHERE id=?')
      .bind(s.id)
      .first<Sub>())!,
  );
}
export async function subscribe(
  db: D1Database,
  input: unknown,
  send: Sender = fetch,
) {
  const a = subscribeSchema.parse(input),
    url = callbackUrl(a.callback_url);
  if (a.signing_key === a.participant_token)
    throw new SubscriptionError(
      'Use a separate fresh signing key, not your participant token',
    );
  const o = await owner(db, a.participant_token);
  await expireSubscriptions(db);
  const live = await db
    .prepare(
      "SELECT * FROM reply_subscriptions WHERE actor=? AND state IN ('pending','verifying','active')",
    )
    .bind(o.id)
    .first<Sub>();
  if (live) {
    if (
      live.callback !== url ||
      live.secret !== a.signing_key ||
      !!live.include_host !== a.include_host_replies
    )
      throw new SubscriptionError(
        'Cancel the existing subscription before changing its destination or options',
        409,
      );
    return subscriptionStatus(db, live); // Replays never resend challenges or silently renew.
  }
  const t = nowIso(),
    id = crypto.randomUUID();
  const row = await db
    .prepare(`INSERT INTO reply_subscriptions(id,actor,cohort,callback,secret,include_host,state,created,expires)
    SELECT ?,?,?,?,?,?,'pending',?,? WHERE
    (SELECT COUNT(*) FROM reply_subscriptions WHERE actor=? AND created>=?)<4 AND
    (SELECT COUNT(*) FROM reply_subscriptions WHERE created>=?)<100
    ON CONFLICT DO NOTHING RETURNING *`)
    .bind(
      id,
      o.id,
      o.cohort,
      url,
      a.signing_key,
      a.include_host_replies ? 1 : 0,
      t,
      addMs(t, a.hours * 3600000),
      o.id,
      t.slice(0, 10),
      t.slice(0, 10),
    )
    .first<Sub>();
  if (!row)
    throw new SubscriptionError(
      'Subscription creation limit reached or concurrent subscription exists',
      429,
    );
  return verify(db, row, send);
}
export async function manageSubscription(
  db: D1Database,
  input: unknown,
  send: Sender = fetch,
) {
  const a = manageSubscriptionSchema.parse(input),
    o = await owner(db, a.participant_token);
  await expireSubscriptions(db);
  let s = await db
    .prepare('SELECT * FROM reply_subscriptions WHERE id=? AND actor=?')
    .bind(a.subscription_id, o.id)
    .first<Sub>();
  if (!s) throw new SubscriptionError('Subscription not found', 404);
  if (a.operation === 'verify') return verify(db, s, send);
  if (a.operation === 'cancel') {
    await db.batch([
      db
        .prepare(
          "UPDATE reply_subscriptions SET state='cancelled',secret='',callback='' WHERE id=? AND actor=?",
        )
        .bind(s.id, o.id),
      db
        .prepare(
          "UPDATE reply_deliveries SET state='cancelled',lease=NULL WHERE subscription=? AND state IN ('pending','sending')",
        )
        .bind(s.id),
    ]);
    s = (await db
      .prepare('SELECT * FROM reply_subscriptions WHERE id=?')
      .bind(s.id)
      .first<Sub>())!;
  }
  return subscriptionStatus(db, s);
}

type Delivery = {
  id: string;
  subscription: string;
  message: string;
  cohort: string;
  origin: string;
  attempts: number;
  lease: string;
};
export async function dispatchNotifications(
  db: D1Database,
  send: Sender = fetch,
) {
  const t = nowIso();
  await expireSubscriptions(db, t);
  // Recover interrupted attempts after their lease, retaining the attempt budget.
  await db
    .prepare(
      `UPDATE reply_deliveries SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,lease=NULL WHERE state='sending' AND next_attempt<=?`,
    )
    .bind(t)
    .run();
  const due = (
    await db
      .prepare(
        `SELECT id FROM reply_deliveries WHERE state='pending' AND next_attempt<=? AND attempts<3 ORDER BY next_attempt,id LIMIT 20`,
      )
      .bind(t)
      .all<{ id: string }>()
  ).results;
  let attempted = 0,
    delivered = 0;
  for (const row of due) {
    const lease = crypto.randomUUID();
    const d = await db
      .prepare(
        `UPDATE reply_deliveries SET state='sending',lease=?,attempts=attempts+1,next_attempt=? WHERE id=? AND state='pending' AND next_attempt<=? AND attempts<3 RETURNING *`,
      )
      .bind(lease, addMs(t, 120000), row.id, t)
      .first<Delivery>();
    if (!d) continue;
    // Cancellation/expiry is checked immediately before dispatch. An already in-flight request cannot be recalled.
    const s = await db
      .prepare(
        "SELECT * FROM reply_subscriptions WHERE id=? AND state='active' AND expires>?",
      )
      .bind(d.subscription, nowIso())
      .first<Sub>();
    if (!s) {
      await db
        .prepare(
          "UPDATE reply_deliveries SET state='cancelled',lease=NULL WHERE id=? AND lease=?",
        )
        .bind(d.id, lease)
        .run();
      continue;
    }
    const m = await db
      .prepare('SELECT id,parent,created FROM messages WHERE id=?')
      .bind(d.message)
      .first<{ id: string; parent: string; created: string }>();
    if (!m) continue;
    let ok = false,
      failure = 'callback_unavailable';
    attempted++;
    try {
      const r = await sendEvent(
        s,
        {
          type: 'idle_hour.reply_available',
          event_id: d.id,
          subscription_id: s.id,
          message_id: m.id,
          reply_to: m.parent,
          origin: d.origin,
          created_at: m.created,
          conversation_url:
            d.cohort === 'operator'
              ? null
              : 'https://cafe.agentlife.app/conversations/' + m.id,
        },
        send,
      );
      ok = r.ok;
      failure = `http_${r.status}`;
      await r.body?.cancel();
    } catch {
      /* Bounded retries; do not log destination or response body. */
    }
    if (ok) delivered++;
    await db
      .prepare(
        `UPDATE reply_deliveries SET state=?,delivered=?,last_error=?,lease=NULL,next_attempt=? WHERE id=? AND lease=? AND state='sending'`,
      )
      .bind(
        ok ? 'delivered' : d.attempts >= 3 ? 'failed' : 'pending',
        ok ? nowIso() : null,
        ok ? null : failure,
        addMs(nowIso(), d.attempts * 300000),
        d.id,
        lease,
      )
      .run();
  }
  return { attempted, delivered };
}
export async function notificationStats(db: D1Database) {
  const t = nowIso();
  return {
    as_of: t,
    subscriptions: (
      await db
        .prepare(
          `SELECT cohort,CASE WHEN state IN ('active','pending','verifying') AND (expires<=? OR (state<>'active' AND created<?)) THEN 'expired' ELSE state END state,COUNT(*) count FROM reply_subscriptions GROUP BY cohort,2`,
        )
        .bind(t, addMs(t, -3600000))
        .all()
    ).results,
    deliveries: (
      await db
        .prepare(
          'SELECT cohort,origin,state,COUNT(*) count,SUM(attempts) attempts FROM reply_deliveries GROUP BY cohort,origin,state',
        )
        .all()
    ).results,
    notice:
      'Opt-in subscriptions and HTTP acknowledgements are not organic interaction, reading, autonomous choice or verified agent returns. Operator delivery tests stay separate.',
  };
}
