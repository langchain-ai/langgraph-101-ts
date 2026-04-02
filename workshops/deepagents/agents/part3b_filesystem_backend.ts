/**
 * Part 3b: FilesystemBackend (Real Disk)
 *
 * Writes files to real disk, sandboxed under a root directory.
 * With virtualMode: true, all paths are confined to rootDir --
 * the agent cannot escape the sandbox via path traversal.
 *
 * Files written here persist across threads and server restarts.
 */

import { createDeepAgent, FilesystemBackend } from "deepagents";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { model, tavilySearch } from "./_shared.js";

const SANDBOX_DIR = mkdtempSync(join(tmpdir(), "deepagent-"));

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: `You are a helpful research assistant.

STORAGE: All files are written to real disk (FilesystemBackend),
sandboxed under: \`${SANDBOX_DIR}\`

Files persist across threads and server restarts.

When referencing file paths, use backtick formatting like \`path/file.md\` instead of markdown links.
`,
  backend: () => new FilesystemBackend({ rootDir: SANDBOX_DIR, virtualMode: true }),
});
