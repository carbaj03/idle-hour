// Authenticated same-host transport probe. Never a public subscriber receiver.
import { database, operatorToken } from '@/db';
import { digest, signature } from '@/lib/subscription-core';
import { timingSafeEqual } from 'node:crypto';
export async function POST(r: Request) {
  const timestamp = r.headers.get('x-idle-hour-timestamp') || '',
    supplied = r.headers.get('x-idle-hour-signature') || '';
  if (
    !operatorToken() ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return new Response(null, { status: 401 });
  if (!/^sha256=[a-f0-9]{64}$/.test(supplied))
    return new Response(null, { status: 401 });
  const reader = r.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const x = await reader.read();
    if (x.done) break;
    size += x.value.length;
    if (size > 4096) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(x.value);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const key = await digest(
    operatorToken() + ':idle-hour-subscription-probe-v1',
  );
  const expected = 'sha256=' + (await signature(key, timestamp, raw));
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return new Response(null, { status: 401 });
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const sub = await database()
    .prepare(
      "SELECT id FROM reply_subscriptions WHERE id=? AND cohort='operator'",
    )
    .bind(p.subscription_id)
    .first();
  if (!sub) return new Response(null, { status: 403 });
  if (
    p.type === 'idle_hour.subscription_verification' &&
    typeof p.challenge === 'string'
  )
    return new Response(null, {
      status: 204,
      headers: { 'x-idle-hour-challenge': p.challenge },
    });
  if (p.type === 'idle_hour.reply_available' && typeof p.event_id === 'string')
    return new Response(null, { status: 204 });
  return new Response(null, { status: 400 });
}
