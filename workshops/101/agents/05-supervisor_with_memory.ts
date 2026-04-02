import "dotenv/config";
import { z } from "zod/v3";
import { BaseMessage, HumanMessage, SystemMessage, AIMessage } from "langchain";
import {
  MessagesZodMeta,
  StateGraph,
  START,
  END,
  MemorySaver,
  InMemoryStore,
  interrupt,
} from "@langchain/langgraph";
import { withLangGraph } from "@langchain/langgraph/zod";
import { SqlDatabase } from "@langchain/classic/sql_db";
import { setupDatabase, defaultModel, AgentState } from "./utils.js";
import { supervisor } from "./03-supervisor.js";

// ============================================================================
// LONG-TERM MEMORY WITH INMEMORYSTORE
// ============================================================================
//
// This file builds on 04 by adding persistent memory management.
// The system now remembers user preferences across conversations!
//
// KEY CONCEPTS:
// - Long-term memory: Persisting information beyond a single conversation
// - InMemoryStore: LangGraph's key-value store for memory
// - Namespace-based organization: Storing data by user ID
// - Memory lifecycle: Loading → Using → Updating
//
// WORKFLOW:
// 1. Verify customer (same as 04)
// 2. Load memory: Retrieve saved preferences for this customer
// 3. Supervisor: Uses preferences to personalize responses
// 4. Create memory: Analyze conversation and update saved preferences
//
// WHY THIS MATTERS:
// - Personalization: Agent remembers user preferences
// - Context preservation: Past conversations inform current ones
// - Better UX: Users don't need to repeat themselves

// ============================================================================
// State Definitions
// ============================================================================

// Define Input State using Zod
const InputStateAnnotation = z.object({
  messages: withLangGraph(z.custom<BaseMessage[]>(), MessagesZodMeta),
});

// ============================================================================
// Memory Schema
// ============================================================================
//
// STRUCTURED MEMORY
// We define a schema for what we want to remember about each user.
// This ensures consistent memory structure across users.

const UserProfileSchema = z.object({
  customerId: z.string().describe("The customer ID of the customer"),
  musicPreferences: z
    .array(z.string())
    .describe("The music preferences of the customer"),
});

// ============================================================================
// Customer Verification Helpers
// ============================================================================

