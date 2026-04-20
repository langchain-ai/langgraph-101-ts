import "dotenv/config";
import { createAgent, tool } from "langchain";
import { z } from "zod/v3";
import { defaultModel } from "./utils";

// ============================================================================
// Tool Definition
// ============================================================================
// 
// WHAT ARE TOOLS?
// Tools are functions that LLMs can call to perform actions or retrieve information.
// They're essential for building agents that can interact with external systems.
// 
// Think of tools as giving your LLM "superpowers" - instead of just generating text,
// it can now check the weather, query databases, call APIs, and more.

type WeatherApiResponse = {
  current: {
    temperature_2m: number;
    weather_code: number;
  };
};

// The tool() function creates a LangChain tool from a regular TypeScript function.
// It takes two arguments:
// 1. The implementation function (what the tool actually does)
// 2. Configuration object with name, description, and schema
const getWeather = tool(
  // Implementation: This async function is called when the LLM decides to use the tool
  async ({ latitude, longitude }) => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", latitude.toString());
    url.searchParams.set("longitude", longitude.toString());
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("temperature_unit", "fahrenheit");

    const response = await fetch(url);
    const data: WeatherApiResponse = await response.json();
    
    // Always return strings from tools - the LLM will process the result
    return JSON.stringify({
      temperature_fahrenheit: data.current.temperature_2m,
      weather_code: data.current.weather_code,
    });
  },
  {
    // Tool name: Used by the LLM to identify which tool to call
    name: "get_weather",
    
    // Description: This is CRITICAL! The LLM uses this to decide when to use the tool.
    // Write clear, detailed descriptions that explain what the tool does and when to use it.
    description:
      "Get current temperature in Fahrenheit and weather code for given coordinates. Returns JSON with temperature_fahrenheit and weather_code (do not include the code in your response, translate it to plain English)",
    
    // Schema: Defines the tool's parameters using Zod for type-safety and validation.
    // The LLM uses descriptions here to understand what values to provide.
    schema: z.object({
      latitude: z.number().describe("Latitude coordinate"),
      longitude: z.number().describe("Longitude coordinate"),
    }),
  }
);

// ============================================================================
// Agent Creation
// ============================================================================
//
// THE SIMPLE WAY: createAgent()
// 
// The createAgent() function is the easiest way to create an agent in LangChain.
// It automatically sets up a ReAct-style agent that can reason and use tools.
// 
// Under the hood, it creates a LangGraph with nodes for the LLM and tools,
// but you don't need to worry about those details to get started.

const agent = createAgent({
  // model: The LLM that will power your agent
  model: defaultModel,
  
  // tools: Array of tools the agent can use
  // The agent will automatically decide when and how to use these tools
  tools: [getWeather],
  
  // systemPrompt: Instructions that guide the agent's behavior
  // This sets the agent's personality, role, and guidelines
  systemPrompt:
    "You are a helpful weather assistant. Use the get_weather tool to check weather for cities.",
});

// ============================================================================
// Export
// ============================================================================
//
// We export the agent.graph, which is a compiled LangGraph that can be invoked.
// This graph can be run locally or deployed to LangSmith Deployments.
//
// Usage example:
//   const result = await graph.invoke({ messages: [{ role: "user", content: "What's the weather in SF?" }] });

export const graph = agent.graph;
