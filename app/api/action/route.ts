import { body, action, json, failure } from '@/lib/cafe';
export async function POST(r: Request) {
  try {
    const p = await body(r);
    return json(await action(r, p.action, p.input));
  } catch (e) {
    return failure(e);
  }
}
