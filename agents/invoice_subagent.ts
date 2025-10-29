import "dotenv/config";
import { initChatModel, tool } from "langchain";
import { z } from "zod/v3"; // Import from zod/v3 for LangGraph compatibility
import { MemorySaver, InMemoryStore } from "@langchain/langgraph";
import { createAgent } from "langchain";
import { SqlDatabase } from "@langchain/classic/sql_db";
import { setupDatabase } from "./utils.js";


// ============================================================================
// Tools
// ============================================================================

async function createInvoiceTools(db: SqlDatabase) {
  const getInvoicesByCustomerSortedByDate = tool(
    async ({ customerId }: { customerId: number }) => {
      const query = `SELECT * FROM Invoice WHERE CustomerId = ${customerId} ORDER BY InvoiceDate DESC;`;
      const rawResult = await db.run(query);
      const result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
      return JSON.stringify(result);
    },
    {
      name: "get_invoices_by_customer_sorted_by_date",
      description: "Look up all invoices for a customer using their customer ID. The invoices are sorted in descending order by invoice date.",
      schema: z.object({
        customerId: z.number().describe("The customer ID"),
      }),
    }
  );

  const getInvoicesSortedByUnitPrice = tool(
    async ({ customerId }: { customerId: number }) => {
      const query = `
        SELECT Invoice.*, InvoiceLine.UnitPrice
        FROM Invoice
        JOIN InvoiceLine ON Invoice.InvoiceId = InvoiceLine.InvoiceId
        WHERE Invoice.CustomerId = ${customerId}
        ORDER BY InvoiceLine.UnitPrice DESC;
      `;
      const rawResult = await db.run(query);
      const result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
      return JSON.stringify(result);
    },
    {
      name: "get_invoices_sorted_by_unit_price",
      description: "Use this tool when the customer wants to know the details of one of their invoices based on the unit price/cost. This tool looks up all invoices for a customer and sorts by unit price.",
      schema: z.object({
        customerId: z.number().describe("The customer ID"),
      }),
    }
  );

  const getEmployeeByInvoiceAndCustomer = tool(
    async ({ invoiceId, customerId }: { invoiceId: number; customerId: number }) => {
      const query = `
        SELECT Employee.FirstName, Employee.Title, Employee.Email
        FROM Employee
        JOIN Customer ON Customer.SupportRepId = Employee.EmployeeId
        JOIN Invoice ON Invoice.CustomerId = Customer.CustomerId
        WHERE Invoice.InvoiceId = ${invoiceId} AND Invoice.CustomerId = ${customerId};
      `;
      const rawResult = await db.run(query);
      const result = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
      
      if (!result || result.length === 0) {
        return `No employee found for invoice ID ${invoiceId} and customer identifier ${customerId}.`;
      }
      return JSON.stringify(result);
    },
    {
      name: "get_employee_by_invoice_and_customer",
      description: "This tool will take in an invoice ID and customer ID and return the employee information associated with the invoice.",
      schema: z.object({
        invoiceId: z.number().describe("The ID of the specific invoice"),
        customerId: z.number().describe("The customer ID"),
      }),
    }
  );

  return [getInvoicesByCustomerSortedByDate, getInvoicesSortedByUnitPrice, getEmployeeByInvoiceAndCustomer];
}

// ============================================================================
// System Prompt
// ============================================================================

const invoiceSubagentPrompt = `
<important_background>
You are a subagent among a team of assistants. You are specialized for retrieving and processing invoice information. 
Invoices contain information such as song purchases and billing history. Only respond to questions if they relate in some way to billing, invoices, or purchases.  
If you are unable to retrieve the invoice information, respond that you are unable to retrieve the information.
IMPORTANT: Your interaction with the customer is done through an automated system. You are not directly interacting with the customer, so avoid chitchat or follow up questions and focus PURELY on responding to the request with the necessary information. 
</important_background>
 
<tools>
You have access to three tools. These tools enable you to retrieve and process invoice information from the database. Here are the tools:
- get_invoices_by_customer_sorted_by_date: Retrieves all invoices for a customer (requires customerId parameter)
- get_invoices_sorted_by_unit_price: Retrieves all invoices for a customer sorted by unit price (requires customerId parameter)
- get_employee_by_invoice_and_customer: Retrieves employee information for an invoice (requires invoiceId and customerId parameters)

IMPORTANT: All tools require a customerId parameter. You will receive the customer ID from the user's context or state. Pay attention to the customer ID and always pass it when calling these tools.
</tools>

<core_responsibilities>
- Retrieve and process invoice information from the database
- Provide detailed information about invoices, including customer details, invoice dates, total amounts, employees associated with the invoice, etc. when the customer asks for it.
- Always maintain a professional, friendly, and patient demeanor in your responses.
</core_responsibilities>

You may have additional context that you should use to help answer the customer's query. It will be provided to you below:
`;

// ============================================================================
// Agent Creation
// ============================================================================

async function createInvoiceInformationSubagent() {
  console.log("💰 Creating Invoice Information Subagent...");
  
  // Setup database
  const db = await setupDatabase();
  
  // Initialize model
  const model = await initChatModel("openai:gpt-4o-mini");
  
  // Create tools
  const invoiceTools = await createInvoiceTools(db);
  
  // Define the subagent using LangChain v1's createAgent
  const invoiceInformationSubagent = createAgent({
    model,
    tools: invoiceTools,
    systemPrompt: invoiceSubagentPrompt,
  });

  console.log("✅ Invoice Information Subagent created successfully!");
  
  return invoiceInformationSubagent;
}

// ============================================================================
// Export
// ============================================================================

const agent = await createInvoiceInformationSubagent();
export const graph = agent.graph;

