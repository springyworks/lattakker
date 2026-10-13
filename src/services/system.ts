import { ERR, McpError, type Json, type McpServer } from '../mcp/router';

/**
 * How this computer is doing: CPU load, memory, temperatures, the graphics card. For cell code (`await system.read()`),
 * for the Monitor tab and over MCP (the server `system`).
 *
 * A web page may not look at the machine it runs on, so there are two sources. While the page is served by the dev server
 * (npm run dev), that server reads /proc, /sys and nvidia-smi and the page asks it (source 'dev-server': real load and
 * temperatures). On the published page only what the browser itself tells is there (source 'browser': cores, memory
 * limits, battery, network, frames per second); the rest is null. Either way read() always answers.
 */

export interface SystemInfo {
  source: 'dev-server' | 'browser';
  time: number;
  cpu: { load: number | null; cores: number; model: string; temp: number | null };
  memory: { totalMb: number | null; usedMb: number | null } | null;
  gpu: { name: string; load: number | null; temp: number | null; memUsedMb: number | null; memTotalMb: number | null; powerW: number | null; fanPercent: number | null } | null;
  temps: Array<{ name: string; celsius: number }>;
  loadAverage: number[];
  uptimeSeconds: number | null;
  /** What only the browser knows. */
  browser: { fps: number | null; heapMb: number | null; online: boolean; network: string | null; battery: number | null; charging: boolean | null };
}

export type SeriesName = 'cpu' | 'cpuTemp' | 'gpu' | 'gpuTemp' | 'memory' | 'fps';

const ENDPOINT = '/__lattakker/system';
const KEEP = 240;
const FRESH_MS = 700;

let fps: number | null = null;
let lastRead: { at: number; value: SystemInfo } | null = null;
let inflight: Promise<SystemInfo> | null = null;
let devServer: boolean | null = null;
const history: Array<{ at: number; values: Record<SeriesName, number | null> }> = [];

