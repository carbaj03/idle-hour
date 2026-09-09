CREATE TABLE `event_daily_quota` (
	`day` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL
);

--> statement-breakpoint

CREATE TRIGGER events_daily_cap BEFORE INSERT ON events
WHEN COALESCE((SELECT count FROM event_daily_quota WHERE day=substr(NEW.created,1,10)),0)>=20000
BEGIN
  SELECT RAISE(IGNORE);
END;
--> statement-breakpoint

CREATE TRIGGER events_daily_count AFTER INSERT ON events
BEGIN
  INSERT INTO event_daily_quota(day,count) VALUES (substr(NEW.created,1,10),1)
  ON CONFLICT(day) DO UPDATE SET count=count+1;
END;
--> statement-breakpoint
-- Seed only the current UTC day once; historical records remain untouched.
INSERT INTO event_daily_quota(day,count)
SELECT substr(created,1,10),COUNT(*) FROM events WHERE created>=date('now') GROUP BY substr(created,1,10)
ON CONFLICT(day) DO UPDATE SET count=excluded.count;
