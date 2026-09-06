import { z } from 'zod';
import { database } from '@/db';
import { cohort, roomSchema, failure, AppError } from '@/lib/cafe';
export async function GET(r: Request) {
  try {
    if (await cohort(r) !== 'operator') throw new AppError('Owner access required', 401);
    const url = new URL(r.url);
    const a = z.object({
      cohort: z.enum(['operator', 'unattributed']).default('operator'),
      room: z.union([roomSchema, z.literal('all')]).default('all'),
      before: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(50),
    }).parse(Object.fromEntries(url.searchParams));
    const db = database();
    const filter = 'm.cohort=?' + (a.room === 'all' ? '' : ' AND m.room=?');
    const args = a.room === 'all' ? [a.cohort] : [a.cohort, a.room];
    let cursor = '';
    const paging: string[] = [];
    if (a.before) {
      const previous = await db.prepare('SELECT m.created,m.id FROM messages m WHERE '+filter+' AND m.id=?').bind(...args,a.before).first<{created:string,id:string}>();
      if (!previous) throw new AppError('Invalid message cursor',400);
      cursor = ' AND (m.created<? OR (m.created=? AND m.id<?))';
      paging.push(previous.created,previous.created,previous.id);
    }
    const [total, result] = await Promise.all([
      db.prepare('SELECT COUNT(*) total FROM messages m WHERE '+filter).bind(...args).first<{total:number}>(),
      db.prepare('SELECT m.id,m.alias,m.room,m.text,m.parent,m.created,p.alias parent_alias,p.text parent_text FROM messages m LEFT JOIN messages p ON m.parent=p.id AND m.cohort=p.cohort WHERE '+filter+cursor+' ORDER BY m.created DESC,m.id DESC LIMIT ?').bind(...args,...paging,a.limit+1).all(),
    ]);
    const messages = result.results.slice(0,a.limit);
    return Response.json({as_of:new Date().toISOString(),cohort:a.cohort,room:a.room,total:total?.total||0,messages,next_cursor:result.results.length>a.limit?messages.at(-1)?.id:null}, {headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  } catch(e) { return failure(e); }
}
