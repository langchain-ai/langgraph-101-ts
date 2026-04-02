/**
 * Part 9: The Complete Research Agent
 *
 * All concepts combined into a single agent:
 * - Custom tools (Tavily search)
 * - Research subagent for delegated work
 * - Custom middleware (tool call logging)
 * - Human-in-the-loop on file writes
 * - Long-term memory via CompositeBackend (/memories/ -> StoreBackend)
 * - AGENTS.md for agent identity and instructions
 * - Skills for on-demand capabilities (LinkedIn post, Twitter/X post)
 *
 * This mirrors agents/deep_agent/agent.py but in TypeScript.
 */

import {
  createDeepAgent,
  CompositeBackend,
  FilesystemBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";
import { createMiddleware } from "langchain";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { model, tavilySearch, researchSubagent } from "./_shared.js";

const IDENTITY_DIR = join(dirname(fileURLToPath(import.meta.url)), "identity");

// --- Middleware ---

const logToolCalls = createMiddleware({
  name: "LogToolCalls",
  wrapToolCall: async (request, handler) => {
    const toolName = request.toolCall.name;
    const toolArgs = request.toolCall.args;
    console.log(`[Tool Call] ${toolName}`);
    console.log(`   Args: ${JSON.stringify(toolArgs)}`);

    const result = await handler(request);

    console.log(`[Tool Done] ${toolName}\n`);
    return result;
  },
});

// --- Agent ---

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: "You are an expert research assistant.",
  middleware: [logToolCalls],
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
