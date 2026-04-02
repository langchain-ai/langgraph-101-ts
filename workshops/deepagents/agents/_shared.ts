/**
 * Shared tools and subagent definitions used across the tutorial parts.
 */

import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import type { SubAgent } from "deepagents";

// --- Model ---

export const model = new ChatOpenAI({ model: "gpt-5.4" });

// --- Tools ---

export const tavilySearch = new TavilySearch({ maxResults: 3 });

// --- Research Subagent ---

const currentDate = new Date().toISOString().split("T")[0];

const RESEARCHER_INSTRUCTIONS = `You are a research assistant conducting research. Today's date is ${currentDate}.

<Task>
Use tools to gather information about the research topic.
</Task>

<Hard Limits>
- Simple queries: Use 2-3 search tool calls maximum
- Complex queries: Use up to 5 search tool calls maximum
</Hard Limits>

<Output Format>
Structure your findings with:
- Clear headings
- Inline citations [1], [2], [3]
- Sources section at the end
</Output Format>
`;

export const researchSubagent: SubAgent = {
  name: "research-agent",
  description: "Delegate research tasks. Give one topic at a time.",
  systemPrompt: RESEARCHER_INSTRUCTIONS,
  tools: [tavilySearch],
};
