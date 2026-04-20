/**
 * Part 3a: StateBackend (Ephemeral)
 *
 * The default backend. Files live in the agent's state (in-memory) and
 * persist within a thread, but vanish when the thread ends.
 *
 * This is what you get when you don't specify a backend -- great for
 * scratch pads and intermediate work.
 */

import { createDeepAgent, StateBackend } from "deepagents";
import { model, tavilySearch } from "./_shared.js";

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: `You are a helpful research assistant.

STORAGE: All files are ephemeral (StateBackend). They persist within this
conversation but disappear when you start a new thread.

When referencing file paths, use backtick formatting like \`path/file.md\` instead of markdown links.
`,
  backend: (config) => new StateBackend(config),
});
