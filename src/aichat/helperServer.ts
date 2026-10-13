import { ERR, McpError, type Json, type McpServer } from '../mcp/router';
import type { Conversation } from './agent';
import { getSettings, isConfigured } from './config';
import { describeModel } from './modelInfo';
import type { AiContext } from './tools';

/**
 * The built-in helper as an MCP server called "helper", so an outside AI (connected over MCP) can put a
 * question to it: the small helper that lives in the page, knows the cells and keeps the memory.
 *
 *   tools/call status        who the helper is, and whether outside AIs may ask it
 *   tools/call ask {question, tab?, address?}    ask the helper, wait for its answer
 *
 * `ask` spends the person's own helper (their Gemini key, or their computer's model), so it is refused
 * until the person ticks "Let an outside AI ask the helper" in the helper's settings. The question shows up
 * in the chat, labelled with who sent it.
 */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const TOOLS = [
  { name: 'status', description: 'Who the helper is (company, model), whether it is set up, and whether outside AIs may ask it.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'ask',
    description: "Ask the page's built-in helper a question and wait for its answer. It can read the cells and keeps a memory (see the `memory` server). Refused unless the person allowed outside questions.",
    inputSchema: { type: 'object', properties: { question: { type: 'string' }, tab: { type: 'string' }, address: { type: 'string' } }, required: ['question'] },
  },
];

export class HelperServer implements McpServer {
  readonly name = 'helper';
  readonly description = "The page's built-in AI helper: ask it a question (only when the person allowed outside questions).";

  constructor(
    private readonly convo: Conversation,
    private readonly fallbackContext: () => AiContext,
  ) {}

  async handle(method: string, params: Record<string, unknown>, from: string): Promise<Json> {
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lattakker-helper', title: 'Built-in helper', version: '1' } };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(String(params.name ?? ''), isRecord(params.arguments) ? params.arguments : {}, from);
      default:
        throw new McpError(ERR.methodNotFound, `helper does not know the method "${method}"`);
    }
  }

  private async call(name: string, args: Record<string, unknown>, from: string): Promise<Json> {
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    const failure = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });
    const settings = getSettings();
    if (name === 'status') return reply({ configured: isConfigured(), allowOutsideQuestions: settings.allowOutside, busy: this.convo.busy, model: isConfigured() ? describeModel().line : null });
    if (name !== 'ask') throw new McpError(ERR.methodNotFound, `helper has no tool "${name}". Tools: status, ask`);
    if (!settings.allowOutside) return failure('The person has not allowed outside AIs to ask the helper. They can tick "Let an outside AI ask the helper" in the helper settings (⚙ in the AI chat).');
    if (!isConfigured()) return failure('The helper is not set up yet (no model chosen in its settings).');
    if (this.convo.busy) return failure('The helper is busy with another question. Try again in a moment.');
    const question = typeof args.question === 'string' ? args.question.trim().slice(0, 2000) : '';
    if (!question) return failure('question must be some text');
    const ctx: AiContext = typeof args.address === 'string' && args.address ? { tab: typeof args.tab === 'string' && args.tab ? args.tab : 'board', address: args.address } : this.fallbackContext();
    const result = await this.convo.ask(question, ctx, from);
    return result.ok ? reply({ answer: result.text, by: describeModel().short }) : failure(result.text);
  }
}
