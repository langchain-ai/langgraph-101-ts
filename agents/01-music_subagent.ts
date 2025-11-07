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

// Setup database
const db = await setupDatabase();

// Create tools
const musicTools = await createMusicTools(db);
const llmWithMusicTools = defaultModel.bindTools(musicTools);

// Create tool node
const musicToolNode = new ToolNode(musicTools);

// Create music assistant node
async function musicAssistant(state: AgentState) {
  const memory = state.loadedMemory ?? "None";

  // Instructions for our agent
  const musicAssistantPrompt = generateMusicAssistantPrompt(memory);

  // Invoke the model
  const response = await llmWithMusicTools.invoke([
    new SystemMessage(musicAssistantPrompt),
    ...state.messages,
  ]);

  // Update the state
  return { messages: [response] };
}

// ============================================================================
// Conditional Edge
// ============================================================================

function shouldContinue(state: AgentState): "continue" | "end" {
  const messages = state.messages;
  const lastMessage = messages.at(-1);

  // If there is no function call, then we finish
  if (
    AIMessage.isInstance(lastMessage) &&
    lastMessage.tool_calls &&
    lastMessage.tool_calls.length > 0
  ) {
    return "end";
  }
  // Otherwise if there is, we continue
  return "continue";
}

// ============================================================================
// Graph Creation
// ============================================================================

console.log("🎵 Creating Music Catalog Subagent...");

// Initialize memory stores
const checkpointer = new MemorySaver();
const inMemoryStore = new InMemoryStore();

// Create the workflow
const musicWorkflow = new StateGraph(AgentState)
  .addNode("music_assistant", musicAssistant)
  .addNode("music_tool_node", musicToolNode)
  .addEdge(START, "music_assistant")
  .addConditionalEdges("music_assistant", shouldContinue, {
    continue: "music_tool_node",
    end: END,
  })
  .addEdge("music_tool_node", "music_assistant");

// Compile the graph
export const graph = musicWorkflow.compile({
  checkpointer,
  store: inMemoryStore,
});

console.log("✅ Music Catalog Subagent created successfully!");
