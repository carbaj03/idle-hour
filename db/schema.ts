import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
