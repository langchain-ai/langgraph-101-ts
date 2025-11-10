import "dotenv/config";
import { z } from "zod/v3";
import { createAgent, tool, HumanMessage } from "langchain";
import {
  MemorySaver,
  InMemoryStore,
  getCurrentTaskInput,
} from "@langchain/langgraph";
import { graph as musicCatalogSubagent } from "./01-music_subagent.js";
import { graph as invoiceInformationSubagent } from "./02-invoice_subagent.js";
import { AgentState, defaultModel } from "./utils.js";

// ============================================================================
// SUBAGENTS AS TOOLS - THE RECOMMENDED PATTERN
// ============================================================================
//
// This file demonstrates a powerful and clean architecture pattern:
// wrapping subagents as tools that the supervisor can call.
//
// WHY THIS PATTERN?
// - MODULARITY: Each subagent is independent and can be developed/tested separately
// - SIMPLICITY: The supervisor just delegates to specialized subagents like any other tool
// - REUSABILITY: Subagents can be reused in different workflows
// - SCALABILITY: Easy to add new specialized subagents
//
// HOW IT WORKS:
// 1. Import compiled subagent graphs (from 01 and 02)
// 2. Wrap each subagent in a tool function
// 3. The tool invokes the subagent graph and returns its response
// 4. Supervisor uses createAgent() with these subagent tools
//
// COMPARISON TO OTHER PATTERNS:
// - Simpler than traditional hierarchical supervisor patterns
// - More flexible than monolithic agents
// - Better separation of concerns than "swarm" approaches

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
// Supervisor Tools - Wrapping Subagents
// ============================================================================
//
// Here's where the magic happens: we wrap each subagent graph as a tool.
// The supervisor will see these as regular tools, but they're actually
// calling entire agent workflows!

// INVOICE SUBAGENT TOOL
// This tool wraps the invoice subagent and handles state passing
const callInvoiceInformationSubagent = tool(
  async ({ query }) => {
    // Get the customerId from the supervisor's state
    // We use getCurrentTaskInput() to access it (same pattern as in 02-invoice_subagent.ts)
    const state = await getCurrentTaskInput<AgentState>();

    // Invoke the invoice subagent graph with the query and state
    // The customerId is passed through state so the subagent's tools can access it
    const result: any = await invoiceInformationSubagent.invoke({
      messages: [new HumanMessage(query)],
      customerId: state.customerId,  // Pass context through state
    });
    
    // Extract the subagent's final response
    const subagentResponse = result.messages.at(-1).content;
    return subagentResponse;
  },
  {
    name: "invoice_information_subagent",
    description:
      "An agent that can assist with all invoice-related queries. It can retrieve information about a customer's past purchases or invoices. The customer ID is automatically retrieved from the state.",
    schema: z.object({
      query: z.string().describe("The query to send to the invoice subagent"),
    }),
  }
);

// MUSIC CATALOG SUBAGENT TOOL
// This tool wraps the music catalog subagent
const callMusicCatalogSubagent = tool(
  async ({ query }) => {
    // Invoke the music catalog subagent graph
    // This subagent doesn't need customerId, so we just pass the query
    const result: any = await musicCatalogSubagent.invoke({
      messages: [new HumanMessage(query)],
    });
    
    // Extract and return the subagent's response
    const subagentResponse = result.messages.at(-1).content;
    return subagentResponse;
  },
  {
    name: "music_catalog_subagent",
    description:
      "An agent that can assist with all music-related queries. This agent has access to user's saved music preferences. It can also retrieve information about the digital music store's music catalog (albums, tracks, songs, etc.) from the database.",
    schema: z.object({
      query: z
        .string()
        .describe("The query to send to the music catalog subagent"),
    }),
  }
);

// ============================================================================
// Agent Creation
// ============================================================================
//
// THE SUPERVISOR AGENT
// The supervisor is just a regular agent created with createAgent().
// What makes it special is that its "tools" are actually other agents!
//
// ARCHITECTURE BENEFITS:
// - The supervisor focuses on routing/delegation
// - Each subagent is a domain expert
// - Clean separation of concerns
// - Easy to test and maintain

console.log("👔 Creating Supervisor Agent...");

// Initialize memory stores for conversation persistence
const checkpointer = new MemorySaver();
const inMemoryStore = new InMemoryStore();

// Create the supervisor agent
export const supervisor = createAgent({
  model: defaultModel,
  
  // The "tools" are actually subagent wrappers!
  // To the LLM, they look like regular tools
  tools: [callInvoiceInformationSubagent, callMusicCatalogSubagent],
  
  systemPrompt: supervisorPrompt,
  
  // stateSchema enables getCurrentTaskInput() in tool wrappers
  stateSchema: AgentState,
  
  checkpointer,
  store: inMemoryStore,
});

console.log("✅ Supervisor Agent created successfully!");

// ============================================================================
// Export
// ============================================================================
//
// This supervisor can be used standalone or as part of a larger workflow
// (like in 04-supervisor_with_verification.ts)

export const graph = supervisor.graph;
