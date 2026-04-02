/**
 * Part 7a: Basic Long-Term Memory
 *
 * Routes /memories/ to StoreBackend for persistent cross-thread storage.
 * Everything else stays in the default FilesystemBackend (ephemeral).
 *
 * Try saving a file to /memories/, then start a new thread and read it
 * back -- it will still be there!
 */

import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";
import { model, tavilySearch, researchSubagent } from "./_shared.js";

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: `You are a helpful research assistant with long-term memory.

IMPORTANT: Save important notes to /memories/ so they persist across threads.
For example: /memories/research_notes.md

Regular files (not in /memories/) are only visible within the current thread.
Files in /memories/ persist across threads.

When referencing file paths, use backtick formatting like \`path/file.md\` instead of markdown links.
`,
  subagents: [researchSubagent],
  backend: (config) =>
    new CompositeBackend(
      new StateBackend(config),
      {
        "/memories/": new StoreBackend(config),
      }
    ),
});
