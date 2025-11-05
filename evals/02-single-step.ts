import "dotenv/config";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { v4 as uuidv4 } from "uuid";
import { HumanMessage } from "langchain";
import { graph as supervisor } from "../agents/03-supervisor.js";
import { getOrCreateDataset, logEvaluationSummary } from "./utils.js";

// ============================================================================
// Dataset Definition
// ============================================================================

const DATASET_NAME = "LangGraph 101 Multi-Agent: Single-Step (TypeScript)";

const examples = [
  {
    inputs: { messages: "My customer ID is 1. What's my most recent purchase?" },
    outputs: { route: "invoice_information_subagent" }
  },
  {
    inputs: { messages: "What songs do you have by U2?" },
    outputs: { route: "music_catalog_subagent" }
  },
  {
    inputs: { messages: "My name is Aaron Mitchell. My number associated with my account is +1 (204) 452-6452. I am trying to find the invoice number for my most recent song purchase. Could you help me with it?" },
    outputs: { route: "invoice_information_subagent" }
  },
  {
    inputs: { messages: "Who recorded Wish You Were Here again? What other albums by them do you have?" },
    outputs: { route: "music_catalog_subagent" }
  },
  {
    inputs: { messages: "Who won Wimbledon Championships this year?" },
    outputs: { route: "model" } // Last message should be from supervisor; does not invoke any sub-agents
  }
];

// ============================================================================
// Application Logic
// ============================================================================

/**
 * Runs the supervisor and captures which route it selected
 */
async function runSupervisorRouting(inputs: Record<string, any>): Promise<Record<string, any>> {
  const result: any = await supervisor.invoke(
    {
      messages: [new HumanMessage(inputs.messages)],
      customerId: 10,
      loadedMemory: "",
      remainingSteps: 25
    },
    {
      interruptAfter: ["tools"],
      configurable: { thread_id: uuidv4(), user_id: "10" }
    }
  );
  
  const lastMessage = result.messages[result.messages.length - 1];
  const route = lastMessage.name || "supervisor";
  
  return { route };
}

// ============================================================================
// Evaluators
// ============================================================================

/**
 * Evaluates if the agent chose the correct route
 */
function correctRouteEvaluator({
  outputs,
  referenceOutputs,
}: {
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
}): { key: string; score: number } {
  const isCorrect = outputs?.route === referenceOutputs?.route;
  return {
    key: "correct",
    score: isCorrect ? 1 : 0
  };
}

// ============================================================================
// Main Evaluation
// ============================================================================

async function main() {
  console.log("🚀 Starting Single-Step Evaluation\n");
  
  // Initialize LangSmith client
  const client = new Client();
  
  // Create or get dataset
  await getOrCreateDataset(client, DATASET_NAME, examples);
  
  console.log("\n⏳ Running evaluation...\n");
  
  // Run evaluation
  const experimentResults = await evaluate(
    (inputs: any) => runSupervisorRouting(inputs),
    {
      data: DATASET_NAME,
      evaluators: [correctRouteEvaluator],
      experimentPrefix: "agent-singlestep",
      maxConcurrency: 3,
      client, // Pass client explicitly
    }
  );
  
  logEvaluationSummary("Single-Step (Routing)", DATASET_NAME);
  
  console.log("📈 Check LangSmith for detailed results");
}

// Run the evaluation
main().catch(console.error);
