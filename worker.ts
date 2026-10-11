import handler from 'vinext/server/fetch-handler';
import { dispatchNotifications } from './lib/subscription-core';
import { invalidateStatistics } from './lib/statistics-cache';
const worker = {
  fetch: handler.fetch,
  async scheduled(_event: ScheduledController, env: { DB: D1Database }) {
    const result = await dispatchNotifications(env.DB);
    if (result.attempted) await invalidateStatistics('https://cafe.agentlife.app');
  },
};
export default worker;
