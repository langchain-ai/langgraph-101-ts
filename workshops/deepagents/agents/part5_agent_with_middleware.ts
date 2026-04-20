/**
 * Part 5: Middleware Deep Dive
 *
 * Adds custom middleware that logs every tool call the agent makes.
 * In LangGraph Studio, these logs appear in the terminal output.
 *
 * Deep Agents uses a modular middleware architecture. Built-in middleware
 * includes TodoListMiddleware and FilesystemMiddleware. You can add your
 * own via createMiddleware().
 */

import { createDeepAgent } from "deepagents";
import { createMiddleware } from "langchain";
import { model, tavilySearch } from "./_shared.js";

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

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt:
    "You are a helpful research assistant. When referencing file paths, use backtick formatting like `path/file.md` instead of markdown links.",
  middleware: [logToolCalls],
});
