import { Client } from "langsmith";

// ============================================================================
// Types
// ============================================================================

export interface EvaluationResult {
  key: string;
  score: number | boolean;
  comment?: string;
}

export interface DatasetExample {
  inputs: Record<string, any>;
  outputs: Record<string, any>;
}

// ============================================================================
// Dataset Helpers
// ============================================================================

/**
 * Creates LangSmith dataset if it doesn't already exist
 * Uses readDataset to check existence (more reliable than hasDataset)
 */
export async function getOrCreateDataset(
  client: Client,
  datasetName: string,
  examples: DatasetExample[]
): Promise<void> {
  try {
    // Try to read the dataset - if it exists, we're done
    await client.readDataset({ datasetName });
    console.log(`📊 Dataset already exists: ${datasetName}`);
  } catch (error) {
    // Dataset doesn't exist, create it
    console.log(`📊 Creating dataset: ${datasetName}`);
    const dataset = await client.createDataset(datasetName);
    
    // Create examples individually (current LangSmith API)
    for (const example of examples) {
      await client.createExample({
        inputs: example.inputs,
        outputs: example.outputs,
        dataset_id: dataset.id,
      });
    }
    
    console.log(`✅ Created dataset with ${examples.length} examples`);
  }
}

// ============================================================================
// Tool Call Extraction
// ============================================================================

/**
 * Extracts tool call names from agent messages
 */
export function extractToolCalls(input: any): string[] {
  const toolCalls: string[] = [];
  
  if (input && typeof input === "object" && "messages" in input) {
    for (const message of input.messages) {
      if (message.additional_kwargs?.tool_calls) {
        const tools = message.additional_kwargs.tool_calls;
        toolCalls.push(...tools.map((tool: any) => tool.function.name));
      }
    }
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (item.name) {
        toolCalls.push(item.name);
      }
    }
  }
  
  return toolCalls;
}

// ============================================================================
// Logging Helpers
// ============================================================================

/**
 * Logs evaluation summary
 */
export function logEvaluationSummary(experimentPrefix: string, datasetName: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ Evaluation complete: ${experimentPrefix}`);
  console.log(`📊 Dataset: ${datasetName}`);
  console.log(`${"=".repeat(60)}\n`);
}

