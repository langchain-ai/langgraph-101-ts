/**
 * Part 7b: Semantic, Episodic & Procedural Memory
 *
 * Routes three memory types to separate persistent namespaces:
 *   /memories/semantic/    -> Facts & knowledge
 *   /memories/episodic/    -> Past experiences
 *   /memories/procedural/  -> Instructions & rules
 *
 * Based on the CoALA paper (https://arxiv.org/abs/2309.02427) which maps
 * cognitive science memory types to agent architectures.
 */

import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";
import { model, tavilySearch } from "./_shared.js";

export const agent = createDeepAgent({
  model,
  tools: [tavilySearch],
  systemPrompt: `You are a helpful assistant with structured long-term memory.

Your memory is organized into three types:
- /memories/semantic/   -> Facts & knowledge (user preferences, project details)
- /memories/episodic/   -> Past experiences (session logs, interaction summaries)
- /memories/procedural/ -> Instructions & rules (how to format reports, coding standards)

When asked to remember something, save it to the appropriate memory type.
Regular files (not in /memories/) are ephemeral and disappear after the conversation.

When referencing file paths, use backtick formatting like \`path/file.md\` instead of markdown links.
`,
  backend: (config) =>
    new CompositeBackend(
      new StateBackend(config),
      {
        "/memories/semantic/": new StoreBackend(config, {
          namespace: ["memories", "semantic"],
        }),
        "/memories/episodic/": new StoreBackend(config, {
          namespace: ["memories", "episodic"],
        }),
        "/memories/procedural/": new StoreBackend(config, {
          namespace: ["memories", "procedural"],
        }),
      }
    ),
});
