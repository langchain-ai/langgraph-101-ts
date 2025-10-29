import "dotenv/config";
import { initChatModel, tool } from "langchain";
import { z } from "zod/v3"; // Import from zod/v3 for LangGraph compatibility
import { createAgent } from "langchain";

// ============================================================================
// Tool Definition
// ============================================================================

const getWeather = tool(
  async ({ city }: { city: string }) => {
    return `It's 72°F and sunny in ${city}!`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a given city.",
    schema: z.object({
      city: z.string().describe("The city name"),
    }),
  }
);

// ============================================================================
// Agent Creation
// ============================================================================

async function createLG101Agent() {
  console.log("🤖 Creating LG101 Agent...");
  
  // Initialize model
  const model = await initChatModel("openai:gpt-4o-mini");
  
  // Create the agent
  const agent = createAgent({
    model,
    tools: [getWeather],
    systemPrompt: "You are a helpful weather assistant. Use the get_weather tool to check weather for cities.",
  });

  console.log("✅ LG101 Agent created successfully!");
  
  return agent;
}

// ============================================================================
// Export
// ============================================================================

const agent = await createLG101Agent();
export const graph = agent.graph;