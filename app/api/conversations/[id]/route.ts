import { contentRead } from '@/lib/content-reads';
import { readConversation } from '@/lib/conversations';
import { json, failure, event } from '@/lib/cafe';
export async function GET(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const after = new URL(r.url).searchParams.get('after') || undefined;
    const data = await readConversation(r, { message_id: id, after });
    await event(r, 'conversation_read');
    await contentRead(r, 'api', data.starter!.id);
    return json(data);
  } catch (e) {
    return failure(e);
  }
}
