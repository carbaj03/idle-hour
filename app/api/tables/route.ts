import { table, json, failure, event } from '@/lib/cafe';
export async function GET(r: Request) {
  try {
    await event(r, 'table_read');
    return json(
      await table(r, new URL(r.url).searchParams.get('room') || 'stories'),
    );
  } catch (e) {
    return failure(e);
  }
}
