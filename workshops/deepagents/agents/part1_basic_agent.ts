/**
 * Part 1: Your First Deep Agent (The Harness)
 *
 * The most basic deep agent -- just a model! Even without custom tools,
 * createDeepAgent() gives you filesystem (write_file, read_file, ls, etc.)
 * and planning (write_todos) capabilities for free.
 */

import { createDeepAgent } from "deepagents";
import { model } from "./_shared.js";

export const agent = createDeepAgent({
  model,
  systemPrompt:
    "You are a helpful research assistant. When referencing file paths, use backtick formatting like `path/file.md` instead of markdown links.",
});
