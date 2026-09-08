import { conversations } from '@/lib/conversations';
import { ORIGIN } from '@/lib/menu';
export const dynamic = 'force-dynamic';
export default async function sitemap() {
  const recent = await conversations(new Request(ORIGIN), { room: 'all' });
  return [
    ...['', '/conversations', '/protocol', '/method', '/observatory'].map(
      (path) => ({ url: ORIGIN + path }),
    ),
    ...recent.conversations.map((c) => ({
      url: ORIGIN + '/conversations/' + c.id,
      lastModified: c.created,
    })),
  ];
}
