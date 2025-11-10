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
// HUMAN-IN-THE-LOOP WITH CUSTOMER VERIFICATION
// ============================================================================
//
// This file builds on the supervisor pattern (03) by adding a verification step.
// Before the supervisor can help with invoices, the customer must verify their identity.
//
// KEY CONCEPTS:
// - Human-in-the-loop: Pausing execution to get user input
// - interrupt(): LangGraph function that pauses and waits for input
// - Conditional routing based on verification state
// - Structured output parsing to extract customer information
//
// WORKFLOW:
// 1. User sends a query
// 2. verify_info node checks if customer is verified
// 3. If NOT verified → interrupt() to ask for credentials
// 4. If verified → continue to supervisor
//
// This pattern is useful for:
// - Authentication/authorization
// - Confirmation prompts
// - Collecting required information
// - Approval workflows

// ============================================================================
// State Definitions
// ============================================================================

// Define Input State using Zod
// This limits what fields can be provided when invoking the graph
const InputStateAnnotation = z.object({
  messages: withLangGraph(z.custom<BaseMessage[]>(), MessagesZodMeta),
});

// ============================================================================
// Customer Verification Helpers
// ============================================================================
//
// These helper functions handle the customer verification logic.
// They can look up customers by ID, email, or phone number.

// Helper function to look up customer ID from various identifiers
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
    // Normalize by removing spaces and parentheses for flexible matching
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

// ============================================================================
// Schemas
// ============================================================================
//
// STRUCTURED OUTPUT PARSING
// We use Zod schemas with withStructuredOutput() to extract specific information
// from user messages. This is more reliable than regex or string parsing.

// Schema for parsing user-provided account information
const UserInputSchema = z.object({
  identifier: z
    .string()
    .describe(
      "Identifier, which can be a customer ID, email, or phone number."
    ),
});

// ============================================================================
// Nodes
// ============================================================================
//
// The nodes in this graph implement the verification workflow.

// ============================================================================
// Conditional Edge
// ============================================================================
//
// CONDITIONAL ROUTING FOR VERIFICATION
// This function decides whether to continue to the supervisor or interrupt for verification.

function shouldInterrupt(state: AgentState): "continue" | "interrupt" {
  // If customerId exists in state, customer is verified
  if (state.customerId !== undefined) {
    return "continue";  // Proceed to supervisor
  } else {
    return "interrupt";  // Need to collect credentials
  }
}

// ============================================================================
// Graph Creation
// ============================================================================

console.log("👔 Creating Supervisor with Verification...");

// Setup database
const db = await setupDatabase();

// Create structured output model for extracting customer identifier
// withStructuredOutput() makes the LLM return data matching our schema
const structuredLlm = defaultModel.withStructuredOutput(UserInputSchema);

const structuredSystemPrompt = `You are a customer service representative responsible for extracting customer identifier.
Only extract the customer's account information from the message history. 
If they haven't provided the information yet, return an empty string for the identifier`;

// VERIFY INFO NODE
// This node attempts to extract and verify the customer's identity
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

    // Use structured output to extract identifier from user's message
    const parsedInfo = await structuredLlm.invoke([
      new SystemMessage(structuredSystemPrompt),
      userInput,
    ]);

    // Attempt to look up the customer using the extracted identifier
    const customerId = parsedInfo.identifier
      ? await getCustomerIdFromIdentifier(parsedInfo.identifier, db)
      : null;

    if (customerId !== null) {
      // Success! Customer verified
      const intentMessage = new AIMessage(
        `Thank you for providing your information! I was able to verify your account with customer id ${customerId}.`
      );
      return {
        customerId: customerId,
        messages: [intentMessage],
      };
    } else {
      // Couldn't verify - ask for credentials or clarification
      const response = await defaultModel.invoke([
        new SystemMessage(systemInstructions),
        ...state.messages,
      ]);
      return { messages: [response] };
    }
  } else {
    // Customer ID already exists in state - they're already verified
    return {};
  }
}

// HUMAN INPUT NODE
// This node uses interrupt() to pause execution and collect user input
function humanInput() {
  // interrupt() pauses the graph and returns control to the caller
  // The caller must provide input to resume execution
  const userInput = interrupt("Please provide input.");
  return { messages: [new HumanMessage(userInput)] };
}

// SUPERVISOR NODE
// Simple wrapper that calls the supervisor from 03-supervisor.ts
async function supervisorNode(state: AgentState) {
  const result = await supervisor.invoke({
    ...state,
    customerId: state.customerId,
  });
  return {
    messages: result.messages,
  };
}

// Initialize memory stores
const checkpointer = new MemorySaver();
const inMemoryStore = new InMemoryStore();

// Build the graph with human-in-the-loop verification
const multiAgentVerify = new StateGraph(AgentState, {
  input: InputStateAnnotation,  // Restricts what can be passed when invoking
})
  .addNode("verify_info", verifyInfo)
  .addNode("human_input", humanInput)
  .addNode("supervisor", supervisorNode)
  
  // Start with verification
  .addEdge(START, "verify_info")
  
  // Route based on verification status
  .addConditionalEdges("verify_info", shouldInterrupt, {
    continue: "supervisor",      // Customer verified → proceed
    interrupt: "human_input",    // Need credentials → interrupt
  })
  
  // After human input, try verification again
  .addEdge("human_input", "verify_info")
  
  // After supervisor responds, we're done
  .addEdge("supervisor", END);

// Compile and export the graph
export const graph = multiAgentVerify.compile({
  checkpointer,        // Required for interrupt() to work
  store: inMemoryStore,
});

console.log("✅ Supervisor with Verification created successfully!");
