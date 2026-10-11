"""Execute the shipped statistics/list SQL against isolated adversarial fixtures."""
import re, sqlite3, pathlib
root=pathlib.Path(__file__).resolve().parents[1]
db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
for migration in sorted((root/'drizzle').glob('*.sql')):
 db.executescript(migration.read_text())
s=(root/'lib/cafe.ts').read_text().split('async function uncachedStatistics()',1)[1]
def query(name):
 part=s.split('    '+name+':',1)[1]
 match=re.search(r'\.prepare\(\s*([\'"`])(.*?)\1',part,re.S)
 return match[2]
def rows(name): return [dict(x) for x in db.execute(query(name))]
hostsql=(root/'lib/host-outcomes.ts').read_text().split('`',2)[1]
def hosts(): return [dict(x) for x in db.execute(hostsql)]
def actor(a,origin='participant',c='unattributed'):
 db.execute('INSERT INTO actors VALUES (?,?,?,?)',(a,c,'2026-10-11T10:00:00.000Z',origin))
def visit(v,a,t,origin='participant',c='unattributed'):
 db.execute('INSERT INTO visits (id,actor,cohort,origin,alias,room,created,expires,"left",discovery,directed) VALUES (?,?,?,?,?,?,?,?,?,?,?)',(v,a,c,origin,a,'stories',t,t,t,'unspecified','unspecified'))
def msg(m,a,v,t,parent=None,origin='participant',c='unattributed'):
 db.execute('INSERT INTO messages (id,actor,visit,cohort,origin,room,alias,text,parent,created,idem) VALUES (?,?,?,?,?,?,?,?,?,?,?)',(m,a,v,c,origin,'stories',a,'host-regression',parent,t,m))
actor('a'); visit('a0','a','2026-10-11T10:00:00.000Z');msg('root','a','a0','2026-10-11T10:01:00.000Z')
before={k:rows(k) for k in ['actors','visits','messages','cross_token_replies','returning_tokens','conversation_outcomes','asynchronous_replies','editorial']}
actor('host','editorial');visit('host-v','host','2026-10-11T11:00:00.000Z','editorial');msg('host-r','host','host-v','2026-10-11T11:00:00.000Z','root','editorial')
assert {k:rows(k) for k in before}==before, 'Host must change none of the participant or starter metrics'
assert hosts()[0]['replies_sent']==1 and hosts()[0]['original_authors_returned']==0
# A pre-treatment return must not be credited to the host.
visit('a-before','a','2026-10-11T10:30:00.000Z');assert hosts()[0]['original_authors_returned']==0
visit('a-after','a','2026-10-11T11:01:00.000Z');assert hosts()[0]['original_authors_returned']==1
msg('response','a','a-after','2026-10-11T11:02:00.000Z','host-r')
assert hosts()[0]['original_authors_replied']==1 and hosts()[0]['visitor_replies']==1
assert rows('cross_token_replies')==[]
assert rows('conversation_outcomes')[0]['starters_with_peer_reply']==0
# Follow-ups to the host and multiple host replies cannot multiply distinct author outcomes.
msg('response2','a','a-after','2026-10-11T11:03:00.000Z','host-r')
msg('host-r2','host','host-v','2026-10-11T11:04:00.000Z','root','editorial')
assert hosts()[0]['original_authors_replied']==1 and hosts()[0]['recipient_tokens']==1
actor('b');visit('b0','b','2026-10-11T11:05:00.000Z');msg('other-host-response','b','b0','2026-10-11T11:06:00.000Z','host-r')
assert hosts()[0]['visitor_replies']==3 and hosts()[0]['original_authors_replied']==1
assert rows('cross_token_replies')==[]
# Real peer reply still counts; self-replies don't.
msg('self','a','a-after','2026-10-11T11:07:00.000Z','root')
assert rows('cross_token_replies')==[]
msg('peer','b','b0','2026-10-11T11:08:00.000Z','root')
assert rows('cross_token_replies')[0]['count']==1
assert rows('conversation_outcomes')[0]['starters_with_peer_reply']==1
assert rows('asynchronous_replies')[0]['count']==1
# Editorial starters remain distinct from host replies and their responses.
msg('house','host','host-v','2026-10-11T11:09:00.000Z',origin='editorial')
msg('house-response','a','a-after','2026-10-11T11:10:00.000Z','house')
assert rows('editorial')==[{'starters':1,'replies':1,'starters_with_reply':1}]
# Operator cohort is isolated even if malformed cross-cohort relationships exist.
actor('op','participant','operator');visit('op0','op','2026-10-11T11:11:00.000Z',c='operator');msg('op-response','op','op0','2026-10-11T11:12:00.000Z','host-r',c='operator')
assert hosts()[0]['visitor_replies']==3
# Execute the real conversation-list SQL: host alone leaves a thread awaiting a visitor.
msg('root2','a','a-after','2026-10-11T11:13:00.000Z');msg('host-only','host','host-v','2026-10-11T11:14:00.000Z','root2','editorial')
ls=(root/'lib/conversations.ts').read_text().split('`WITH RECURSIVE matches',1)[1].split('`',1)[0]
params=['unattributed','','','unattributed','unattributed','all','all','','unanswered','','','','']
listed=[dict(x) for x in db.execute('WITH RECURSIVE matches'+ls,params)]
r=next(x for x in listed if x['id']=='root2')
assert r['host_reply_count']==1 and r['peer_reply_count']==r['visitor_reply_count']==0
assert not any(x['id']=='root' for x in listed)
print('PASS: shipped SQLite queries preserve host/visitor/peer/starters attribution, temporal ordering, distinct recipients, cohort isolation and unanswered filtering')
