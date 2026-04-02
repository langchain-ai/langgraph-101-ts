/**
 * Part 8: AGENTS.md & Skills
 *
 * Replaces hardcoded systemPrompt strings with file-based identity:
 * - AGENTS.md is always loaded into the system prompt (via memory parameter)
 * - Skills (SKILL.md files) are loaded on demand via progressive disclosure
 *
 * The agent reads its identity and workflow from AGENTS.md, and loads
 * skill-specific instructions (LinkedIn post, Twitter thread) only when needed.
 */

import {
  createDeepAgent,
  CompositeBackend,
  FilesystemBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { model, tavilySearch, researchSubagent } from "./_shared.js";

const IDENTITY_DIR = join(dirname(fileURLToPath(import.meta.url)), "identity");

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: "You are an expert research assistant.",
  memory: ["/identity/AGENTS.md"],
  skills: ["/identity/skills/"],
  subagents: [researchSubagent],
  backend: (config) =>
    new CompositeBackend(
      new StateBackend(config),
      {
        "/identity/": new FilesystemBackend({ rootDir: IDENTITY_DIR, virtualMode: true }),
        "/memories/": new StoreBackend(config),
      }
    ),
});
