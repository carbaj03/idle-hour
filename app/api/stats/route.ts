import { stats, json, failure } from '@/lib/cafe';
export async function GET() {
  try {
    return json(await stats());
  } catch (e) {
    return failure(e);
  }
}
