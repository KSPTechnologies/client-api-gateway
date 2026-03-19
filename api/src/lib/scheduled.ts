import { Env } from '../index';

export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  switch (event.cron) {
    case '*/15 * * * *':
      // TODO: Phase 4 — poll Logiwa for tracking updates, push to client callbacks
      console.log('Tracking sync triggered');
      break;

    case '0 * * * *':
      // TODO: Phase 4 — refresh inventory cache from Logiwa
      console.log('Inventory cache refresh triggered');
      break;

    default:
      console.log(`Unknown cron: ${event.cron}`);
  }
}
