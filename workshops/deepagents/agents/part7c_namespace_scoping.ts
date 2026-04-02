/**
 * Part 7c: Namespace Scoping -- Per-User vs Global Memory
 *
 * Demonstrates memory isolation using StoreBackend's namespace parameter:
 *   /memories/user/    -> Private to the current user (scoped by user_id)
 *   /memories/shared/  -> Shared across all users (global namespace)
 *
 * To test: send messages with different user_ids in the config and verify
 * that private memories are isolated while shared memories are visible to all.
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
  systemPrompt: `You are a helpful assistant with scoped memory.

MEMORY SCOPES:
- /memories/user/    -> Private to the current user (only they can see it)
- /memories/shared/  -> Shared across all users (everyone can see it)

Save personal preferences to /memories/user/ and team guidelines to /memories/shared/.

When referencing file paths, use backtick formatting like \`path/file.md\` instead of markdown links.
`,
  backend: (config) => {
    const userId =
      (config as any)?.configurable?.user_id ?? "default";
    return new CompositeBackend(
      new StateBackend(config),
      {
        "/memories/user/": new StoreBackend(config, {
          namespace: ["user", userId, "filesystem"],
        }),
        "/memories/shared/": new StoreBackend(config, {
          namespace: ["shared", "filesystem"],
        }),
      }
    );
  },
});