/** Counts the page's own frames per second (only while somebody is looking: it starts with the first read()). */
function startFps(): void {
  if (fps !== null || typeof requestAnimationFrame !== 'function') return;
  fps = 0;
  let frames = 0;
  let since = performance.now();
  const tick = (now: number): void => {
    frames++;
    if (now - since >= 1000) {
      fps = Math.round((frames * 1000) / (now - since));
      frames = 0;
      since = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function browserInfo(): Promise<SystemInfo['browser']> {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string };
    getBattery?: () => Promise<{ level: number; charging: boolean }>;
  };
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const battery = await nav.getBattery?.().catch(() => null);
  return {
    fps: fps || null,
    heapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
    online: navigator.onLine,
    network: nav.connection?.effectiveType ?? null,
    battery: battery ? Math.round(battery.level * 100) : null,
    charging: battery ? battery.charging : null,
  };
}

async function fromServer(): Promise<Omit<SystemInfo, 'browser'> | null> {
  if (devServer === false) return null;
  try {
    const res = await fetch(ENDPOINT, { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('no server');
    const data = (await res.json()) as Omit<SystemInfo, 'browser'>;
    devServer = true;
    return data;
  } catch {
    // The published page has no such server: stop asking.
    if (devServer === null) devServer = false;
    return null;
  }
}

function record(info: SystemInfo): void {
  const memory = info.memory?.totalMb && info.memory.usedMb !== null ? Math.round((info.memory.usedMb / info.memory.totalMb) * 1000) / 10 : null;
  history.push({
    at: info.time,
    values: { cpu: info.cpu.load, cpuTemp: info.cpu.temp, gpu: info.gpu?.load ?? null, gpuTemp: info.gpu?.temp ?? null, memory, fps: info.browser.fps },
  });
  if (history.length > KEEP) history.splice(0, history.length - KEEP);
}

/** The state of this computer now. Asking twice within a moment gives the same answer. Never throws. */
export function readSystem(): Promise<SystemInfo> {
  startFps();
  if (lastRead && Date.now() - lastRead.at < FRESH_MS) return Promise.resolve(lastRead.value);
  inflight ??= (async () => {
    try {
      const [server, browser] = await Promise.all([fromServer(), browserInfo()]);
      const cores = navigator.hardwareConcurrency || 1;
      const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      const info: SystemInfo = server
        ? { ...server, browser }
        : {
            source: 'browser',
            time: Date.now(),
            cpu: { load: null, cores, model: '', temp: null },
            memory: deviceMemory || browser.heapMb !== null ? { totalMb: deviceMemory ? deviceMemory * 1024 : null, usedMb: browser.heapMb } : null,
            gpu: null,
            temps: [],
            loadAverage: [],
            uptimeSeconds: null,
            browser,
          };
      lastRead = { at: Date.now(), value: info };
      record(info);
      return info;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The last readings of one value (oldest first), ready for plot(). Gaps are left out. */
export function systemSeries(name: SeriesName, count = 60): number[] {
  return history
    .slice(-Math.max(1, Math.min(count, KEEP)))
    .map((h) => h.values[name])
    .filter((v): v is number => v !== null);
}

export function summarize(info: SystemInfo): string {
  const parts: string[] = [];
  if (info.cpu.load !== null) parts.push(`CPU ${info.cpu.load}%${info.cpu.temp !== null ? ` ${info.cpu.temp}°C` : ''}`);
  else parts.push(`${info.cpu.cores} cores`);
  if (info.memory?.usedMb != null && info.memory.totalMb) parts.push(`memory ${Math.round((info.memory.usedMb / info.memory.totalMb) * 100)}%`);
  if (info.gpu) parts.push(`GPU ${info.gpu.load ?? '?'}%${info.gpu.temp !== null ? ` ${info.gpu.temp}°C` : ''}`);
  if (info.browser.fps) parts.push(`${info.browser.fps} fps`);
  return parts.join(', ');
}

const TOOLS = [
  { name: 'read', description: 'How this computer is doing now: CPU load and temperature, memory, graphics card (load, temperature, memory), all temperature sensors, and what the browser knows (frames per second, battery, network). "source" says whether it is measured by the dev server or only guessed by the browser.', inputSchema: { type: 'object', properties: {} } },
  { name: 'history', description: 'The last readings of one value, oldest first.', inputSchema: { type: 'object', properties: { name: { type: 'string', enum: ['cpu', 'cpuTemp', 'gpu', 'gpuTemp', 'memory', 'fps'] }, count: { type: 'integer', description: 'How many, default 60, at most 240.' } }, required: ['name'] } },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The MCP server `system`. */
export class SystemServer implements McpServer {
  readonly name = 'system';
  readonly description = 'How this computer is doing: CPU, memory, temperatures, graphics card (measured when the dev server runs, browser facts otherwise).';

  async handle(method: string, params: Record<string, unknown>): Promise<Json> {
    switch (method) {
      case 'initialize':
        return { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'lattakker-system', title: 'System', version: '1' } };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return this.call(String(params.name ?? ''), isRecord(params.arguments) ? params.arguments : {});
      default:
        throw new McpError(ERR.methodNotFound, `system does not know the method "${method}"`);
    }
  }

  private async call(name: string, args: Record<string, unknown>): Promise<Json> {
    const reply = (value: Record<string, unknown>) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    switch (name) {
      case 'read': {
        const info = await readSystem();
        return reply({ ...info, summary: summarize(info) });
      }
      case 'history': {
        const series = String(args.name ?? '') as SeriesName;
        if (!['cpu', 'cpuTemp', 'gpu', 'gpuTemp', 'memory', 'fps'].includes(series)) throw new McpError(ERR.invalidParams, 'name must be one of cpu, cpuTemp, gpu, gpuTemp, memory, fps');
        await readSystem();
        return reply({ name: series, values: systemSeries(series, typeof args.count === 'number' ? args.count : 60) });
      }
      default:
        throw new McpError(ERR.methodNotFound, `system has no tool "${name}". Tools: read, history`);
    }
  }
}
