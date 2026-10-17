import { defineConfig } from 'vitest/config';

// Plain logic only (no page): the files in tests/ import modules that do not need a browser. Page behaviour is checked by scripts/mcp-smoke.mjs and scripts/gui-smoke.mjs.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
