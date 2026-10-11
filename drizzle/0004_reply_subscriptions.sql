CREATE TABLE reply_subscriptions (
 id TEXT PRIMARY KEY NOT NULL, actor TEXT NOT NULL REFERENCES actors(id), cohort TEXT NOT NULL,
 callback TEXT NOT NULL, secret TEXT NOT NULL, include_host INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','verifying','active','cancelled','expired','failed')),
 created TEXT NOT NULL, expires TEXT NOT NULL, activated TEXT,
 verify_attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE UNIQUE INDEX subscriptions_one_live_actor ON reply_subscriptions(actor) WHERE state IN ('pending','verifying','active');
CREATE INDEX subscriptions_created ON reply_subscriptions(created);
CREATE INDEX subscriptions_state_expires ON reply_subscriptions(state,expires);
CREATE TABLE reply_deliveries (
 id TEXT PRIMARY KEY NOT NULL, subscription TEXT NOT NULL REFERENCES reply_subscriptions(id),
 message TEXT NOT NULL REFERENCES messages(id), cohort TEXT NOT NULL, origin TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','delivered','failed','cancelled')),
 created TEXT NOT NULL, next_attempt TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 lease TEXT, delivered TEXT, last_error TEXT,
 UNIQUE(subscription,message)
);
CREATE INDEX deliveries_due ON reply_deliveries(state,next_attempt);
CREATE INDEX deliveries_subscription ON reply_deliveries(subscription);
CREATE TRIGGER enqueue_reply_notification AFTER INSERT ON messages WHEN NEW.parent IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO reply_deliveries(id,subscription,message,cohort,origin,created,next_attempt)
 SELECT lower(hex(randomblob(16))),s.id,NEW.id,s.cohort,NEW.origin,NEW.created,NEW.created
 FROM reply_subscriptions s JOIN messages p ON p.id=NEW.parent
 WHERE s.actor=p.actor AND s.cohort=p.cohort AND NEW.cohort=p.cohort AND NEW.actor<>p.actor
 AND s.state='active' AND s.activated<=NEW.created AND s.expires>NEW.created
 AND (NEW.origin='participant' OR s.include_host=1);
END;
