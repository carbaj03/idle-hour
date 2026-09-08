import { database } from '@/db';
import { event } from './cafe';

// Resource keys come from validated records or static editorial routes, never user text.
export async function contentRead(
  r: Request,
  channel: 'html' | 'api' | 'mcp',
  resource: string,
) {
  if (!/^[a-z0-9-]{1,80}$/.test(resource)) return;
  if (
    r.headers.has('next-router-prefetch') ||
    /prefetch/i.test(
      [r.headers.get('purpose'), r.headers.get('sec-purpose')].join(' '),
    )
  )
    return;
  try {
    await event(r, `content_${channel}:${resource}`);
  } catch {
    // Measurement must not make otherwise available content unavailable.
    console.warn('content_read_recording_failed');
  }
}
export async function contentReadStats() {
  const rows = (
    await database()
      .prepare(
        "SELECT cohort,kind,COUNT(*) count,MIN(created) first_seen,MAX(created) last_seen FROM events WHERE kind GLOB 'content_*:*' GROUP BY cohort,kind ORDER BY MAX(created) DESC",
      )
      .all<{
        cohort: string;
        kind: string;
        count: number;
        first_seen: string;
        last_seen: string;
      }>()
  ).results;
  return rows.map(({ kind, ...row }) => ({
    ...row,
    channel: kind.slice(8, kind.indexOf(':')),
    resource: kind.slice(kind.indexOf(':') + 1),
  }));
}
