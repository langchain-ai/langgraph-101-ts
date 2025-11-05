import { SqlDatabase } from "@langchain/classic/sql_db";
import { DataSource } from "typeorm";
import initSqlJs from "sql.js";
import { z } from "zod/v3";
import { BaseMessage } from "langchain";
import { MessagesZodMeta } from "@langchain/langgraph";
import { withLangGraph } from "@langchain/langgraph/zod";
import { initChatModel } from "langchain";

// ============================================================================
// Model Initialization
// ============================================================================

/**
 * Default model used across all agents
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
 */
export async function getModel(modelName: string = "openai:03-mini") {
  return await initChatModel(modelName);
}
// ============================================================================
// Shared State Definition
// ============================================================================

/**
 * Shared state schema used across all agents
 * This ensures consistent state structure for message passing and context sharing
 */
export const StateAnnotation = z.object({
  messages: withLangGraph(z.custom<BaseMessage[]>(), MessagesZodMeta),
  customerId: z.number().optional(),
  loadedMemory: z.string().default(""),
  remainingSteps: z.number().default(25),
});

// ============================================================================
// Database Setup
// ============================================================================

/**
 * Sets up and initializes the Chinook database using sql.js
 * @returns Promise<SqlDatabase> - Initialized SqlDatabase instance
 */
export async function setupDatabase(): Promise<SqlDatabase> {
  console.log("📦 Setting up Chinook database...");
  
  // Download and execute the Chinook SQL script from GitHub
  const sqlScriptUrl = "https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_Sqlite.sql";
  
  const response = await fetch(sqlScriptUrl);
  if (!response.ok) {
    throw new Error(`Failed to download SQL script. Status: ${response.status}`);
  }
  const sqlScript = await response.text();
  
  // Initialize sql.js and create database from SQL script
  const SQL = await initSqlJs();
  const sqlJsDb = new SQL.Database();
  
  // Execute the SQL script to create and populate the database
  sqlJsDb.exec(sqlScript);
  
  // Export database to buffer for TypeORM
  const dbBuffer = sqlJsDb.export();
  
  // Create TypeORM DataSource with sql.js
  const datasource = new DataSource({
    type: "sqljs",
    database: dbBuffer,
    synchronize: false,
  });
  
  // Initialize the DataSource
  await datasource.initialize();
  
  const db = await SqlDatabase.fromDataSourceParams({
    appDataSource: datasource
  });
  
  console.log("✅ Chinook database loaded successfully!");
  return db;
}

