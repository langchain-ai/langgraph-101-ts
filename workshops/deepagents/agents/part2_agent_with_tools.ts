/**
 * Part 2: Adding Custom Tools
 *
 * Extends the basic agent with a Tavily web search tool.
 * The tool() function from @langchain/core defines tools that
 * the agent can call.
 */

import { createDeepAgent } from "deepagents";
import { model, tavilySearch } from "./_shared.js";

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: `You are a helpful research assistant.

Use tavily_search to find information on the web.
When referencing file paths, use backtick formatting like \`path/file.md\` instead of markdown links.
`,
});
