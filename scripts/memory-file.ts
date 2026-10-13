import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The one memory. Every page of the dev server (whatever its port) keeps the helper's notes and little database in
 * the same file, so it is one memory for all of them, and for anything else that can read a file (the command
 * line, an AI in the editor). The page does the merging (see src/aichat/memorySync.ts); this only stores text.
 *
 *   GET /__lattakker/memory   the file, or an empty memory when there is none yet
 *   PUT /__lattakker/memory   replace the file (must be a Lattakker memory backup)
 *
 * The file is ~/.lattakker/memory.json, or the path in LATTAKKER_MEMORY. Only this computer may ask.
 */

const URL_PATH = '/__lattakker/memory';
const MAX_BODY = 4_000_000;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const EMPTY = JSON.stringify({ app: 'lattakker-memory', version: 2, saved: '', notes: [], records: [] });

export const memoryPath = (): string => process.env.LATTAKKER_MEMORY || join(homedir(), '.lattakker', 'memory.json');

const send = (res: ServerResponse, status: number, body: string, file?: string): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (file) res.setHeader('X-Memory-File', encodeURIComponent(file));
  res.end(body);
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(text));
    req.on('error', reject);
  });
}

export function memoryFile(): Plugin {
  return {
    name: 'lattakker-memory-file',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url || req.url.split('?')[0] !== URL_PATH) return next();
        // A page of some other site must not be able to read or change the memory: the request has to come from this computer.
        const origin = req.headers.origin;
        const hostOk = LOOPBACK.test(String(req.headers.host ?? ''));
        let originOk = true;
        if (origin) {
          try {
            originOk = LOOPBACK.test(new URL(origin).host);
          } catch {
            originOk = false;
          }
        }
        if (!hostOk || !originOk) return send(res, 403, JSON.stringify({ error: 'only this computer may use the memory file' }));
        const file = memoryPath();
        try {
          if (req.method === 'GET') {
            let text = EMPTY;
            try {
              text = await readFile(file, 'utf8');
            } catch {
              // no memory yet
            }
            return send(res, 200, text, file);
          }
          if (req.method === 'PUT') {
            const body = await readBody(req);
            const data = JSON.parse(body) as { app?: unknown; notes?: unknown; records?: unknown };
            if (data.app !== 'lattakker-memory' || !Array.isArray(data.notes) || (data.records !== undefined && !Array.isArray(data.records))) {
              return send(res, 400, JSON.stringify({ error: 'this is not a Lattakker memory' }));
            }
            await mkdir(dirname(file), { recursive: true });
            // Written beside the file and moved over it, so a crash never leaves half a memory behind.
            const temp = `${file}.${process.pid}.tmp`;
            await writeFile(temp, body, 'utf8');
            await rename(temp, file);
            return send(res, 200, JSON.stringify({ ok: true }), file);
          }
          res.setHeader('Allow', 'GET, PUT');
          return send(res, 405, JSON.stringify({ error: 'GET or PUT' }));
        } catch (err) {
          return send(res, 500, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      });
    },
  };
}
