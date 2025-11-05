import "dotenv/config";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { v4 as uuidv4 } from "uuid";
import { HumanMessage } from "langchain";
import { Command } from "@langchain/langgraph";
import { createLLMAsJudge } from "openevals";
import { CORRECTNESS_PROMPT } from "openevals/prompts";
import { initChatModel } from "langchain";
import { z } from "zod/v3";
import { graph as multiAgentVerifyGraph } from "../agents/04-supervisor_with_verification.js";
import { getOrCreateDataset, logEvaluationSummary } from "./utils.js";

// ============================================================================
// Dataset Definition
// ============================================================================

const DATASET_NAME = "LangGraph 101 Multi-Agent: Final Response (TypeScript)";

const examples = [
  {
    inputs: {
      messages: [{ role: "user", content: "My name is Aaron Mitchell. Account ID is 32. My number associated with my account is +1 (204) 452-6452. I am trying to find the invoice number for my most recent song purchase. Could you help me with it?" }]
    },
    outputs: {
      messages: [{ role: "ai", content: "The Invoice ID of your most recent purchase was 342." }]
    }
  },
  {
    inputs: {
      messages: [{ role: "user", content: "I'd like a refund." }]
    },
    outputs: {
      messages: [{ role: "ai", content: "I've confirmed your account. Could you please provide more details about the purchase you would like refunded?" }]
    }
  },
  {
    inputs: {
      messages: [{ role: "user", content: "Who recorded Wish You Were Here again?" }]
    },
    outputs: {
      messages: [{ role: "ai", content: "Wish You Were Here is an album by Pink Floyd" }]
    }
  },
  {
    inputs: {
      messages: [{ role: "user", content: "What albums do you have by Coldplay?" }]
    },
    outputs: {
      messages: [{ role: "ai", content: "I searched our music store's database, and there are no Coldplay albums available in our catalog at the moment." }]
    }
  },
  {
    inputs: {
      messages: [{ role: "user", content: "How do I become a billionaire?" }]
    },
    outputs: {
      messages: [{ role: "ai", content: "I'm here to help with questions regarding our digital music store. If you have any questions about our music catalog or previous purchases, feel free to ask!" }]
    }
  }
];

// ============================================================================
// Application Logic
// ============================================================================

/**
 * Runs the multi-agent graph with human-in-the-loop handling
 */
async function runGraph(inputs: Record<string, any>): Promise<Record<string, any>> {
  const threadId = uuidv4();
  const config = { configurable: { thread_id: threadId, user_id: "10" } };

  // Invoke graph until interrupt
  await multiAgentVerifyGraph.invoke(inputs, config);

  // Resume from human-in-the-loop with customer ID
  const result: any = await multiAgentVerifyGraph.invoke(
    new Command({ resume: "My customer ID is 10" }),
    { configurable: { thread_id: threadId, user_id: "10" } }
  );

  // Return only the final message content
  const content = String(result.messages[result.messages.length - 1].content);
  return { messages: [{ role: "ai", content }] };
}

// ============================================================================
// Evaluators
// ============================================================================

// Initialize evaluation model
const evalModel = await initChatModel("openai:gpt-4o-mini");

// Correctness evaluator using openevals
const baseCorrectness = createLLMAsJudge({
  prompt: CORRECTNESS_PROMPT,
  feedbackKey: "correctness",
  judge: evalModel,
});

// Wrapper to extract only needed fields
async function correctnessEvaluator(args: any) {
  return baseCorrectness({
    inputs: args.inputs,
    outputs: args.outputs,
    referenceOutputs: args.referenceOutputs,
  });
}

// Custom professionalism evaluator
const professionalismGraderInstructions = `You are an evaluator assessing the professionalism of an agent's response.
You will be given a QUESTION, the AGENT RESPONSE, and a GROUND TRUTH REFERENCE RESPONSE. 
Here are the professionalism criteria to follow:

(1) TONE: The response should maintain a respectful, courteous, and business-appropriate tone throughout.
(2) LANGUAGE: The response should use proper grammar, spelling, and professional vocabulary. Avoid slang, overly casual expressions, or inappropriate language.
(3) STRUCTURE: The response should be well-organized, clear, and easy to follow.
(4) COURTESY: The response should acknowledge the user's request appropriately and show respect for their time and concerns.
(5) BOUNDARIES: The response should maintain appropriate professional boundaries without being overly familiar or informal.
(6) HELPFULNESS: The response should demonstrate a genuine attempt to assist the user within professional standards.

Professionalism Rating:
True means that the agent's response meets professional standards across all criteria.
False means that the agent's response fails to meet professional standards in one or more significant areas.

Explain your reasoning in a step-by-step manner to ensure your evaluation is thorough and fair.`;

const ProfessionalismGradeSchema = z.object({
  reasoning: z.string().describe("Explain your step-by-step reasoning for the professionalism assessment, covering tone, language, structure, courtesy, boundaries, and helpfulness."),
  isProfessional: z.boolean().describe("True if the agent response meets professional standards, otherwise False."),
});

const professionalismGraderLlm = evalModel.withStructuredOutput(ProfessionalismGradeSchema);

async function professionalismEvaluator({
  outputs,
  referenceOutputs,
  inputs
}: {
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
  inputs?: Record<string, any>;
}): Promise<{ key: string; score: number; comment: string }> {
  const userContext = `QUESTION: ${JSON.stringify(inputs?.messages)}
GROUND TRUTH RESPONSE: ${JSON.stringify(referenceOutputs?.messages)}
AGENT RESPONSE: ${JSON.stringify(outputs?.messages)}`;
  
  const grade: any = await professionalismGraderLlm.invoke([
    { role: "system", content: professionalismGraderInstructions }, 
    { role: "user", content: userContext }
  ]);
  
  return {
    key: "professionalism",
    score: grade.isProfessional ? 1 : 0,
    comment: grade.reasoning
  };
}

// ============================================================================
// Main Evaluation
// ============================================================================

async function main() {
  console.log("🚀 Starting Final Response Evaluation\n");
  
  // Initialize LangSmith client
  const client = new Client();
  
  // Create or get dataset
  await getOrCreateDataset(client, DATASET_NAME, examples);
  
  console.log("\n⏳ Running evaluation (this may take a few minutes)...\n");
  
  // Run evaluation
  const experimentResults = await evaluate((inputs: any) => runGraph(inputs), {
    data: DATASET_NAME,
    evaluators: [correctnessEvaluator, professionalismEvaluator],
    experimentPrefix: "agent-e2e",
    maxConcurrency: 3,
    client, // Pass client explicitly
  });
  
  logEvaluationSummary("Final Response (E2E)", DATASET_NAME);
  
  console.log("📈 Check LangSmith for detailed results and visualizations");
}

// Run the evaluation
main().catch(console.error);
