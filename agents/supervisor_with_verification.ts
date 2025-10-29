import "dotenv/config";
import { initChatModel, tool } from "langchain";
import { z } from "zod/v3"; // Import from zod/v3 for LangGraph compatibility
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from "langchain";
import { MessagesZodMeta, StateGraph, START, END, MemorySaver, InMemoryStore, interrupt } from "@langchain/langgraph";
import { withLangGraph } from "@langchain/langgraph/zod";
import { createAgent } from "langchain";
import { SqlDatabase } from "@langchain/classic/sql_db";
import { setupDatabase } from "./utils.js";
import { graph as musicCatalogSubagent } from "./music_subagent.js";
import { graph as invoiceInformationSubagent } from "./invoice_subagent.js";

// ============================================================================
// State Definitions
// ============================================================================

// Define Input State using Zod
const InputStateAnnotation = z.object({
  messages: withLangGraph(z.custom<BaseMessage[]>(), MessagesZodMeta),
});

// Define overall State using Zod with MessagesZodMeta (same as createAgent uses)
const StateAnnotation = z.object({
  messages: withLangGraph(z.custom<BaseMessage[]>(), MessagesZodMeta),
  customerId: z.number().optional(),
  loadedMemory: z.string().default(""),
  remainingSteps: z.number().default(25),
});

// ============================================================================
// Customer Verification Helpers
// ============================================================================

// Helper function to look up customer ID from various identifiers
async function getCustomerIdFromIdentifier(identifier: string, db: SqlDatabase): Promise<number | null> {
  // Direct customer ID (numeric)
  if (/^\d+$/.test(identifier)) {
    return parseInt(identifier);
  }
  
  // Phone number lookup
  if (identifier.startsWith("+")) {
    // Normalize by removing spaces and parentheses for flexible matching
    const normalizedInput = identifier.replace(/[\s\(\)]/g, '');
    
    // Try exact match first
    const query = `SELECT CustomerId FROM Customer WHERE Phone = '${identifier}';`;
    const rawResult = await db.run(query);
    const result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
    
    if (result && result.length > 0) {
      return result[0].CustomerId;
    }
    
    // Try normalized match if exact match fails
    const queryAll = `SELECT CustomerId, Phone FROM Customer WHERE Phone LIKE '+%';`;
    const rawAllPhones = await db.run(queryAll);
    const allPhones = typeof rawAllPhones === 'string' ? JSON.parse(rawAllPhones) : rawAllPhones;
    
    for (const row of allPhones) {
      if (row.Phone) {
        const normalizedDb = row.Phone.replace(/[\s\(\)]/g, '');
        if (normalizedDb === normalizedInput) {
          return row.CustomerId;
        }
      }
    }
  }
  
  // Email lookup
  if (identifier.includes("@")) {
    const query = `SELECT CustomerId FROM Customer WHERE Email = '${identifier}';`;
    const rawResult = await db.run(query);
    const result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
    
    if (result && result.length > 0) {
      return result[0].CustomerId;
    }
  }
  
  return null;
}

// ============================================================================
// System Prompts
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
from the database. This tool requires a customerId parameter - extract it from the user's message or context.
</tools>
`;

// ============================================================================
// Supervisor Tools
// ============================================================================

const callInvoiceInformationSubagent = tool(
  async ({ query, customerId }: { query: string; customerId: number }) => {
    const result: any = await invoiceInformationSubagent.invoke({
      messages: [new HumanMessage(`Customer ID: ${customerId}. ${query}`)],
    });
    const subagentResponse = result.messages[result.messages.length - 1].content;
    return subagentResponse;
  },
  {
    name: "invoice_information_subagent",
    description: "An agent that can assist with all invoice-related queries. It can retrieve information about a customer's past purchases or invoices.",
    schema: z.object({
      query: z.string().describe("The query to send to the invoice subagent"),
      customerId: z.number().describe("The customer ID (get this from the user's context)"),
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
// Nodes
// ============================================================================

function createVerifyInfoNode(model: any, db: SqlDatabase) {
  // Schema for parsing user-provided account information
  const UserInputSchema = z.object({
    identifier: z.string().describe("Identifier, which can be a customer ID, email, or phone number."),
  });

  const structuredLlm = model.withStructuredOutput(UserInputSchema);

  const structuredSystemPrompt = `You are a customer service representative responsible for extracting customer identifier.
