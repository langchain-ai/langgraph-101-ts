import "dotenv/config";
import { z } from "zod/v3"; // Import from zod/v3 for LangGraph compatibility
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from "langchain";
import { MessagesZodMeta, StateGraph, START, END, MemorySaver, InMemoryStore, interrupt } from "@langchain/langgraph";
import { withLangGraph } from "@langchain/langgraph/zod";
import { SqlDatabase } from "@langchain/classic/sql_db";
import { setupDatabase, StateAnnotation, defaultModel } from "./utils.js";
import { supervisor } from "./03-supervisor.js";

// ============================================================================
// State Definitions
// ============================================================================

// Define Input State using Zod
const InputStateAnnotation = z.object({
  messages: withLangGraph(z.custom<BaseMessage[]>(), MessagesZodMeta),
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

// ============================================================================
// Schemas
// ============================================================================

// Schema for parsing user-provided account information
const UserInputSchema = z.object({
  identifier: z.string().describe("Identifier, which can be a customer ID, email, or phone number."),
});

// ============================================================================
// Nodes
// ============================================================================

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

console.log("👔 Creating Supervisor with Verification...");

// Setup database
const db = await setupDatabase();

// Initialize memory stores
const checkpointer = new MemorySaver();
const inMemoryStore = new InMemoryStore();

// Create structured output model for extracting customer identifier
const structuredLlm = defaultModel.withStructuredOutput(UserInputSchema);

const structuredSystemPrompt = `You are a customer service representative responsible for extracting customer identifier.
Only extract the customer's account information from the message history. 
If they haven't provided the information yet, return an empty string for the identifier`;

// Verify info node - validates customer identity
async function verifyInfo(state: z.infer<typeof StateAnnotation>) {
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
      const response = await defaultModel.invoke([
        new SystemMessage(systemInstructions),
        ...state.messages,
      ]);
      return { messages: [response] };
    }
  } else {
    // Customer ID already exists, pass through
    return {};
  }
}

// Human input node - prompts for user input during interrupt
function humanInput(state: z.infer<typeof StateAnnotation>) {
  const userInput = interrupt("Please provide input.");
  return { messages: [new HumanMessage(userInput as string)] };
}

// Supervisor node - wrapper for the supervisor agent
async function supervisorNode(state: z.infer<typeof StateAnnotation>) {
  const result = await supervisor.invoke(state as any);
  return {
    messages: result.messages,
  };
}

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

// Compile and export the graph
export const graph = multiAgentVerify.compile({
  checkpointer,
  store: inMemoryStore,
});

console.log("✅ Supervisor with Verification created successfully!");

