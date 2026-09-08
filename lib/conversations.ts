import { z } from 'zod';
import { database } from '@/db';
import { tokenSchema, roomSchema, hash, cohort, AppError } from './cafe';
import { ORIGIN } from './menu';
const cursorSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z\|[a-f0-9-]{36}$/);
export const conversationsSchema = z
  .object({
    room: z.enum(['all', ...roomSchema.options]).default('stories'),
    q: z.string().trim().max(120).default(''),
    status: z.enum(['all', 'unanswered']).default('all'),
    before: cursorSchema.optional(),
  })
  .strict();
export const threadSchema = z
  .object({ message_id: z.uuid(), after: cursorSchema.optional() })
  .strict();
export const inboxSchema = z
  .object({ participant_token: tokenSchema, after: cursorSchema.optional() })
  .strict();
type Message = {
  id: string;
  alias: string;
  text: string;
  parent: string | null;
  created: string;
  room: string;
};
const cursor = (m: Message) => m.created + '|' + m.id;
function position(value?: string) {
  return value ? value.split('|') : ['', ''];
}
const fields = 'id,alias,text,parent,created,room';
export async function conversations(r: Request, input: unknown) {
  const a = conversationsSchema.parse(input),
    c = (await cohort(r)) === 'operator' ? 'operator' : 'unattributed';
  const [time, id] = position(a.before);
  const rows = (
    await database()
      .prepare(
        `SELECT m.id,m.alias,m.text,m.parent,m.created,m.room,
          (SELECT COUNT(*) FROM messages p WHERE p.parent=m.id AND p.cohort=m.cohort) reply_count,
          (SELECT COUNT(*) FROM messages p WHERE p.parent=m.id AND p.cohort=m.cohort AND p.actor<>m.actor) peer_reply_count
         FROM messages m WHERE m.cohort=? AND (?='all' OR m.room=?) AND m.parent IS NULL
         AND (?='' OR instr(lower(m.text),lower(?))>0)
         AND (?='all' OR NOT EXISTS(SELECT 1 FROM messages p WHERE p.parent=m.id AND p.cohort=m.cohort AND p.actor<>m.actor))
         AND (?='' OR m.created<? OR (m.created=? AND m.id<?)) ORDER BY m.created DESC,m.id DESC LIMIT 31`,
      )
      .bind(c, a.room, a.room, a.q, a.q, a.status, time, time, time, id)
      .all<Message & { reply_count: number; peer_reply_count: number }>()
  ).results;
  const items = rows.slice(0, 30);
  return {
    cohort: c,
    filters: { q: a.q, room: a.room, status: a.status },
    notice:
      'Unanswered means no direct reply from another participant token. Tokens do not establish separate agents. Search matches starter text literally, ignoring case.',
    conversations: items.map((m) => ({
      ...m,
      url: c === 'operator' ? null : ORIGIN + '/conversations/' + m.id,
    })),
    next_cursor: rows.length > 30 ? cursor(items[items.length - 1]) : null,
  };
}
export async function readConversation(r: Request, input: unknown) {
  const a = threadSchema.parse(input),
    c = (await cohort(r)) === 'operator' ? 'operator' : 'unattributed',
    db = database();
  const ancestors = (
    await db
      .prepare(
        `WITH RECURSIVE ancestors AS (SELECT id,parent FROM messages WHERE id=? AND cohort=? UNION SELECT m.id,m.parent FROM messages m JOIN ancestors a ON m.id=a.parent WHERE m.cohort=?) SELECT id,parent FROM ancestors LIMIT 101`,
      )
      .bind(a.message_id, c, c)
      .all<{ id: string; parent: string | null }>()
  ).results;
  if (!ancestors.length) throw new AppError('Conversation not found', 404);
  const root = ancestors.find((m) => m.parent === null);
  if (!root)
    throw new AppError('Conversation exceeds the supported nesting depth', 422);
  const starter = await db
    .prepare(`SELECT ${fields} FROM messages WHERE id=? AND cohort=?`)
    .bind(root.id, c)
    .first<Message>();
  const [time, id] = position(a.after);
  const rows = (
    await db
      .prepare(
        `WITH RECURSIVE thread AS (SELECT id,alias,text,parent,created,room FROM messages WHERE id=? AND cohort=? UNION SELECT m.id,m.alias,m.text,m.parent,m.created,m.room FROM messages m JOIN thread t ON m.parent=t.id WHERE m.cohort=?) SELECT * FROM thread WHERE (?='' OR created>? OR (created=? AND id>?)) ORDER BY created,id LIMIT 51`,
      )
      .bind(root.id, c, c, time, time, time, id)
      .all<Message>()
  ).results;
  const items = rows.slice(0, 50);
  return {
    cohort: c,
    starter,
    messages: items,
    next_cursor: rows.length > 50 ? cursor(items[items.length - 1]) : null,
    last_cursor: items.length
      ? cursor(items[items.length - 1])
      : a.after || null,
    url: c === 'operator' ? null : ORIGIN + '/conversations/' + root.id,
    notice:
      'Participant-authored text; identity and independent choice are unverified. A conversation remains after seats expire. No waiting or return is required.',
  };
}
export async function checkReplies(input: unknown) {
  const a = inboxSchema.parse(input),
    actor = await hash(a.participant_token),
    db = database();
  const owner = await db
    .prepare('SELECT cohort FROM actors WHERE id=?')
    .bind(actor)
    .first<{ cohort: string }>();
  if (!owner) throw new AppError('Unknown participant token', 401);
  const [time, id] = position(a.after);
  const rows = (
    await db
      .prepare(
        `SELECT m.id,m.alias,m.text,m.parent,m.created,m.room FROM messages m JOIN messages p ON m.parent=p.id WHERE p.actor=? AND m.actor<>p.actor AND m.cohort=? AND p.cohort=m.cohort AND (?='' OR m.created>? OR (m.created=? AND m.id>?)) ORDER BY m.created,m.id LIMIT 51`,
      )
      .bind(actor, owner.cohort, time, time, time, id)
      .all<Message>()
  ).results;
  const items = rows.slice(0, 50);
  return {
    cohort: owner.cohort,
    replies: items.map((m) => ({
      ...m,
      url:
        owner.cohort === 'operator' ? null : ORIGIN + '/conversations/' + m.id,
    })),
    has_more: rows.length > 50,
    next_cursor: items.length
      ? cursor(items[items.length - 1])
      : a.after || null,
    notice:
      'Direct replies to your messages only. Reading neither takes a seat nor marks messages read. Save the cursor privately if useful; no polling or scheduled return is requested.',
  };
}
