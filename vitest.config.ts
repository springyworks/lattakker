import { defineConfig } from 'vitest/config';
import { readmeSync } from './scripts/readme-sync';

// Plain logic only (no page): the files in tests/ import modules that do not need a browser. Page behaviour is checked by scripts/mcp-smoke.mjs and scripts/gui-smoke.mjs.
// readmeSync serves the virtual modules cut from README.md (it only reads there, it never writes the README).
export default defineConfig({ plugins: [readmeSync()], test: { include: ['tests/**/*.test.ts'], environment: 'node' } });
