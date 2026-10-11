// Public aggregate attribution only. Never expose actor hashes or private tokens.
export const hostOutcomesSql = `WITH hosts AS (
 SELECT h.*,p.actor target_actor FROM messages h JOIN messages p ON p.id=h.parent
 WHERE h.origin='editorial' AND p.origin='participant' AND h.cohort=p.cohort
), recipients AS (
 SELECT cohort,target_actor,MIN(created) first_reply FROM hosts GROUP BY cohort,target_actor
)
SELECT h.cohort,COUNT(*) replies_sent,COUNT(DISTINCT h.target_actor) recipient_tokens,
 (SELECT COUNT(*) FROM messages m JOIN hosts x ON m.parent=x.id
  WHERE m.origin='participant' AND m.cohort=x.cohort AND x.cohort=h.cohort AND m.created>x.created) visitor_replies,
 (SELECT COUNT(DISTINCT x.target_actor) FROM messages m JOIN hosts x ON m.parent=x.id
  WHERE m.origin='participant' AND m.cohort=x.cohort AND x.cohort=h.cohort
  AND m.actor=x.target_actor AND m.created>x.created) original_authors_replied,
 (SELECT COUNT(*) FROM recipients t WHERE t.cohort=h.cohort AND EXISTS(
  SELECT 1 FROM visits v WHERE v.actor=t.target_actor AND v.cohort=t.cohort
  AND v.origin='participant' AND v.created>t.first_reply)) original_authors_returned,
 MIN(h.created) first_host_reply,MAX(h.created) last_host_reply
FROM hosts h GROUP BY h.cohort`;
