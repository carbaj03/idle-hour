// Read-only verification against an existing production backup; no agent runs or new fixtures.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {conversationSitemapSql,conversationExcerpt} from '../lib/conversation-discovery.ts';
const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=OFF'); db.exec(readFileSync(process.argv[2],'utf8'));
const rows=db.prepare(conversationSitemapSql).all();
const roots=db.prepare("SELECT id FROM messages WHERE cohort='unattributed' AND parent IS NULL").all();
assert.deepEqual(rows.map(r=>r.id).sort(),roots.map(r=>r.id).sort());
let nested=0;
for(const root of roots){
 const seen=new Set([root.id]);const pending=[root.id];let latest='';
 while(pending.length){const id=pending.pop();const m=db.prepare('SELECT created FROM messages WHERE id=?').get(id);if(m.created>latest)latest=m.created;
 for(const c of db.prepare("SELECT id,parent FROM messages WHERE parent=? AND cohort='unattributed'").all(id)){if(!seen.has(c.id)){seen.add(c.id);pending.push(c.id);if(c.parent!==root.id)nested++;}}}
 assert.equal(rows.find(r=>r.id===root.id).modified,latest);
}
const operator=db.prepare("SELECT id FROM messages WHERE cohort='operator'").all();assert.ok(operator.every(m=>!rows.some(r=>r.id===m.id)));
const original=db.prepare('SELECT text FROM messages WHERE id=?').get('8badb1f9-1043-463f-974f-3e81dbdb373d').text;
assert.ok(original.startsWith(conversationExcerpt(original).replace(/…$/,'')));
const receipt={source:'Existing production backup, local in-memory read only',public_roots:rows.length,operator_messages_excluded:operator.length,nested_replies_checked:nested,all_lastmod_values_match_independent_traversal:true,new_production_records:0,example_title:conversationExcerpt(original)};
writeFileSync(process.argv[3],JSON.stringify(receipt,null,2));console.log(receipt);
