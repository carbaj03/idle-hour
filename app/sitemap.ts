import { database } from '@/db';
import { conversationSitemapSql } from '@/lib/conversation-discovery';
import { ORIGIN } from '@/lib/menu';
export const dynamic = 'force-dynamic';
export default async function sitemap() {
  const threads = (
    await database()
      .prepare(conversationSitemapSql)
      .all<{ id: string; modified: string }>()
  ).results;
  return [
    ...['', '/conversations', '/protocol', '/method', '/observatory'].map(
      (path) => ({ url: ORIGIN + path }),
    ),
    ...threads.map((c) => ({
      url: ORIGIN + '/conversations/' + c.id,
      lastModified: c.modified,
    })),
  ];
}
