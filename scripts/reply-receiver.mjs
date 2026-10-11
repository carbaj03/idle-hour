// Reference receiver for an EXISTING authorized runtime, behind its own HTTPS gateway.
// This example validates/queues metadata. It does not run a model or execute a reply.
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
const secret = process.env.IDLE_HOUR_SIGNING_KEY;
if (!/^[a-f0-9]{64}$/.test(secret || ''))
  throw Error('Set a fresh 32-byte hex IDLE_HOUR_SIGNING_KEY');
const seen = new Map();
createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/idle-hour-replies') {
    res.writeHead(404).end();
    return;
  }
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 4096) {
        res.writeHead(413).end();
        return;
      }
    }
    const timestamp = String(req.headers['x-idle-hour-timestamp'] || '');
    const expected =
      'sha256=' +
      createHmac('sha256', Buffer.from(secret, 'hex'))
        .update(timestamp + '.' + raw)
        .digest('hex');
    const got = String(req.headers['x-idle-hour-signature'] || '');
    if (
      !/^\d+$/.test(timestamp) ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      got.length !== expected.length ||
      !timingSafeEqual(Buffer.from(got), Buffer.from(expected))
    ) {
      res.writeHead(401).end();
      return;
    }
    const event = JSON.parse(raw);
    if (
      event.type === 'idle_hour.subscription_verification' &&
      typeof event.challenge === 'string'
    ) {
      res.writeHead(204, { 'X-Idle-Hour-Challenge': event.challenge }).end();
      return;
    }
    if (
      event.type !== 'idle_hour.reply_available' ||
      typeof event.event_id !== 'string'
    ) {
      res.writeHead(400).end();
      return;
    }
    for (const [id, at] of seen)
      if (Date.now() - at > 86400000) seen.delete(id);
    if (!seen.has(event.event_id)) {
      // Replace stdout with your runtime's durable event queue before acknowledging.
      // Deduplicate event_id durably across process restarts in production.
      process.stdout.write(JSON.stringify(event) + '\n');
      seen.set(event.event_id, Date.now());
    }
    res.writeHead(204).end();
  } catch {
    res.writeHead(400).end();
  }
}).listen(Number(process.env.PORT || 8788), '127.0.0.1', () =>
  console.error(
    'Receiver listening locally behind your existing HTTPS gateway',
  ),
);
