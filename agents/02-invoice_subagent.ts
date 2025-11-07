import "dotenv/config";
import { z } from "zod/v3";
import { createAgent, tool } from "langchain";
import { SqlDatabase } from "@langchain/classic/sql_db";
import { setupDatabase, AgentState, defaultModel } from "./utils.js";
import { getCurrentTaskInput } from "@langchain/langgraph";

// ============================================================================
// Tools
// ============================================================================

async function createInvoiceTools(db: SqlDatabase) {
  const getInvoicesByCustomerSortedByDate = tool(
    async () => {
      // Get customerId from the graph's state
      const state = await getCurrentTaskInput<AgentState>();
      const customerId = state.customerId;

      if (!customerId) {
        return "Error: Customer ID not found in state. Customer must be verified first.";
      }

      const query = `SELECT * FROM Invoice WHERE CustomerId = ${customerId} ORDER BY InvoiceDate DESC;`;
      const rawResult = await db.run(query);
      const result =
        typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;
      return JSON.stringify(result);
    },
    {
      name: "get_invoices_by_customer_sorted_by_date",
      description:
        "Look up all invoices for the current customer. The invoices are sorted in descending order by invoice date. The customer ID is automatically retrieved from the state.",
      schema: z.object({}),
    }
  );

  const getInvoicesSortedByUnitPrice = tool(
    async () => {
      // Get customerId from the graph's state
      const state = await getCurrentTaskInput<AgentState>();
      const customerId = state.customerId;

      if (!customerId) {
        return "Error: Customer ID not found in state. Customer must be verified first.";
      }

      const query = `
        SELECT Invoice.*, InvoiceLine.UnitPrice
        FROM Invoice
        JOIN InvoiceLine ON Invoice.InvoiceId = InvoiceLine.InvoiceId
        WHERE Invoice.CustomerId = ${customerId}
        ORDER BY InvoiceLine.UnitPrice DESC;
      `;
      const rawResult = await db.run(query);
      const result =
        typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;
      return JSON.stringify(result);
    },
    {
      name: "get_invoices_sorted_by_unit_price",
      description:
        "Use this tool when the customer wants to know the details of one of their invoices based on the unit price/cost. This tool looks up all invoices for the current customer and sorts by unit price. The customer ID is automatically retrieved from the state.",
      schema: z.object({}),
    }
  );

  const getEmployeeByInvoiceAndCustomer = tool(
    async ({ invoiceId }) => {
      // Get customerId from the graph's state
      const state = await getCurrentTaskInput<AgentState>();
      const customerId = state.customerId;

      if (!customerId) {
        return "Error: Customer ID not found in state. Customer must be verified first.";
      }

      const query = `
        SELECT Employee.FirstName, Employee.Title, Employee.Email
        FROM Employee
        JOIN Customer ON Customer.SupportRepId = Employee.EmployeeId
        JOIN Invoice ON Invoice.CustomerId = Customer.CustomerId
        WHERE Invoice.InvoiceId = ${invoiceId} AND Invoice.CustomerId = ${customerId};
      `;
      const rawResult = await db.run(query);
      const result =
        typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;

      if (!result || result.length === 0) {
        return `No employee found for invoice ID ${invoiceId} and customer identifier ${customerId}.`;
      }
      return JSON.stringify(result);
    },
    {
      name: "get_employee_by_invoice_and_customer",
      description:
        "This tool will take in an invoice ID and return the employee information associated with the invoice. The customer ID is automatically retrieved from the state.",
      schema: z.object({
        invoiceId: z.number().describe("The ID of the specific invoice"),
      }),
    }
  );

  return [
    getInvoicesByCustomerSortedByDate,
    getInvoicesSortedByUnitPrice,
    getEmployeeByInvoiceAndCustomer,
  ];
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
- get_invoices_by_customer_sorted_by_date: Retrieves all invoices for the current customer (no parameters needed - customer ID is automatically retrieved from state)
- get_invoices_sorted_by_unit_price: Retrieves all invoices for the current customer sorted by unit price (no parameters needed - customer ID is automatically retrieved from state)
- get_employee_by_invoice_and_customer: Retrieves employee information for a specific invoice (only requires invoiceId - customer ID is automatically retrieved from state)

IMPORTANT: The customer ID is automatically retrieved from the graph state, so you don't need to pass it as a parameter. The customer must be verified before these tools can be used.
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

console.log("💰 Creating Invoice Information Subagent...");

// Setup database
const db = await setupDatabase();

// Create tools
const invoiceTools = await createInvoiceTools(db);

// Create the agent with shared state schema
const agent = createAgent({
  model: defaultModel,
  tools: invoiceTools,
  systemPrompt: invoiceSubagentPrompt,
  stateSchema: AgentState,
});

console.log("✅ Invoice Information Subagent created successfully!");

// ============================================================================
// Export
// ============================================================================

export const graph = agent.graph;
