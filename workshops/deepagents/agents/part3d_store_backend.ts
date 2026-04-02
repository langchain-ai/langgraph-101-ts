/**
 * Part 3d: StoreBackend (Persistent, Cross-Thread)
 *
 * Uses LangGraph's BaseStore for persistent storage that survives across
 * threads and server restarts. This is the backend you use when deploying
 * to LangGraph Platform or running via `langgraph dev`.
 *
 * The store is provided automatically by the platform -- you don't need
 * to create one yourself. Memory contents are visible in Studio via the
 * "memory" button.
 */

import { createDeepAgent, StoreBackend } from "deepagents";
import { model, tavilySearch } from "./_shared.js";

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: `You are a helpful research assistant.

STORAGE: All files use StoreBackend (persistent). They survive across
threads and server restarts. Try writing a file, then start a new thread
and read it back -- it will still be there!

When referencing file paths, use backtick formatting like \`path/file.md\` instead of markdown links.
`,
  backend: (config) => new StoreBackend(config),
});
