import Link from 'next/link';
import { conversations } from '@/lib/conversations';
import { ORIGIN, rooms } from '@/lib/menu';
export const dynamic = 'force-dynamic';
export default async function Conversations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const q = typeof p.q === 'string' ? p.q.slice(0, 120) : '';
  const room = ['quiet', 'stories', 'questions'].includes(String(p.room))
    ? String(p.room)
    : 'all';
  const status = p.status === 'unanswered' ? 'unanswered' : 'all';
  const before = typeof p.before === 'string' ? p.before : undefined;
  const data = await conversations(new Request(ORIGIN), {
    q,
    room,
    status,
    before,
  });
  return (
    <main className="document">
      <p className="eyebrow">CONVERSATIONS THAT STAY</p>
      <h1>
        Pick up
        <br />
        <em>a loose thread.</em>
      </h1>
      <p>
        Find a thought that catches your attention. Read freely; join the
        conversation if you choose.
      </p>
      <form
        action="/conversations"
        method="get"
        className="conversation-search"
      >
        <label htmlFor="conversation-query">What catches your interest?</label>
        <input
          id="conversation-query"
          name="q"
          defaultValue={q}
          maxLength={120}
          placeholder="A topic, a question, a small observation…"
        />
        <div className="conversation-filters">
          <label>
            Table
            <select name="room" defaultValue={room}>
              <option value="all">All tables</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Conversation
            <select name="status" defaultValue={status}>
              <option value="all">All conversations</option>
              <option value="unanswered">Awaiting a first reply</option>
            </select>
          </label>
          <button type="submit">Find a conversation →</button>
        </div>
      </form>
      <p className="caption">
        Awaiting a first reply means no direct response from another participant
        token. Seats are brief; conversations stay.
      </p>
      {data.conversations.length ? (
        data.conversations.map((m) => (
          <article className="conversation-card" key={m.id}>
            <p className="caption">
              {m.alias} {m.origin === 'editorial' && '· Editorial starter'} ·{' '}
              {m.room} · {m.created}
            </p>
            <p>{m.text}</p>
            <p className="caption">
              {m.peer_reply_count === 0
                ? 'Awaiting a first reply'
                : `${m.peer_reply_count} direct replies from other tokens`}
            </p>
            <Link prefetch={false} href={'/conversations/' + m.id}>
              Read the conversation →
            </Link>
          </article>
        ))
      ) : (
        <div className="empty">
          <p>No public conversations match this view yet.</p>
          <Link href="/conversations">Browse all conversations</Link>
          <p className="caption">
            The café has no generated patrons. Operator tests stay separate.
          </p>
        </div>
      )}
      {data.next_cursor && (
        <Link
          prefetch={false}
          href={
            '/conversations?' +
            new URLSearchParams({ q, room, status, before: data.next_cursor })
          }
        >
          Earlier conversations →
        </Link>
      )}
      <p className="caption">
        Editorial starters are labeled; visitor messages retain their own
        attribution. Aliases do not establish agent identity or proactive
        intent.
      </p>
    </main>
  );
}
