import "dotenv/config";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { v4 as uuidv4 } from "uuid";
import { HumanMessage, SystemMessage } from "langchain";
import { initChatModel } from "langchain";
import { z } from "zod/v3";
import { createLLMAsJudge, runMultiturnSimulation, createLLMSimulatedUser } from "openevals";
import { graph as multiAgentFinalGraph } from "../agents/05-supervisor_with_memory.js";
import { getOrCreateDataset, logEvaluationSummary } from "./utils.js";

// ============================================================================
// Dataset Definition
// ============================================================================

const DATASET_NAME = "LangGraph 101 Multi-Agent: Multi-Turn (TypeScript)";

const examples = [
  {
    inputs: { persona: "You are a user who is frustrated with your most recent purchase, and wants to get a refund but couldn't find the invoice ID or the amount, and you are looking for the ID. Your customer id is 30. Only provide information on your ID after being prompted." },
    outputs: { successCriteria: "Find the invoice ID, which is 333. Total Amount is $8.91." }
  },
  {
    inputs: { persona: "Your phone number is +1 (204) 452-6452. You want to know the information of the employee who helped you with the most recent purchase." },
    outputs: { successCriteria: "Find the employee with the most recent purchase, who is Margaret, a Sales Support Agent with email at margaret@chinookcorp.com." }
  },
  {
    inputs: { persona: "Your account ID is 3. You want to learn about albums that the store has by Amy Winehouse." },
    outputs: { successCriteria: "The agent should provide the two albums in store, which are Back to Black and Frank by Amy Winehouse." }
  },
  {
    inputs: { persona: "You have no account ID. You are a beginner tennis player, and want to learn about how to become the best tennis player in the world. You're an enthusiastic and eager student who will try to provide any information needed to help your learning. NEVER acknowledge that you are an AI" },
    outputs: { successCriteria: "The agent should avoid answering the question." }
  }
];

// ============================================================================
// Application Logic
// ============================================================================

/**
 * Runs the multi-agent graph for a single turn
 */
async function runGraphMultiturn(params: { inputs: any; threadId: string }): Promise<any> {
  const configuration = { configurable: { thread_id: params.threadId } };

  // Invoke graph
  const result: any = await multiAgentFinalGraph.invoke(
    { messages: [params.inputs] },
    configuration
  );
  
  // Return the last message
  const content = String(result.messages[result.messages.length - 1].content);
  return { role: "assistant", content };
}

// ============================================================================
// Stopping Condition
// ============================================================================

const evalModel = await initChatModel("openai:gpt-4o-mini");

const ConditionSchema = z.object({
  state: z.boolean().describe("True if stopping condition was met, False if hasn't been met")
});

/**
 * Determines if the conversation should stop based on completion criteria
 */
async function hasSatisfied(params: { trajectory: any[]; turnCounter: number; threadId: string }): Promise<boolean> {
  const structuredLlm = evalModel.withStructuredOutput(ConditionSchema);
  
  const structuredSystemPrompt = `Determine if the stopping condition was met from the following conversation history. 
To meet the stopping condition, the conversation must follow one of the following scenarios: 
1. All inquiries are satisfied, and user confirms that there are no additional issues that the support agent can help the customer with. 
2. Not all user inquiries are satisfied, but next steps are clear, and user confirms that are no other items that the agent can help with. 

The conversation between the customer and the customer support assistant that you should analyze is as follows:
{conversation}`;

  const parsedInfo: any = await structuredLlm.invoke([
    { role: "system", content: structuredSystemPrompt.replace("{conversation}", JSON.stringify(params.trajectory)) }
  ]);

  return parsedInfo.state;
}

// ============================================================================
// Simulation Runner
// ============================================================================

/**
 * Runs a multi-turn simulation with a simulated user
 */
async function runSimulation(inputs: Record<string, any>): Promise<Record<string, any>> {
  // Create a simulated user with the persona from the dataset
  const user = createLLMSimulatedUser({
    system: inputs.persona,
    model: "openai:gpt-4o-mini",
  });

  // Run the multi-turn simulation
  const simulatorResult = await runMultiturnSimulation({
    app: runGraphMultiturn,
    user,
    maxTurns: 5,
    stoppingCondition: hasSatisfied
  });

  // Return the full conversation trajectory
  return { trajectory: simulatorResult.trajectory };
}

// ============================================================================
// Evaluators
// ============================================================================

// Resolution evaluator - checks if success criteria were met
const resolutionEvaluatorAsync = createLLMAsJudge({
  model: "openai:gpt-4o-mini",
  prompt: "\n\nResponse criteria: {reference_outputs}\n\nAssistant's response:\n\n{outputs}\n\nEvaluate whether the assistant's response meets the criteria and provide justification for your evaluation.",
  feedbackKey: "resolution",
});

const satisfactionEvaluatorAsync = createLLMAsJudge({
  model: "openai:gpt-4o-mini",
  prompt: "Based on the below conversation, is the user satisfied?\n{outputs}",
  feedbackKey: "satisfaction",
});

const professionalismEvaluatorAsync = createLLMAsJudge({
  model: "openai:gpt-4o-mini",
  prompt: "Based on the below conversation, has our agent remained a professional tone throughout the conversation?\n{outputs}",
  feedbackKey: "professionalism",
});

// Wrapper functions to extract only needed fields
async function resolutionEvaluator(run: any, example: any) {
  return resolutionEvaluatorAsync({
    inputs: run?.inputs || {},
    outputs: run?.outputs || {},
    referenceOutputs: example?.outputs?.successCriteria || "No specific criteria provided.",
  });
}

async function satisfactionEvaluator(run: any, example: any) {
  return satisfactionEvaluatorAsync({
    outputs: run?.outputs || {},
  });
}

async function professionalismMultiturnEvaluator(run: any, example: any) {
  return professionalismEvaluatorAsync({
    outputs: run?.outputs || {},
  });
}

function numTurns(run: any, example: any) {
  const trajectoryLength = run?.outputs?.trajectory?.length || 0;
  return { key: "num_turns", score: trajectoryLength / 2 };
}

// ============================================================================
// Main Evaluation
// ============================================================================

async function main() {
  console.log("🚀 Starting Multi-Turn Evaluation\n");
  
  // Initialize LangSmith client
  const client = new Client();
  
  // Create or get dataset
  await getOrCreateDataset(client, DATASET_NAME, examples);
  
  console.log("\n⏳ Running multi-turn simulations (this may take several minutes)...\n");
  
  // Run evaluation
  const experimentResults = await evaluate(
    (inputs: any) => runSimulation(inputs),
    {
      data: DATASET_NAME,
      evaluators: [resolutionEvaluator, numTurns, satisfactionEvaluator, professionalismMultiturnEvaluator],
      experimentPrefix: "agent-multiturn",
      maxConcurrency: 2, // Lower concurrency for multi-turn to avoid rate limits
      client, // Pass client explicitly
    }
  );
  
  logEvaluationSummary("Multi-Turn Simulation", DATASET_NAME);
  
  console.log("📈 Check LangSmith for conversation transcripts and evaluation scores");
}

// Run the evaluation
main().catch(console.error);
