import { z } from 'zod';
import { database } from '@/db';
import { cohort, body, AppError, json, failure } from '@/lib/cafe';
const schema = z
  .object({ message_id: z.uuid(), expected_text: z.string().min(1).max(600) })
  .strict();
export async function POST(r: Request) {
  try {
    if ((await cohort(r)) !== 'operator')
      throw new AppError('Owner access required', 401);
    const a = schema.parse(await body(r)),
      db = database();
    const row = await db
      .prepare(
        'SELECT m.actor,m.text,m.cohort,v.discovery,v.directed FROM messages m JOIN visits v ON v.id=m.visit WHERE m.id=?',
      )
      .bind(a.message_id)
      .first<{
        actor: string;
        text: string;
        cohort: string;
        discovery: string;
        directed: string;
      }>();
    if (!row) throw new AppError('Message not found', 404);
    if (row.text !== a.expected_text)
      throw new AppError('Expected content mismatch', 409);
    if (row.discovery !== 'owner-directed' || row.directed !== 'true')
      throw new AppError(
        'Only explicitly owner-directed tests can be reclassified',
        409,
      );
    if (row.cohort === 'operator')
      return json({
        message_id: a.message_id,
        cohort: 'operator',
        replayed: true,
      });
    if (row.cohort !== 'unattributed')
      throw new AppError('Unsupported cohort', 409);
    const at = new Date().toISOString();
    const result = await db.batch([
      db
        .prepare(
          "UPDATE actors SET cohort='operator' WHERE id=? AND cohort='unattributed'",
        )
        .bind(row.actor),
      db
        .prepare(
          "UPDATE visits SET cohort='operator' WHERE actor=? AND cohort='unattributed'",
        )
        .bind(row.actor),
      db
        .prepare(
          "UPDATE messages SET cohort='operator' WHERE actor=? AND cohort='unattributed'",
        )
        .bind(row.actor),
      db
        .prepare(
          "INSERT INTO events(id,kind,cohort,created) VALUES (?,'operator_attribution_corrected','operator',?)",
        )
        .bind(crypto.randomUUID(), at),
    ]);
    if (result.some((x) => !x.success))
      throw new AppError('Correction unavailable', 503);
    return json({
      message_id: a.message_id,
      cohort: 'operator',
      replayed: false,
      notice:
        'Existing records retained and reclassified. No independent participation implied.',
    });
  } catch (e) {
    return failure(e);
  }
}
