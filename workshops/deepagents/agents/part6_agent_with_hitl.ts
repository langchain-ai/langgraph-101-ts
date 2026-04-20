/**
 * Part 6: Human-in-the-Loop
 *
 * Adds interrupt-based approval for file write/edit operations.
 * When running in LangGraph Studio, the UI will pause and show the
 * pending action for approval before proceeding.
 *
 * No explicit checkpointer needed -- langgraph dev provides it automatically.
 *
 * To approve an action in Studio, enter: {"decisions": [{"type": "approve"}]}
 */

import { createDeepAgent } from "deepagents";
import { model, tavilySearch, researchSubagent } from "./_shared.js";

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt:
    "You are a helpful research assistant. When referencing file paths, use backtick formatting like `path/file.md` instead of markdown links.",
  subagents: [researchSubagent],
  interruptOn: {
    write_file: true,
    edit_file: true,
  },
});
