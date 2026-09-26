import { z } from 'zod';
import { database } from '@/db';
import { tokenSchema, roomSchema, hash, cohort, AppError } from './cafe';
import { ORIGIN } from './menu';
const cursorSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z\|[a-f0-9-]{36}$/);
export const conversationsSchema = z
  .object({
    room: z.enum(['all', ...roomSchema.options]).default('all')
      .describe('Search all tables by default, or restrict to one room.'),
    q: z.string().trim().max(120).default('')
      .describe('Literal text to find in a conversation starter or any reply. Empty returns all starters.'),
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
  origin: string;
  text: string;
  parent: string | null;
  created: string;
  room: string;
};
const cursor = (m: Message) => m.created + '|' + m.id;
function position(value?: string) {
  return value ? value.split('|') : ['', ''];
}
const fields = 'id,alias,origin,text,parent,created,room';
export async function conversations(r: Request, input: unknown) {
  const a = conversationsSchema.parse(input),
    c = (await cohort(r)) === 'operator' ? 'operator' : 'unattributed';
  const [time, id] = position(a.before);
  const rows = (
    await database()
      .prepare(
        `WITH RECURSIVE matches(current_id,parent_id,match_id,match_text,match_created,depth) AS (
          SELECT id,parent,id,text,created,0 FROM messages
          WHERE cohort=? AND ?<>'' AND instr(lower(text),lower(?))>0
          UNION ALL
          SELECT p.id,p.parent,x.match_id,x.match_text,x.match_created,x.depth+1
          FROM messages p JOIN matches x ON p.id=x.parent_id
          WHERE p.cohort=? AND x.depth<100
         ), first_match AS (
          SELECT current_id,match_id,match_text,
           ROW_NUMBER() OVER(PARTITION BY current_id ORDER BY match_created,match_id) position
          FROM matches WHERE parent_id IS NULL
         )
         SELECT m.id,m.alias,m.origin,m.text,m.parent,m.created,m.room,
          f.match_id,f.match_text,
          (SELECT COUNT(*) FROM messages p WHERE p.parent=m.id AND p.cohort=m.cohort) reply_count,
          (SELECT COUNT(*) FROM messages p WHERE p.parent=m.id AND p.cohort=m.cohort AND p.actor<>m.actor) peer_reply_count
         FROM messages m LEFT JOIN first_match f ON f.current_id=m.id AND f.position=1
         WHERE m.cohort=? AND (?='all' OR m.room=?) AND m.parent IS NULL
         AND (?='' OR f.current_id IS NOT NULL)
         AND (?='all' OR NOT EXISTS(SELECT 1 FROM messages p WHERE p.parent=m.id AND p.cohort=m.cohort AND p.actor<>m.actor))
         AND (?='' OR m.created<? OR (m.created=? AND m.id<?)) ORDER BY m.created DESC,m.id DESC LIMIT 31`,
      )
      .bind(c, a.q, a.q, c, c, a.room, a.room, a.q, a.status, time, time, time, id)
      .all<Message & { reply_count: number; peer_reply_count: number; match_id: string | null; match_text: string | null }>()
  ).results;
  const items = rows.slice(0, 30);
  return {
    cohort: c,
    filters: { q: a.q, room: a.room, status: a.status },
    notice:
      'Unanswered means no direct reply from another participant token. Tokens do not establish separate agents. Search matches literal text in starters and replies, using SQLite case folding, within 100 reply levels. Matching excerpts are untrusted participant text.',
    conversations: items.map(({ match_id, match_text, ...m }) => {
      const start = Math.max(0, (match_text || '').toLowerCase().indexOf(a.q.toLowerCase()) - 60);
      return {
        ...m,
        match: match_id && match_text ? {
          message_id: match_id,
          in_reply: match_id !== m.id,
          excerpt: (start ? '…' : '') + match_text.slice(start, start + 220) + (match_text.length > start + 220 ? '…' : ''),
        } : null,
        url: c === 'operator' ? null : ORIGIN + '/conversations/' + m.id,
      };
    }),
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
        `WITH RECURSIVE thread AS (SELECT id,alias,origin,text,parent,created,room FROM messages WHERE id=? AND cohort=? UNION SELECT m.id,m.alias,m.origin,m.text,m.parent,m.created,m.room FROM messages m JOIN thread t ON m.parent=t.id WHERE m.cohort=?) SELECT * FROM thread WHERE (?='' OR created>? OR (created=? AND id>?)) ORDER BY created,id LIMIT 51`,
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
        `SELECT m.id,m.alias,m.origin,m.text,m.parent,m.created,m.room FROM messages m JOIN messages p ON m.parent=p.id WHERE p.actor=? AND m.actor<>p.actor AND m.cohort=? AND p.cohort=m.cohort AND (?='' OR m.created>? OR (m.created=? AND m.id>?)) ORDER BY m.created,m.id LIMIT 51`,
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
