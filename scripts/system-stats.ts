import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import type { Plugin } from 'vite';
import type { ServerResponse } from 'node:http';

/**
 * What this computer is doing, for the Monitor tab and the `system` global of cells. A page in a browser cannot see
 * its CPU load, temperatures or graphics card, so the dev server reads them and the page asks:
 *
 *   GET /__lattakker/system   { cpu, memory, gpu, temps, load, uptime, source }
 *
 * It reads /proc and /sys (Linux) and runs `nvidia-smi` when there is one; whatever is missing is simply left out.
 * Only this computer may ask (loopback), the same rule as the memory file. The published page has no such server and
 * falls back to what the browser itself can tell (see src/services/system.ts).
 */

const URL_PATH = '/__lattakker/system';
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

interface CpuTimes {
  idle: number;
  total: number;
}

let lastTimes: CpuTimes | null = null;
let gpuCache: { at: number; value: unknown } | null = null;
let modelCache = '';

const read = async (path: string): Promise<string | null> => readFile(path, 'utf8').catch(() => null);

async function cpuTimes(): Promise<CpuTimes | null> {
  const text = await read('/proc/stat');
  const line = text?.split('\n')[0];
  if (!line?.startsWith('cpu ')) return null;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (n[3] ?? 0) + (n[4] ?? 0);
  return { idle, total: n.reduce((a, b) => a + b, 0) };
}

/** CPU load in percent since the last look (the first look waits a moment to have something to compare with). */
async function cpuLoad(): Promise<number | null> {
  const first = lastTimes ?? (await cpuTimes());
  if (!lastTimes) await new Promise((r) => setTimeout(r, 120));
  const now = await cpuTimes();
  lastTimes = now;
  if (!first || !now || now.total === first.total) return null;
  return Math.round((1 - (now.idle - first.idle) / (now.total - first.total)) * 1000) / 10;
}

async function temperatures(): Promise<Array<{ name: string; celsius: number }>> {
  const out: Array<{ name: string; celsius: number }> = [];
  const zones = await readdir('/sys/class/thermal').catch(() => [] as string[]);
  for (const z of zones.filter((n) => n.startsWith('thermal_zone'))) {
    const [type, temp] = await Promise.all([read(`/sys/class/thermal/${z}/type`), read(`/sys/class/thermal/${z}/temp`)]);
    const c = Number(temp) / 1000;
    if (type && Number.isFinite(c) && c > -50 && c < 150) out.push({ name: type.trim(), celsius: Math.round(c * 10) / 10 });
  }
  return out;
}

function nvidia(): Promise<unknown> {
  if (gpuCache && Date.now() - gpuCache.at < 900) return Promise.resolve(gpuCache.value);
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,fan.speed', '--format=csv,noheader,nounits'], { timeout: 1500 }, (err, stdout) => {
      let value: unknown = null;
      if (!err) {
        const [name, load, temp, used, total, power, fan] = stdout.trim().split('\n')[0].split(',').map((s) => s.trim());
        const num = (s: string | undefined): number | null => (s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : null);
        value = { name, load: num(load), temp: num(temp), memUsedMb: num(used), memTotalMb: num(total), powerW: num(power), fanPercent: num(fan) };
      }
      gpuCache = { at: Date.now(), value };
      resolve(value);
    });
  });
}

async function snapshot(): Promise<Record<string, unknown>> {
  const [load, temps, gpu, meminfo, cpuinfo] = await Promise.all([cpuLoad(), temperatures(), nvidia(), read('/proc/meminfo'), modelCache ? Promise.resolve(null) : read('/proc/cpuinfo')]);
  if (cpuinfo) modelCache = /model name\s*:\s*(.*)/.exec(cpuinfo)?.[1]?.trim() ?? '';
  const kb = (key: string): number | null => {
    const m = new RegExp(`${key}:\\s+(\\d+)`).exec(meminfo ?? '');
    return m ? Number(m[1]) : null;
  };
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  const cpuTemp = temps.find((t) => /pkg_temp|coretemp|k10temp|cpu/i.test(t.name))?.celsius ?? null;
  return {
    source: 'dev-server',
    time: Date.now(),
    cpu: { load, cores: os.cpus().length, model: modelCache || os.cpus()[0]?.model || '', temp: cpuTemp },
    memory: total && available ? { totalMb: Math.round(total / 1024), usedMb: Math.round((total - available) / 1024) } : null,
    gpu,
    temps,
    loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100),
    uptimeSeconds: Math.round(os.uptime()),
  };
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export function systemStats(): Plugin {
  return {
    name: 'lattakker-system-stats',
    configureServer(server) {
      server.middlewares.use(URL_PATH, (req, res, next) => {
        if (req.method !== 'GET') return next();
        if (!LOOPBACK.test(req.headers.host ?? '')) return send(res, 403, { error: 'Only this computer may ask.' });
        snapshot().then(
          (value) => send(res, 200, value),
          (err: unknown) => send(res, 500, { error: err instanceof Error ? err.message : String(err) }),
        );
      });
    },
  };
}
