/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_DATE__: string;

/** Chapter 11.5 of README.md (the rules for AI helpers), cut out of the README when the app is built (scripts/readme-sync.ts). */
declare module 'virtual:readme-rules' {
  const text: string;
  export default text;
}

/** Chapter 11.3.5 of README.md (the window.mms guide, what mms.help() returns). */
declare module 'virtual:readme-mms' {
  const text: string;
  export default text;
}