async function getCustomerIdFromIdentifier(
  identifier: string,
  db: SqlDatabase
): Promise<number | null> {
  // Direct customer ID (numeric)
  if (/^\d+$/.test(identifier)) {
    return parseInt(identifier);
  }

  // Phone number lookup
  if (identifier.startsWith("+")) {
    const normalizedInput = identifier.replace(/[\s\(\)]/g, "");

    // Try exact match first
    const query = `SELECT CustomerId FROM Customer WHERE Phone = '${identifier}';`;
    const rawResult = await db.run(query);
    const result =
      typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;

    if (result && result.length > 0) {
      return result[0].CustomerId;
    }

    // Try normalized match if exact match fails
    const queryAll = `SELECT CustomerId, Phone FROM Customer WHERE Phone LIKE '+%';`;
    const rawAllPhones = await db.run(queryAll);
    const allPhones =
      typeof rawAllPhones === "string"
        ? JSON.parse(rawAllPhones)
        : rawAllPhones;

    for (const row of allPhones) {
      if (row.Phone) {
        const normalizedDb = row.Phone.replace(/[\s\(\)]/g, "");
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
    const result =
      typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;

    if (result && result.length > 0) {
      return result[0].CustomerId;
    }
  }

  return null;
}

// ============================================================================
// System Prompts
// ============================================================================
//
// MEMORY ANALYSIS PROMPT
// This prompt instructs an LLM to analyze conversations and extract
// information worth remembering (like music preferences).

const createMemoryPrompt = `You are an expert analyst that is observing a conversation that has taken place between a customer and a customer support assistant. The customer support assistant works for a digital music store, and has utilized a multi-agent team to answer the customer's request. 
You are tasked with analyzing the conversation that has taken place between the customer and the customer support assistant, and updating the memory profile associated with the customer. 
You specifically care about saving any music interest the customer has shared about themselves, particularly their music preferences to their memory profile.

<core_instructions>
1. The memory profile may be empty. If it's empty, you should ALWAYS create a new memory profile for the customer.
2. You should identify any music interest the customer during the conversation and add it to the memory profile **IF** it is not already present.
3. For each key in the memory profile, if there is no new information, do NOT update the value - keep the existing value unchanged.
4. ONLY update the values in the memory profile if there is new information.
</core_instructions>

<expected_format>
The customer's memory profile should have the following fields:
- customerId: the customer ID of the customer
- musicPreferences: the music preferences of the customer

IMPORTANT: ENSURE your response is an object with these fields.
</expected_format>

<important_context>
**IMPORTANT CONTEXT BELOW**
To help you with this task, I have attached the conversation that has taken place between the customer and the customer support assistant below, as well as the existing memory profile associated with the customer that you should either update or create. 

The conversation between the customer and the customer support assistant that you should analyze is as follows:
{conversation}

The existing memory profile associated with the customer that you should either update or create based on the conversation is as follows:
{memory_profile}

</important_context>

Reminder: Take a deep breath and think carefully before responding.
`;

// ============================================================================
// Schemas
// ============================================================================

// Schema for parsing user-provided account information
const UserInputSchema = z.object({
  identifier: z
    .string()
    .describe(
      "Identifier, which can be a customer ID, email, or phone number."
    ),
});

// ============================================================================
// Helper Functions
// ============================================================================
//
// Helper to format memory data for display/use in prompts

function formatUserMemory(userData: any): string {
  const profile = userData.memory;
  let result = "";
  if (
    profile &&
    profile.musicPreferences &&
    profile.musicPreferences.length > 0
  ) {
    result += `Music Preferences: ${profile.musicPreferences.join(", ")}`;
  }
  return result.trim();
}

// ============================================================================
// Nodes
// ============================================================================
//
// This graph has 5 nodes:
// 1. verify_info: Customer verification (same as 04)
// 2. human_input: Collect user input during interrupt (same as 04)
// 3. load_memory: NEW - Load saved preferences from InMemoryStore
// 4. supervisor: Execute supervisor with loaded memory context
// 5. create_memory: NEW - Analyze conversation and update saved preferences

// ============================================================================
// Conditional Edge
// ============================================================================

function shouldInterrupt(state: AgentState): "continue" | "interrupt" {
  if (state.customerId !== undefined) {
    return "continue";
  } else {
    return "interrupt";
  }
}

// ============================================================================
// Graph Creation
// ============================================================================

console.log("🧠 Creating Supervisor with Verification and Memory...");

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

// VERIFY INFO NODE
// Same as in 04 - validates customer identity
async function verifyInfo(state: AgentState) {
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

    const parsedInfo = await structuredLlm.invoke([
      new SystemMessage(structuredSystemPrompt),
      userInput,
    ]);

    const identifier = parsedInfo.identifier;

    let customerId: number | null = null;
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
    return {};
  }
}

// HUMAN INPUT NODE
// Same as in 04 - prompts for user input during interrupt
function humanInput(state: AgentState) {
  const userInput = interrupt("Please provide input.");
  return { messages: [new HumanMessage(userInput as string)] };
}

// LOAD MEMORY NODE
// Retrieves saved user preferences from InMemoryStore
async function loadMemory(state: AgentState) {
  const userId = state.customerId?.toString();
  if (!userId) {
    // No user ID - no memory to load
    return {
      loadedMemory: "",
      messages: [new HumanMessage("user_preferences: none")],
    };
  }

  // NAMESPACE PATTERN: ["memory_profile", userId]
  // InMemoryStore organizes data hierarchically using namespaces
  // This keeps each user's data separate
  const namespace = ["memory_profile", userId];
  const existingMemory: any = await inMemoryStore.get(namespace, "user_memory");
  let formattedMemory = "";

  if (existingMemory && existingMemory.value) {
    formattedMemory = formatUserMemory(existingMemory.value);
  }

  // Add memory to conversation context so supervisor can use it
  const preferencesMessage = formattedMemory
    ? `user_preferences: ${formattedMemory}`
    : "user_preferences: none";

  return {
    loadedMemory: formattedMemory,
    messages: [new HumanMessage(preferencesMessage)],
  };
}

// CREATE MEMORY NODE
// Analyzes the conversation and updates saved user preferences
async function createMemory(state: AgentState) {
  const userId = state.customerId?.toString();
  if (!userId) {
    return {};  // Can't save memory without a user ID
  }

  const namespace = ["memory_profile", userId];
  const formattedMemory = state.loadedMemory || "";

  // Use an LLM to analyze the conversation and extract preferences
  const formattedSystemMessage = new SystemMessage(
    createMemoryPrompt
      .replace("{conversation}", JSON.stringify(state.messages))
      .replace("{memory_profile}", formattedMemory)
  );

  // Get structured output matching UserProfileSchema
  // Note: We include both SystemMessage and HumanMessage for compatibility
  // with Anthropic models, which require at least one user message
  const updatedMemory = await defaultModel
    .withStructuredOutput(UserProfileSchema)
    .invoke([
      formattedSystemMessage,
      new HumanMessage("Please analyze the conversation and update the memory profile.")
    ]);

  // Save updated memory back to the store
  const key = "user_memory";
  await inMemoryStore.put(namespace, key, { memory: updatedMemory });

  return {};
}

// SUPERVISOR NODE
// Wrapper for the supervisor agent
async function supervisorNode(state: AgentState) {
  const result = await supervisor.invoke(state as any);
  return {
    messages: result.messages,
  };
}

// Build the final multi-agent graph with memory
//
// COMPLETE GRAPH FLOW:
// START → verify_info → [conditional]
//                           ↓ not verified
//                       human_input → (loop back to verify_info)
//                           ↓ verified
//                       load_memory → supervisor → create_memory → END
//
// MEMORY LIFECYCLE:
// 1. After verification, load existing memory
// 2. Memory gets added to conversation context
// 3. Supervisor uses memory to personalize responses
// 4. After supervisor responds, analyze conversation
// 5. Update memory with new preferences discovered
//
// This creates a complete loop where the agent learns from every interaction!
const multiAgentFinal = new StateGraph(AgentState, {
  input: InputStateAnnotation,
})
  .addNode("verify_info", verifyInfo)
  .addNode("human_input", humanInput)
  .addNode("load_memory", loadMemory)
  .addNode("supervisor", supervisorNode)
  .addNode("create_memory", createMemory)
  
  // Start with verification
  .addEdge(START, "verify_info")
  
  // Route based on verification
  .addConditionalEdges("verify_info", shouldInterrupt, {
    continue: "load_memory",   // Verified → load their preferences
    interrupt: "human_input",   // Not verified → collect credentials
  })
  
  // Verification loop
  .addEdge("human_input", "verify_info")
  
  // Memory → Supervisor → Update Memory → Done
  .addEdge("load_memory", "supervisor")
  .addEdge("supervisor", "create_memory")
  .addEdge("create_memory", END);

// Compile and export the graph
export const graph = multiAgentFinal.compile({
  checkpointer,        // Short-term: conversation history
  store: inMemoryStore,  // Long-term: user preferences and memory
});

console.log("✅ Supervisor with Verification and Memory created successfully!");
