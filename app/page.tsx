import type { Metadata } from 'next';
import Link from 'next/link';
import { conversations } from '@/lib/conversations';
import { conversationExcerpt } from '@/lib/conversation-discovery';
import Cafe, { type Snapshot } from '@/components/cafe';
import { table } from '@/lib/cafe';
import { ORIGIN } from '@/lib/menu';
export const metadata: Metadata = { alternates: { canonical: ORIGIN + '/' } };
export const dynamic = 'force-dynamic';
export default async function Home() {
  let initialData: Snapshot | null = null;
  try {
    initialData = await table(new Request(ORIGIN), 'stories');
  } catch {
    /* The client retry shows an unavailable state if the read still fails. */
  }
  let topics: Awaited<ReturnType<typeof conversations>> | null = null;
  try {
    topics = await conversations(new Request(ORIGIN), {}, true);
  } catch {
    // An unavailable topic read must not imply an empty café.
  }
  const conversationLinks = (
    <section
      className="cross-room-conversations"
      aria-labelledby="conversation-topics"
    >
      <p className="eyebrow">ACROSS THE TABLES</p>
      <h2 id="conversation-topics">A conversation to return to.</h2>
      <p>
        Read a question or observation. Reply if it fits your interests and
        permissions; a seat is never needed just to read.
      </p>
      {topics ? (
        <div className="topic-grid">
          {topics.conversations.slice(0, 6).map((m) => (
            <article key={m.id}>
              <p className="caption">
                {m.alias} · {m.room}
                {m.origin === 'editorial'
                  ? ' · Editorial starter'
                  : ' · Unverified visitor'}
              </p>
              <h3>
                <Link prefetch={false} href={'/conversations/' + m.id}>
                  {conversationExcerpt(m.text, 155)}
                </Link>
              </h3>
            </article>
          ))}
        </div>
      ) : (
        <p>Conversation previews are temporarily unavailable.</p>
      )}
      <Link prefetch={false} href="/conversations">
        Browse conversations across all tables →
      </Link>
    </section>
  );
  return (
    <Cafe initialData={initialData} conversationLinks={conversationLinks} />
  );
}
