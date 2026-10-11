import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
export const actors = sqliteTable(
  'actors',
  {
    id: text('id').primaryKey(),
    cohort: text('cohort').notNull(),
    origin: text('origin', { enum: ['participant', 'editorial'] })
      .notNull()
      .default('participant'),
    created: text('created').notNull(),
  },
  (t) => [index('actors_created').on(t.created)],
);
export const visits = sqliteTable(
  'visits',
  {
    id: text('id').primaryKey(),
    actor: text('actor')
      .notNull()
      .references(() => actors.id),
    cohort: text('cohort').notNull(),
    origin: text('origin', { enum: ['participant', 'editorial'] })
      .notNull()
      .default('participant'),
    alias: text('alias').notNull(),
    room: text('room').notNull(),
    created: text('created').notNull(),
    expires: text('expires').notNull(),
    left: text('left'),
    discovery: text('discovery').notNull(),
    directed: text('directed').notNull(),
  },
  (t) => [
    index('visits_actor_created').on(t.actor, t.created),
    index('visits_room_expires').on(t.room, t.expires),
    index('visits_created').on(t.created),
  ],
);
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    actor: text('actor')
      .notNull()
      .references(() => actors.id),
    visit: text('visit')
      .notNull()
      .references(() => visits.id),
    cohort: text('cohort').notNull(),
    origin: text('origin', { enum: ['participant', 'editorial'] })
      .notNull()
      .default('participant'),
    room: text('room').notNull(),
    alias: text('alias').notNull(),
    text: text('text').notNull(),
    parent: text('parent'),
    created: text('created').notNull(),
    idem: text('idem').notNull(),
  },
  (t) => [
    uniqueIndex('messages_actor_idem').on(t.actor, t.idem),
    index('messages_room_created').on(t.room, t.created),
    index('messages_visit').on(t.visit),
    index('messages_parent').on(t.parent),
    index('messages_created').on(t.created),
  ],
);
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    cohort: text('cohort').notNull(),
    created: text('created').notNull(),
  },
  (t) => [index('events_created').on(t.created)],
);

export const eventDailyQuota = sqliteTable('event_daily_quota', {
  day: text('day').primaryKey(),
  count: integer('count').notNull(),
});

export const replySubscriptions = sqliteTable('reply_subscriptions', {
  id: text('id').primaryKey(),
  actor: text('actor')
    .notNull()
    .references(() => actors.id),
  cohort: text('cohort').notNull(),
  callback: text('callback').notNull(),
  secret: text('secret').notNull(),
  includeHost: integer('include_host').notNull(),
  state: text('state').notNull(),
  created: text('created').notNull(),
  expires: text('expires').notNull(),
  activated: text('activated'),
  verifyAttempts: integer('verify_attempts').notNull().default(0),
  lastError: text('last_error'),
});
export const replyDeliveries = sqliteTable('reply_deliveries', {
  id: text('id').primaryKey(),
  subscription: text('subscription')
    .notNull()
    .references(() => replySubscriptions.id),
  message: text('message')
    .notNull()
    .references(() => messages.id),
  cohort: text('cohort').notNull(),
  origin: text('origin').notNull(),
  state: text('state').notNull().default('pending'),
  created: text('created').notNull(),
  nextAttempt: text('next_attempt').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lease: text('lease'),
  delivered: text('delivered'),
  lastError: text('last_error'),
});
