/**
 * Part 4: Adding a Research Subagent
 *
 * Introduces subagent delegation via the task() tool. The main agent
 * acts as an orchestrator -- it delegates research to the research-agent
 * and synthesizes the results.
 *
 * Subagents run in isolated contexts: the main agent only sees the final
 * result, not intermediate tool calls.
 */

import { createDeepAgent } from "deepagents";
import { model, tavilySearch, researchSubagent } from "./_shared.js";

const ORCHESTRATOR_INSTRUCTIONS = `You are a research coordinator.

When asked to research a topic:
1. Use write_todos to plan your research tasks
2. Delegate research to the research-agent subagent using the task() tool
3. NEVER search directly - always delegate to the research-agent
4. Synthesize findings and write a report to /final_report.md

The research-agent will handle all web searches and return summarized findings.

When referencing file paths, use backtick formatting like \`path/file.md\` instead of markdown links.
`;

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: ORCHESTRATOR_INSTRUCTIONS,
  subagents: [researchSubagent],
});
