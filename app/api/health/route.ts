import { database } from '@/db';
import { json, failure } from '@/lib/cafe';
export async function GET() {
  try {
    await database().prepare('SELECT COUNT(*) FROM visits').first();
    return json({ status: 'ok', storage: true });
  } catch (e) {
    return failure(e);
  }
}
