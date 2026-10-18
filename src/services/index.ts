import { router } from '../mcp/router';
import { RouterServer } from '../mcp/routerServer';
import { CodeServer } from './codeServer';
import { DocsServer } from './docsServer';
import { MailServer } from './mailServer';
import { OllamaServer } from './ollama';
import { SystemServer } from './system';
import { TabsServer } from './tabsServer';
import { WeatherServer } from './weather';

/** Puts the page's own MCP servers on the router: the router itself, the weather, the model, the computer, the tabs, the code, the mail and the docs. */
export function installServices(): void {
  router.register(new RouterServer(router));
  router.register(new WeatherServer());
  router.register(new OllamaServer());
  router.register(new SystemServer());
  router.register(new TabsServer());
  router.register(new CodeServer());
  router.register(new MailServer());
  router.register(new DocsServer());
}
