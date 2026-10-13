import { router } from '../mcp/router';
import { RouterServer } from '../mcp/routerServer';
import { OllamaServer } from './ollama';
import { WeatherServer } from './weather';

/** Puts the page's own MCP servers on the router: the router itself, the weather and the model on this computer. */
export function installServices(): void {
  router.register(new RouterServer(router));
  router.register(new WeatherServer());
  router.register(new OllamaServer());
}
