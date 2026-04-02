/**
 * Part 3c: CompositeBackend (Hybrid Routing)
 *
 * Routes different paths to different backends:
 *   /workspace/*    -> FilesystemBackend (real disk, persistent)
 *   everything else -> StateBackend (ephemeral)
 *
 * This is how you implement hybrid storage -- some paths are scratch
 * space, others are durable.
 */

import {
  createDeepAgent,
  CompositeBackend,
  FilesystemBackend,
  StateBackend,
} from "deepagents";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { model, tavilySearch } from "./_shared.js";

const SANDBOX_DIR = mkdtempSync(join(tmpdir(), "deepagent-"));

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: `You are a helpful research assistant.

STORAGE RULES:
- Files in \`/workspace/*\` are saved to real disk (persistent): \`${SANDBOX_DIR}\`
- All other files are ephemeral (disappear when thread ends)

Try writing to both locations to see the difference!

When referencing file paths, use backtick formatting like \`path/file.md\` instead of markdown links.
`,
  backend: (config) =>
    new CompositeBackend(new StateBackend(config), {
      "/workspace/": new FilesystemBackend({
        rootDir: SANDBOX_DIR,
        virtualMode: true,
      }),
    }),
});
