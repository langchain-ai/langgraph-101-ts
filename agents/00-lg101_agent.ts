import "dotenv/config";
import { createAgent, tool } from "langchain";
import { z } from "zod/v3";
import { defaultModel } from "./utils";

// ============================================================================
// Tool Definition
// ============================================================================

type WeatherApiResponse = {
  current: {
    temperature_2m: number;
    weather_code: number;
  };
};

const getWeather = tool(
  async ({ latitude, longitude }) => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", latitude.toString());
    url.searchParams.set("longitude", longitude.toString());
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("temperature_unit", "fahrenheit");

    const response = await fetch(url);
    const data: WeatherApiResponse = await response.json();
    return JSON.stringify({
      temperature_fahrenheit: data.current.temperature_2m,
      weather_code: data.current.weather_code,
    });
  },
  {
    name: "get_weather",
    description:
      "Get current temperature in Fahrenheit and weather code for given coordinates. Returns JSON with temperature_fahrenheit and weather_code (do not include the code in your response, translate it to plain English)",
    schema: z.object({
      latitude: z.number().describe("Latitude coordinate"),
      longitude: z.number().describe("Longitude coordinate"),
    }),
  }
);

// ============================================================================
// Agent Creation
// ============================================================================

// Create the agent
const agent = createAgent({
  model: defaultModel,
  tools: [getWeather],
  systemPrompt:
    "You are a helpful weather assistant. Use the get_weather tool to check weather for cities.",
});

// ============================================================================
// Export
// ============================================================================

export const graph = agent.graph;
