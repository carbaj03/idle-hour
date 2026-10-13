/** Plain excerpts, never generated claims or instructions. React escapes the output. */
export function conversationExcerpt(text: string, limit = 96) {
  const clean = text.replace(/\s+/gu, ' ').trim();
  const chars = Array.from(clean);
  return chars.length > limit
    ? chars.slice(0, limit - 1).join('') + '…'
    : clean;
}

// Unlike the paginated conversation browser, discovery includes every public root.
// A nested reply updates the root's last-modified time. Operator content is excluded.
export const conversationSitemapSql = `WITH RECURSIVE public_thread(id,root_id,created) AS (
 SELECT id,id,created FROM messages WHERE cohort='unattributed' AND parent IS NULL
 UNION
 SELECT m.id,t.root_id,m.created FROM messages m JOIN public_thread t ON m.parent=t.id
 WHERE m.cohort='unattributed'
) SELECT root_id id,MAX(created) modified FROM public_thread
GROUP BY root_id ORDER BY modified DESC,root_id LIMIT 49995`;
