import "dotenv/config";
import { initChatModel, tool } from "langchain";

const getWeather = tool(
    async ({ city }: { city: string }) => {
        return `It's 72°F and sunny in ${city}!`;
    },
    {
        name: "get_weather",
        description: "Get the current weather for a given city.",
    }
);

const llm = await initChatModel("openai:gpt-5")

const llmWithTools = llm.bindTools([getWeather]);

const response = await llmWithTools.invoke("What's the weather in Tokyo?");

console.log(response);