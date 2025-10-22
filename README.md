# LangGraph 101 - TypeScript

Welcome to LangGraph 101 for TypeScript! 

## Introduction
This repository contains TypeScript/JavaScript versions of the LangGraph 101 tutorials, teaching you the fundamentals of building agents with LangChain v1 and LangGraph v1. This is a condensed version of LangChain Academy, and is intended to be run in a session with a LangChain engineer. If you're interested in going into more depth, or working through a tutorial on your own, check out LangChain Academy [here](https://academy.langchain.com/courses/intro-to-langgraph)! LangChain Academy has helpful pre-recorded videos from one of our LangChain engineers.

## Context

At LangChain, we aim to make it easy to build LLM applications. One type of LLM application you can build is an agent. There’s a lot of excitement around building agents because they can automate a wide range of tasks that were previously impossible. 

In practice though, it is incredibly difficult to build systems that reliably execute on these tasks. As we’ve worked with our users to put agents into production, we’ve learned that more control is often necessary. You might need an agent to always call a specific tool first or use different prompts based on its state.

To tackle this problem, we’ve built [LangGraph](https://langchain-ai.github.io/langgraph/) — a framework for building agent and multi-agent applications. Separate from the LangChain package, LangGraph’s core design philosophy is to help developers add better precision and control into agent workflows, suitable for the complexity of real-world systems.

## Pre-work

### Clone the LangGraph 101 repo
```
git clone https://github.com/langchain-ai/langgraph-101.git
```


### Create an environment 
Ensure you have a recent version of pip and python installed
```
$ cd langgraph-101
# Copy the .env.example file to .env
cp .env.example .env
```
If you run into issues with setting up the python environment or acquiring the necessary API keys due to any restrictions (ex. corporate policy), contact your LangChain representative and we'll find a work-around!

### Package Installation
Ensure you have a recent version of Node.js (v20+) and pnpm installed
```bash
# Install pnpm if you haven't already
npm install -g pnpm

# Install dependencies
pnpm install
```

### Running TypeScript Notebooks

TypeScript notebooks require a special Jupyter kernel. Follow these steps:

#### 1. Install Jupyter (if not already installed)
```bash
# Using pip
pip install jupyter

# Or using conda
conda install jupyter
```

#### 2. Install the TypeScript Kernel (tslab)
```bash
# Install tslab globally
npm install -g tslab

# Register the TypeScript kernel with Jupyter
tslab install --version
```

#### 3. Open the Notebook
```bash
# Navigate to the notebook directory
cd notebooks/LG101

# Launch Jupyter
jupyter notebook langgraph_101.ipynb
```

Alternatively, you can use VS Code (or any VS Code fork like Cursor/Windsurf) with the Jupyter extension, which will automatically detect the TypeScript kernel once tslab is installed.

#### 4. Verify Kernel Selection
When you open the notebook, make sure the kernel is set to "TypeScript" (look for the kernel indicator in the top-right corner of Jupyter or VS Code).

#### Troubleshooting
- If the TypeScript kernel doesn't appear, try running `tslab install` again
- Make sure `node` and `npm` are in your PATH
- You may need to restart Jupyter after installing tslab
- For VS Code, reload the window after installing tslab


### Azure OpenAI Instructions

If you are using Azure OpenAI instead of OpenAI, there are a few things you need to do:

1. Set necessary environment variables in your `.env` file:
    ```
    AZURE_OPENAI_API_KEY=your-azure-key
    AZURE_OPENAI_ENDPOINT=your-azure-endpoint
    AZURE_OPENAI_API_VERSION=2024-02-15-preview
    ```

2. In the notebooks, use `initChatModel` with Azure configuration:
    ```typescript
    import { initChatModel } from "langchain";
    
    const model = await initChatModel("azure_openai:gpt-4o", {
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiInstanceName: "your-instance-name",
      azureOpenAIApiDeploymentName: "your-deployment-name",
      azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
    });
    ```