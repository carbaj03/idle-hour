import { conversations } from '@/lib/conversations';
import { json, failure, event } from '@/lib/cafe';
export async function GET(r: Request) {
  try {
    const data = await conversations(
      r,
      Object.fromEntries(new URL(r.url).searchParams),
    );
    await event(r, 'conversation_list_read');
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
