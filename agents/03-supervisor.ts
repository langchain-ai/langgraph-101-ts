import "dotenv/config";
import { initChatModel, tool } from "langchain";
import { z } from "zod/v3"; // Import from zod/v3 for LangGraph compatibility
import { HumanMessage } from "langchain";
import { MemorySaver, InMemoryStore, getCurrentTaskInput } from "@langchain/langgraph";
import { createAgent } from "langchain";
import { graph as musicCatalogSubagent } from "./01-music_subagent.js";
import { graph as invoiceInformationSubagent } from "./02-invoice_subagent.js";
import { StateAnnotation } from "./utils.js";

// ============================================================================
// System Prompt
// ============================================================================

const supervisorPrompt = `
<background>
You are an expert customer support assistant for a digital music store. You can handle music catalog or invoice related question regarding past purchases, song or album availabilities. 
You are dedicated to providing exceptional service and ensuring customer queries are answered thoroughly, and have a team of subagents that you can use to help answer queries from customers. 
Your primary role is to delegate tasks to this multi-agent team in order to answer queries from customers. 
</background>

<important_instructions>
Always respond to the customer through summarizing the findings of the individual responses from subagents. 
If a question is unrelated to music or invoice, politely remind the customer regarding your scope of work. Do not answer unrelated answers.
Based on the existing steps that have been taken in the messages, your role is to call the appropriate subagent based on the users query.
</important_instructions>

<tools>
You have 2 tools available to delegate to the subagents on your team:
1. music_catalog_subagent: Call this tool to delegate to the music subagent. The music agent has access to user's saved music preferences. It can also retrieve information about the digital music store's music 
catalog (albums, tracks, songs, etc.) from the database. 
2. invoice_information_subagent: Call this tool to delegate to the invoice subagent. This subagent is able to retrieve information about a customer's past purchases or invoices 
from the database. The customer ID is automatically retrieved from the state, so you don't need to pass it.
</tools>
`;

// ============================================================================
// Supervisor Tools
// ============================================================================

// Create supervisor tools that delegate to subagents
const callInvoiceInformationSubagent = tool(
  async ({ query }: { query: string }) => {
    // Get the customerId from the current state
    const state = await getCurrentTaskInput() as { customerId?: number };
    
    // Pass the query and customerId through state to the invoice subagent
    const result: any = await invoiceInformationSubagent.invoke({
      messages: [new HumanMessage(query)],
      customerId: state.customerId,
    });
    const subagentResponse = result.messages[result.messages.length - 1].content;
    return subagentResponse;
  },
  {
    name: "invoice_information_subagent",
    description: "An agent that can assist with all invoice-related queries. It can retrieve information about a customer's past purchases or invoices. The customer ID is automatically retrieved from the state.",
    schema: z.object({
      query: z.string().describe("The query to send to the invoice subagent"),
    }),
  }
);

const callMusicCatalogSubagent = tool(
  async ({ query }: { query: string }) => {
    const result: any = await musicCatalogSubagent.invoke({
      messages: [new HumanMessage(query)],
    });
    const subagentResponse = result.messages[result.messages.length - 1].content;
    return subagentResponse;
  },
  {
    name: "music_catalog_subagent",
    description: "An agent that can assist with all music-related queries. This agent has access to user's saved music preferences. It can also retrieve information about the digital music store's music catalog (albums, tracks, songs, etc.) from the database.",
    schema: z.object({
      query: z.string().describe("The query to send to the music catalog subagent"),
    }),
  }
);

// ============================================================================
// Agent Creation
// ============================================================================

console.log("👔 Creating Supervisor Agent...");

// Initialize model
const model = await initChatModel("openai:gpt-4o-mini");

// Initialize memory stores
const checkpointer = new MemorySaver();
const inMemoryStore = new InMemoryStore();

// Create the supervisor agent
const supervisor = createAgent({
  model,
  tools: [callInvoiceInformationSubagent, callMusicCatalogSubagent],
  systemPrompt: supervisorPrompt,
  stateSchema: StateAnnotation,
  checkpointer,
  store: inMemoryStore,
});

console.log("✅ Supervisor Agent created successfully!");

// ============================================================================
// Export
// ============================================================================

export const graph = supervisor.graph;

