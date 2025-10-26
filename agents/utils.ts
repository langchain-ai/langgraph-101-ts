import { SqlDatabase } from "@langchain/classic/sql_db";
import { DataSource } from "typeorm";
import initSqlJs from "sql.js";

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

