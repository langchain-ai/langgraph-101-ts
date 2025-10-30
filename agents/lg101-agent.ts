import "dotenv/config";
import { initChatModel, tool } from "langchain";
import { z } from "zod/v3"; // Import from zod/v3 for LangGraph compatibility
import { createAgent } from "langchain";

// ============================================================================
// Tool Definition
// ============================================================================

const getWeather = tool(
  async ({ latitude, longitude }: { latitude: number; longitude: number }) => {
    const url = "https://api.open-meteo.com/v1/forecast";
    const params = new URLSearchParams({
      latitude: latitude.toString(),
      longitude: longitude.toString(),
      current: "temperature_2m,weather_code",
      temperature_unit: "fahrenheit"
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json() as any; // Type assertion for API response
    const weather = data.current;
    const temperature = weather.temperature_2m;
    const weatherCode = weather.weather_code;
    
    return JSON.stringify({
      temperature_fahrenheit: temperature,
      weather_code: weatherCode
    });
  },
  {
    name: "get_weather",
    description: "Get current temperature in Fahrenheit and weather code for given coordinates. Returns JSON with temperature_fahrenheit and weather_code (do not include the code in your response, translate it to plain English)",
    schema: z.object({
      latitude: z.number().describe("Latitude coordinate"),
      longitude: z.number().describe("Longitude coordinate")
    })
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