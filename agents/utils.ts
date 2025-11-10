import { SqlDatabase } from "@langchain/classic/sql_db";
import { DataSource } from "typeorm";
import initSqlJs from "sql.js";
import { z } from "zod/v3";
import { initChatModel, BaseMessage } from "langchain";
import { MessagesZodMeta } from "@langchain/langgraph";
import { withLangGraph } from "@langchain/langgraph/zod";

// ============================================================================
// SHARED UTILITIES FOR ALL AGENTS
// ============================================================================
//
// This file contains shared resources used across all agent examples:
// - Model initialization
// - State schema definitions
// - Database setup
//
// Centralizing these reduces duplication and ensures consistency.

// ============================================================================
// Model Initialization
// ============================================================================
//
// USING initChatModel()
// This is LangChain's universal chat model initializer.
// It works with any major LLM provider using a simple "provider:model" format.
//
// Learn more: https://js.langchain.com/docs/integrations/chat/

/**
 * Default model used across all agents in this workshop
 */
export const defaultModel = await initChatModel("openai:o3-mini");

/**
 * To use a different provider, replace the line below with one of these examples:
 *
 * Azure OpenAI:
 * export const defaultModel = await initChatModel("azure_openai:gpt-4o", {
 *   azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
 *   azureOpenAIApiInstanceName: "your-instance-name",
 *   azureOpenAIApiDeploymentName: "your-deployment-name",
 *   azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
 * });
 *
 * Anthropic Claude:
 * export const defaultModel = await initChatModel("anthropic:claude-3-5-sonnet-20241022", {
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * });
 *
 * AWS Bedrock (Claude):
 * export const defaultModel = await initChatModel("bedrock:anthropic.claude-3-5-sonnet-20241022-v2:0", {
 *   region: process.env.AWS_REGION || "us-east-1",
 *   credentials: {
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
 *   },
 * });
 */

/**
 * Helper to initialize a specific model
 * Use this when you want a different model than the default in a specific agent
 * 
 * Example: const gpt4 = await getModel("openai:gpt-4o");
 */
export async function getModel(modelName: string = "openai:03-mini") {
  return await initChatModel(modelName);
}

// ============================================================================
// Shared State Definition
// ============================================================================
//
// STATE IN LANGGRAPH
// State is how nodes communicate in LangGraph. It's like a shared context
// that flows through the graph, with each node reading from and writing to it.
//
// WHY ZOD?
// We use Zod schemas to define state for type-safety and validation.
// The withLangGraph() wrapper adds special metadata for message handling.
//
// Learn more: https://langchain-ai.github.io/langgraphjs/concepts/low_level/#state

/**
 * Shared state schema used across all agents
 * This ensures consistent state structure for message passing and context sharing
 * 
 * Fields:
 * - messages: Conversation history (required)
 * - customerId: Verified customer identifier (optional)
 * - loadedMemory: User preferences loaded from memory store
 * - remainingSteps: Maximum steps before timeout (prevents infinite loops)
 */
export const AgentState = z.object({
  messages: withLangGraph(z.custom<BaseMessage[]>(), MessagesZodMeta),
  customerId: z.number().optional(),
  loadedMemory: z.string().default(""),
  remainingSteps: z.number().default(25),
});

export type AgentState = z.infer<typeof AgentState>;

// ============================================================================
// Database Setup
// ============================================================================
//
// WORKSHOP DATABASE
// For this workshop, we use the Chinook database - a sample music store database.
// It includes tables for artists, albums, tracks, invoices, customers, etc.
//
// WHY SQL.JS?
// sql.js runs SQLite entirely in memory - no database server needed!
// Perfect for demos and workshops.
//
// PRODUCTION NOTE:
// In production, you'd connect to a real database (PostgreSQL, MySQL, etc.)
// using the appropriate TypeORM configuration.

/**
 * Sets up and initializes the Chinook database using sql.js
 * 
 * The Chinook database is a sample music store database with:
 * - Artists, Albums, Tracks
 * - Customers, Invoices
 * - Employees, Playlists, Genres
 * 
 * @returns Promise<SqlDatabase> - Initialized SqlDatabase instance
 */
export async function setupDatabase(): Promise<SqlDatabase> {
  console.log("📦 Setting up Chinook database...");

  // Download the Chinook SQL script from GitHub
  const sqlScriptUrl =
    "https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_Sqlite.sql";

  const response = await fetch(sqlScriptUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download SQL script. Status: ${response.status}`
    );
  }
  const sqlScript = await response.text();

  // Initialize sql.js (SQLite compiled to WebAssembly)
  const SQL = await initSqlJs();
  const sqlJsDb = new SQL.Database();

  // Execute the SQL script to create and populate all tables
  sqlJsDb.exec(sqlScript);

  // Export database to buffer so TypeORM can use it
  const dbBuffer = sqlJsDb.export();

  // Create TypeORM DataSource
  // TypeORM provides a nice abstraction over raw SQL
  const datasource = new DataSource({
    type: "sqljs",
    database: dbBuffer,
    synchronize: false,  // Don't auto-migrate schema
  });

  // Initialize the DataSource
  await datasource.initialize();

  // Wrap in LangChain's SqlDatabase for agent use
  const db = await SqlDatabase.fromDataSourceParams({
    appDataSource: datasource,
  });

  console.log("✅ Chinook database loaded successfully!");
  return db;
}
