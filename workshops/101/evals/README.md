# Agent Evaluations

Welcome to the evaluations folder! This contains ready-to-run TypeScript scripts that test and measure how well your agents are performing.

## Why Evaluate Agents?

LLMs don't always behave predictably. Small changes in prompts, models, or inputs can significantly impact results. Evaluations help you:

- **Catch Failures**: Identify when agents aren't working as expected
- **Compare Changes**: See if code changes improved or degraded performance  
- **Build Confidence**: Ensure your agents are production-ready

![Evaluation Concepts](../images/evals-conceptual.png)

## How Evaluations Work

Every evaluation has three parts:

1. **Dataset** - Test cases with example inputs and expected outputs
2. **Your Agent** - The application being tested
3. **Evaluators** - Scoring functions that measure quality (correctness, professionalism, etc.)

## Evaluation Types

This folder contains 4 types of agent evaluations:

### 1. Final Response Evaluation (`01-final-response.ts`)

Evaluates the agent's overall performance by treating it as a black box and assessing whether it gets the job done.

- **Input**: User input
- **Output**: The agent's final response
- **Evaluators**: Correctness (openevals), Professionalism (custom)

![Final Response](../images/final-response.png)

**Run it:**
```bash
npx tsx evals/01-final-response.ts
```

### 2. Single Step Evaluation (`02-single-step.ts`)

Evaluates a single step of the agent in isolation - specifically, whether the supervisor routes to the correct subagent.

- **Input**: User query
- **Output**: Which subagent was selected
- **Evaluators**: Route correctness

![Single Step](../images/single-step.png)

**Run it:**
```bash
npx tsx evals/02-single-step.ts
```

### 3. Trajectory Evaluation (`03-trajectory.ts`)

Evaluates whether the agent took the expected path (sequence of tool calls) to arrive at the final answer.

- **Input**: User query
- **Output**: List of tool calls made
- **Evaluators**: Exact match, unmatched steps counter

![Trajectory](../images/trajectory.png)

**Run it:**
```bash
npx tsx evals/03-trajectory.ts
```

### 4. Multi-Turn Evaluation (`04-multi-turn.ts`)

Simulates multi-turn conversations between a simulated user and the agent to evaluate performance over multiple interactions.

- **Input**: User persona and behavior
- **Output**: Full conversation trajectory
- **Evaluators**: Resolution, satisfaction, professionalism, turn count

![Multi-Turn](../images/multi_turn.png)

**Run it:**
```bash
npx tsx evals/04-multi-turn.ts
```

## Prerequisites

### Environment Setup

Make sure you have your LangSmith API key configured:

```bash
# Add to your .env file
LANGSMITH_API_KEY=your-api-key-here
```

### Install Dependencies

All required dependencies are already in `package.json`:

```bash
pnpm install
```

## Running Evaluations

Each evaluation script can be run independently:

```bash
# Run all evaluations
npx tsx evals/01-final-response.ts
npx tsx evals/02-single-step.ts
npx tsx evals/03-trajectory.ts
npx tsx evals/04-multi-turn.ts
```

## Viewing Results

After running an evaluation, the script will output a LangSmith URL where you can view detailed results, including:

- Individual test case results
- Evaluation scores and feedback
- Comparison charts
- Detailed traces of agent execution

Example output:
```
✅ Evaluation complete!
View results at: https://smith.langchain.com/o/[org-id]/datasets/[dataset-id]/compare?selectedSessions=[session-id]
```

## Customizing Evaluations

### Adding New Test Cases

To add more test cases, edit the `examples` array in any evaluation script:

```typescript
const examples = [
  {
    inputs: { messages: "Your test input here" },
    outputs: { route: "expected_output_here" }
  },
  // Add more examples...
];
```

### Creating Custom Evaluators

Build your own evaluators to measure specific metrics:

```typescript
async function customEvaluator({ outputs, referenceOutputs }: {
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
}): Promise<{ key: string; score: number; comment?: string }> {
  // Your custom evaluation logic
  const score = outputs.someMetric === referenceOutputs?.someMetric ? 1 : 0;
  
  return {
    key: "custom_metric",
    score,
    comment: "Why this score was assigned"
  };
}
```

## Troubleshooting

**"Cannot read properties of undefined (reading 'dataset_id')"**
- Make sure your `LANGSMITH_API_KEY` is set in `.env`
- Dataset names must be unique across evaluations
- Try deleting the dataset in LangSmith and re-running

**Evaluation taking too long**
- Reduce `maxConcurrency` in the evaluate() call
- Multi-turn evaluations are naturally slower (simulating conversations)

**Rate limit errors**
- Lower `maxConcurrency` to 1 or 2
- Add delays between API calls if needed

## Utilities

The `utils.ts` file contains shared helper functions:

- `getOrCreateDataset()` - Creates datasets only if they don't exist
- `extractToolCalls()` - Parses tool calls from agent execution
- `logEvaluationSummary()` - Formats console output

## Important Notes

- **Datasets persist**: Once created, datasets store all test cases permanently
- **Multiple experiments**: Each run creates a new experiment (with timestamp) under the same dataset
- **LangSmith required**: You need a LangSmith account and API key to run evaluations
- **Agents required**: Evaluations test the agents in `../agents/` - make sure they work first!

