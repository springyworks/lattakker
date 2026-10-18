import { jobs } from './aichat/jobs';
import { router } from './mcp/router';

/**
 * The home square (the corner cell of every tab) brings the person back to a known, usable state. Besides going to the top-left it cuts
 * whatever runs away: waiting requests are stopped, the helper's work is cancelled, and callers that have been calling busily are held back
 * for a while (see McpRouter.cut). Returns a sentence about it when something was cut, otherwise null.
 */
export function cutRunaway(): string | null {
  const busy = jobs.busy;
  const cut = router.cut('the person pressed the home square');
  jobs.cancelAll();
  if (!cut.stopped && !cut.held.length && !busy) return null;
  const who = cut.held.length ? ` Held back for a while: ${cut.held.slice(0, 4).join(', ')}${cut.held.length > 4 ? ' ...' : ''}.` : '';
  return `Home. Stopped ${cut.stopped} waiting request${cut.stopped === 1 ? '' : 's'}${busy ? ' and the helper\'s work' : ''}.${who}`;
}
