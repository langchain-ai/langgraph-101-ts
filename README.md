# LangGraph Workshops - TypeScript

Welcome to the LangGraph Workshops for TypeScript!

## Introduction

This repository contains hands-on TypeScript workshops for learning to build agents with LangChain and LangGraph, organized into independent learning tracks:

- **101 - Fundamentals**: Build agents from scratch with LangChain v1 and LangGraph v1 -- tools, state, multi-agent supervisors, human-in-the-loop, memory, and evaluations.
- **Deep Agents** *(coming soon)*: Advanced patterns including deep agents, AGENTS.md, skills, long-term memory, and production workflows.

This is a condensed version of [LangChain Academy](https://academy.langchain.com/), intended to be run in a session with a LangChain engineer. If you're interested in going deeper or working through tutorials on your own, check out LangChain Academy -- it has helpful pre-recorded videos from our engineers.

> **Note**: This is the **TypeScript** version. The Python version is at [langchain-ai/langgraph-101](https://github.com/langchain-ai/langgraph-101).

## What's Inside

| Workshop | Path | Status | Description |
|----------|------|--------|-------------|
| **101 - Fundamentals** | [`workshops/101/`](./workshops/101/) | Available | 6 progressive agents covering tools, state graphs, multi-agent supervisors, human-in-the-loop, and memory. Includes 4 evaluation scripts. |
| **Deep Agents** | `workshops/deepagents/` | Coming soon | Advanced agent patterns with AGENTS.md, skills, and production workflows. |

Each workshop is self-contained with its own `package.json`, `langgraph.json`, `.env.example`, and `README.md` with detailed setup and usage instructions.

## Project Structure

```
langgraph-101-ts/
├── .gitignore
├── LICENSE
├── README.md                 # This file
└── workshops/
    ├── 101/                  # Fundamentals workshop
    │   ├── agents/           # 6 progressive agent implementations
    │   ├── evals/            # 4 evaluation scripts
    │   ├── images/           # Architecture diagrams
    │   ├── .env.example      # Environment variable template
    │   ├── langgraph.json    # Agent registry for LangGraph Studio
    │   ├── package.json
    │   ├── pnpm-lock.yaml
    │   └── README.md         # Workshop-specific instructions
    └── deepagents/           # Coming soon
        └── ...
```

## Context

At LangChain, we aim to make it easy to build LLM applications. One type of LLM application you can build is an agent. There's a lot of excitement around building agents because they can automate a wide range of tasks that were previously impossible.

In practice though, it is incredibly difficult to build systems that reliably execute on these tasks. As we've worked with our users to put agents into production, we've learned that more control is often necessary. You might need an agent to always call a specific tool first or use different prompts based on its state.

To tackle this problem, we've built [LangGraph](https://langchain-ai.github.io/langgraphjs/) -- a framework for building agent and multi-agent applications. Separate from the LangChain package, LangGraph's core design philosophy is to help developers add better precision and control into agent workflows, suitable for the complexity of real-world systems.

## Pre-work

### 1. Clone the repository

```bash
git clone https://github.com/langchain-ai/langgraph-101-ts.git
cd langgraph-101-ts
```

### 2. Navigate to a workshop and follow its README

Each workshop is self-contained. Navigate to the workshop directory and follow its setup instructions:

- **101 - Fundamentals**: [`workshops/101/README.md`](./workshops/101/README.md)

The workshop README will guide you through environment setup, dependency installation, and launching LangGraph Studio.

## Getting Started

### Recommended Learning Path

1. **Start with 101** -- Navigate to [`workshops/101/`](./workshops/101/) and follow the README to install dependencies and launch LangGraph Studio. Work through agents 00-05 in order.
2. **Deep Agents** *(coming soon)* -- Advanced patterns will be added in `workshops/deepagents/`.

## Resources

- [LangChain JS/TS Documentation](https://js.langchain.com/) -- Complete LangChain JS reference
- [LangGraph JS Documentation](https://langchain-ai.github.io/langgraphjs/) -- LangGraph JS guides and API reference
- [LangChain Academy](https://academy.langchain.com/) -- Free courses with video tutorials
- [LangSmith](https://smith.langchain.com) -- Debugging and monitoring for LLM applications
- [Python version of this workshop](https://github.com/langchain-ai/langgraph-101) -- The upstream Python repo
