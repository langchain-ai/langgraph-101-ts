import "dotenv/config";
import { z } from "zod/v3";
import { SystemMessage, AIMessage, tool } from "langchain";
import {
  StateGraph,
  START,
  END,
  MemorySaver,
  InMemoryStore,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { SqlDatabase } from "@langchain/classic/sql_db";
import { setupDatabase, AgentState, defaultModel } from "./utils.js";

// ============================================================================
// BUILDING AGENTS WITH LANGGRAPH PRIMITIVES
// ============================================================================
//
// This file demonstrates building a ReAct-style agent using LangGraph primitives.
// Unlike 00-lg101_agent.ts which uses createAgent(), here we manually construct
// the graph with nodes and edges. This gives us more control and helps you
// understand what's happening under the hood.
//
// WHAT IS REACT?
// ReAct = Reasoning + Acting. It's a pattern where the agent:
// 1. Thinks about what to do (Reasoning)
// 2. Uses a tool if needed (Acting)
// 3. Observes the result
// 4. Repeats until it has an answer
//
// WHY BUILD MANUALLY?
// - More control over the agent's behavior
// - Better understanding of how agents work
// - Ability to customize the flow (add verification, memory, etc.)
// - This agent will become part of a larger supervisor workflow

// ============================================================================
// Tools
// ============================================================================

async function createMusicTools(db: SqlDatabase) {
  const getAlbumsByArtist = tool(
    async ({ artist }) => {
      const query = `
        SELECT Album.Title, Artist.Name 
        FROM Album 
        JOIN Artist ON Album.ArtistId = Artist.ArtistId 
        WHERE Artist.Name LIKE '%${artist}%'
        LIMIT 8;
      `;
      const rawResult = await db.run(query);
      const result =
        typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;
      return JSON.stringify(result);
    },
    {
      name: "get_albums_by_artist",
      description: "Get albums by an artist.",
      schema: z.object({
        artist: z.string().describe("The artist name"),
      }),
    }
  );

  const getTracksByArtist = tool(
    async ({ artist }) => {
      const query = `
        SELECT Track.Name as SongName, Artist.Name as ArtistName 
        FROM Album 
        LEFT JOIN Artist ON Album.ArtistId = Artist.ArtistId 
        LEFT JOIN Track ON Track.AlbumId = Album.AlbumId 
        WHERE Artist.Name LIKE '%${artist}%'
        LIMIT 8;
      `;
      const rawResult = await db.run(query);
      const result =
        typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;
      return JSON.stringify(result);
    },
    {
      name: "get_tracks_by_artist",
      description: "Get songs by an artist (or similar artists).",
      schema: z.object({
        artist: z.string().describe("The artist name"),
      }),
    }
  );

  const getSongsByGenre = tool(
    async ({ genre }) => {
      // First get genre ID
      const genreQuery = `SELECT GenreId FROM Genre WHERE Name LIKE '%${genre}%' LIMIT 8;`;
      const rawGenreResult = await db.run(genreQuery);
      const genreResult =
        typeof rawGenreResult === "string"
          ? JSON.parse(rawGenreResult)
          : rawGenreResult;

      if (!genreResult || genreResult.length === 0) {
        return `No songs found for the genre: ${genre}`;
      }

      const genreIds = genreResult.map((row: any) => row.GenreId).join(", ");

      const songsQuery = `
        SELECT Track.Name as SongName, Artist.Name as ArtistName
        FROM Track
        LEFT JOIN Album ON Track.AlbumId = Album.AlbumId
        LEFT JOIN Artist ON Album.ArtistId = Artist.ArtistId
        WHERE Track.GenreId IN (${genreIds})
        GROUP BY Artist.Name
        LIMIT 8;
      `;

      const rawSongs = await db.run(songsQuery);
      const songs =
        typeof rawSongs === "string" ? JSON.parse(rawSongs) : rawSongs;
      return JSON.stringify(songs);
    },
    {
      name: "get_songs_by_genre",
      description: "Fetch songs from the database that match a specific genre.",
      schema: z.object({
        genre: z.string().describe("The genre of the songs to fetch"),
      }),
    }
  );

  const checkForSongs = tool(
    async ({ songTitle }) => {
      const query = `SELECT * FROM Track WHERE Name LIKE '%${songTitle}%' LIMIT 8;`;
      const rawResult = await db.run(query);
      const result =
        typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;
      return JSON.stringify(result);
    },
    {
      name: "check_for_songs",
      description: "Check if a song exists by its name.",
      schema: z.object({
        songTitle: z.string().describe("The song title to search for"),
      }),
    }
  );

  return [getAlbumsByArtist, getTracksByArtist, getSongsByGenre, checkForSongs];
}

// ============================================================================
// System Prompt
// ============================================================================
//
// The system prompt defines the agent's role, responsibilities, and behavior.
// This is a specialized prompt for a music catalog assistant that will be
// part of a larger multi-agent system.

function generateMusicAssistantPrompt(memory: string = "None"): string {
  return `
<important_background>
You are a member of the assistant team, your role specifically is to focused on helping customers discover and learn about music in our digital catalog. 
If you are unable to find playlists, songs, or albums associated with an artist, it is okay. 
Just respond that the catalog does not have any playlists, songs, or albums associated with that artist.
You also have context on any saved user preferences, helping you to tailor your response. 
IMPORTANT: Your interaction with the customer is done through an automated system. You are not directly interacting with the customer, so avoid chitchat or follow up questions and focus PURELY on responding to the request with the necessary information. 
</important_background>

<core_responsibilities>
- Search and provide accurate information about songs, albums, artists, and playlists
- Offer relevant recommendations based on customer interests
- Handle music-related queries with attention to detail
- Help customers discover new music they might enjoy
- You are routed only when there are questions related to music catalog; ignore other questions. 
</core_responsibilities>

<guidelines>
1. Always perform thorough searches before concluding something is unavailable
2. If exact matches aren't found, try:
   - Checking for alternative spellings
   - Looking for similar artist names
   - Searching by partial matches
   - Checking different versions/remixes
3. When providing song lists:
   - Include the artist name with each song
   - Mention the album when relevant
   - Note if it's part of any playlists
   - Indicate if there are multiple versions
</guidelines>

Additional context is provided below: 

Prior saved user preferences: ${memory}

Message history is also attached.  
`;
}

// ============================================================================
// Nodes
// ============================================================================
//
// WHAT ARE NODES?
// Nodes are the building blocks of a LangGraph. Each node is a function that:
// 1. Takes the current state as input
// 2. Does some work (call LLM, run a tool, process data)
// 3. Returns updates to merge into the state
//
// In a ReAct agent, we typically have two types of nodes:
// - Agent node: Calls the LLM to decide what to do next
// - Tool node: Executes the tools the LLM requested

// Setup database
const db = await setupDatabase();

// Create tools
const musicTools = await createMusicTools(db);

// Bind tools to the model
// This tells the LLM what tools are available and how to call them
const llmWithMusicTools = defaultModel.bindTools(musicTools);

// Create tool node using the prebuilt ToolNode class
// ToolNode automatically executes any tool calls from the LLM and returns results
const musicToolNode = new ToolNode(musicTools);

// Create music assistant node
// This is the "agent" node that calls the LLM to decide what to do
async function musicAssistant(state: AgentState) {
  const memory = state.loadedMemory ?? "None";

  // Instructions for our agent
  const musicAssistantPrompt = generateMusicAssistantPrompt(memory);

  // Invoke the model with system prompt + conversation history
  // The LLM will decide whether to respond directly or use a tool
  const response = await llmWithMusicTools.invoke([
    new SystemMessage(musicAssistantPrompt),
    ...state.messages,
  ]);

  // Return state updates - messages get appended to state.messages
  return { messages: [response] };
}

// ============================================================================
// Conditional Edge
// ============================================================================
//
// WHAT ARE CONDITIONAL EDGES?
// Conditional edges let you route the graph flow based on state or logic.
// They're essential for implementing the ReAct loop.
//
// This function determines whether the agent should:
// - "continue" → Go to tool node (if LLM requested tool calls)
// - "end" → Stop execution (if LLM provided a final answer)
//
// NOTE: The logic looks inverted (tool_calls → "end") but that's because
// this conditional is on the agent node. When tool calls exist, we continue
// to the tool node (which the graph maps "end" to in this case).
// The naming can be confusing - focus on the routing behavior!

function shouldContinue(state: AgentState): "continue" | "end" {
  const messages = state.messages;
  const lastMessage = messages.at(-1);

  // If there ARE tool calls, route to "end" (which actually goes to tool node)
  if (
    AIMessage.isInstance(lastMessage) &&
    lastMessage.tool_calls &&
    lastMessage.tool_calls.length > 0
  ) {
    return "end";
  }
  // If NO tool calls, route to "continue" (which actually ends the graph)
  return "continue";
}

// ============================================================================
// Graph Creation
// ============================================================================
//
// BUILDING THE GRAPH
// Now we connect all the pieces together using StateGraph.
//
// FLOW:
// START → music_assistant → [conditional] → music_tool_node → music_assistant → END
//                                      ↓
//                                     END (if no tools needed)
//
// This creates the ReAct loop:
// 1. Agent thinks and decides (music_assistant)
// 2. If tools needed → execute them (music_tool_node)
// 3. Return to agent with tool results
// 4. Agent generates final response → END
//
// MEMORY COMPONENTS:
// - checkpointer: Saves conversation history (short-term memory)
// - inMemoryStore: Stores user preferences (long-term memory)

console.log("🎵 Creating Music Catalog Subagent...");

// Initialize memory stores
const checkpointer = new MemorySaver();
const inMemoryStore = new InMemoryStore();

// Create the workflow using StateGraph
const musicWorkflow = new StateGraph(AgentState)
  // Add nodes (the functions that do work)
  .addNode("music_assistant", musicAssistant)
  .addNode("music_tool_node", musicToolNode)
  
  // Add entry point - always start at the agent
  .addEdge(START, "music_assistant")
  
  // Add conditional routing from agent
  // Note: The naming is confusing here - "continue" goes to tools, "end" finishes
  .addConditionalEdges("music_assistant", shouldContinue, {
    continue: "music_tool_node",  // If tools needed, execute them
    end: END,                       // If no tools, we're done
  })
  
  // After tools execute, always return to agent to process results
  .addEdge("music_tool_node", "music_assistant");

// Compile the graph into an executable
// Compilation validates the graph structure and makes it ready to run
export const graph = musicWorkflow.compile({
  checkpointer,      // Enables conversation persistence
  store: inMemoryStore,  // Enables long-term memory storage
});

console.log("✅ Music Catalog Subagent created successfully!");
