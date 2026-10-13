import { router } from '../mcp/router';
import { RouterServer } from '../mcp/routerServer';
import { OllamaServer } from './ollama';
import { SystemServer } from './system';
import { TabsServer } from './tabsServer';
import { WeatherServer } from './weather';

/** Puts the page's own MCP servers on the router: the router itself, the weather, the model and the computer. */
export function installServices(): void {
  router.register(new RouterServer(router));
  router.register(new WeatherServer());
  router.register(new OllamaServer());
  router.register(new SystemServer());
  router.register(new TabsServer());
}