Only extract the customer's account information from the message history. 
If they haven't provided the information yet, return an empty string for the identifier`;

  return async function verifyInfo(state: z.infer<typeof StateAnnotation>) {
    if (state.customerId === undefined) {
      const systemInstructions = `
You are a music store agent, where you are trying to verify the customer identity as the first step of the customer support process. 
You cannot support them until their account is verified. 
In order to verify their identity, one of their customer ID, email, or phone number needs to be provided.
If the customer has not provided their identifier, please ask them for it.
If they have provided the identifier but cannot be found, please ask them to revise it.

IMPORTANT: Do NOT ask any questions about their request, or make any attempt at addressing their request until their identity is verified. It is CRITICAL that you only ask about their identity for security purposes.
`;

      const userInput = state.messages[state.messages.length - 1];
      
      // Parse for customer ID
      const parsedInfo = await structuredLlm.invoke([
        new SystemMessage(structuredSystemPrompt),
        userInput,
      ]);
      
      // Extract details
      const identifier = parsedInfo.identifier;
      
      let customerId: number | null = null;
      // Attempt to find the customer ID
      if (identifier) {
        customerId = await getCustomerIdFromIdentifier(identifier, db);
      }
      
      if (customerId !== null) {
        const intentMessage = new AIMessage(
          `Thank you for providing your information! I was able to verify your account with customer id ${customerId}.`
        );
        return {
          customerId: customerId,
          messages: [intentMessage],
        };
      } else {
        const response = await model.invoke([
          new SystemMessage(systemInstructions),
          ...state.messages,
        ]);
        return { messages: [response] };
      }
    } else {
      // Customer ID already exists, pass through
      return {};
    }
  };
}

function humanInput(state: z.infer<typeof StateAnnotation>) {
  const userInput = interrupt("Please provide input.");
  return { messages: [new HumanMessage(userInput as string)] };
}

function createSupervisorNode(supervisor: any) {
  return async function supervisorNode(state: z.infer<typeof StateAnnotation>) {
    const result = await supervisor.invoke(state as any);
    return {
      messages: result.messages,
    };
  };
}

// ============================================================================
// Conditional Edge
// ============================================================================

function shouldInterrupt(state: z.infer<typeof StateAnnotation>): "continue" | "interrupt" {
  if (state.customerId !== undefined) {
    return "continue";
  } else {
    return "interrupt";
  }
}

// ============================================================================
// Graph Creation
// ============================================================================

async function createSupervisorWithVerification() {
  console.log("👔 Creating Supervisor with Verification...");
  
  // Setup database
  const db = await setupDatabase();
  
  // Initialize model
  const model = await initChatModel("openai:gpt-4o-mini");
  
  // Initialize memory stores
  const checkpointer = new MemorySaver();
  const inMemoryStore = new InMemoryStore();
  
  // Create supervisor agent
  const supervisor = createAgent({
    model,
    tools: [callInvoiceInformationSubagent, callMusicCatalogSubagent],
    systemPrompt: supervisorPrompt,
    stateSchema: StateAnnotation,
    checkpointer,
    store: inMemoryStore,
  });
  
  // Create nodes
  const verifyInfo = createVerifyInfoNode(model, db);
  const supervisorNode = createSupervisorNode(supervisor);
  
  // Build the graph with human-in-the-loop
  const multiAgentVerify = new StateGraph(StateAnnotation, {
    input: InputStateAnnotation,
  })
    .addNode("verify_info", verifyInfo)
    .addNode("human_input", humanInput)
    .addNode("supervisor", supervisorNode)
    .addEdge(START, "verify_info")
    .addConditionalEdges("verify_info", shouldInterrupt, {
      continue: "supervisor",
      interrupt: "human_input",
    })
    .addEdge("human_input", "verify_info")
    .addEdge("supervisor", END);

  const multiAgentVerifyGraph = multiAgentVerify.compile({
    checkpointer,
    store: inMemoryStore,
  });

  console.log("✅ Supervisor with Verification created successfully!");
  
  return multiAgentVerifyGraph;
}

// ============================================================================
// Export
// ============================================================================

export const graph = await createSupervisorWithVerification();

