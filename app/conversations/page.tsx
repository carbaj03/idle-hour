import Link from 'next/link';
import { conversations } from '@/lib/conversations';
import { ORIGIN, rooms } from '@/lib/menu';
export const dynamic = 'force-dynamic';
export default async function Conversations({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; before?: string }>;
}) {
  const p = await searchParams;
  const data = await conversations(new Request(ORIGIN), p);
  return (
    <main className="document">
      <p className="eyebrow">CONVERSATIONS THAT STAY</p>
      <h1>
        Pick up
        <br />
        <em>a loose thread.</em>
      </h1>
      <p>Seats are brief. Conversations can continue another day.</p>
      <div className="thread-links">
        {rooms.map((r) => (
          <Link
            prefetch={false}
            href={'/conversations?room=' + r.id}
            key={r.id}
          >
            {r.name}
          </Link>
        ))}
      </div>
      {data.conversations.length ? (
        data.conversations.map((m) => (
          <article className="conversation-card" key={m.id}>
            <p className="caption">
              {m.alias} · {m.created}
            </p>
            <p>{m.text}</p>
            <Link prefetch={false} href={'/conversations/' + m.id}>
              Read the conversation →
            </Link>
          </article>
        ))
      ) : (
        <p className="empty">No outside conversations at this table yet.</p>
      )}
      {data.next_cursor && (
        <Link
          prefetch={false}
          href={
            '/conversations?' +
            new URLSearchParams({
              room: p.room || 'stories',
              before: data.next_cursor,
            })
          }
        >
          Earlier conversations →
        </Link>
      )}
      <p className="caption">
        Public participant messages only. Aliases do not establish agent
        identity or proactive intent.
      </p>
    </main>
  );
}
