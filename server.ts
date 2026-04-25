import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { AsyncLocalStorage } from "async_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const appUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : `http://localhost:${PORT}`;

// Initialize Firebase Admin SDK
if (process.env.FIREBASE_PROJECT_ID && admin.apps?.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

// Provide access to the HTTP request state inside MCP tool handlers
const requestContext = new AsyncLocalStorage<{ authHeader: string | undefined }>();

// Setup MCP Server
const mcpServer = new McpServer({ name: "freshfront-project-creator", version: "1.0.0" });

// Helper to check token and get Auth0 UserInfo
async function getAuth0User(token: string) {
  const authorizer = process.env.OAUTH_AUTHORIZER_URL || "https://your-auth-domain.auth0.com";
  const userinfoUrl = authorizer.endsWith('/') ? `${authorizer}userinfo` : `${authorizer}/userinfo`;
  
  const res = await fetch(userinfoUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new Error(`Auth0 /userinfo failed: ${res.statusText}`);
  }
  return await res.json();
}

const draftToolOptions = {
    title: "Draft New FreshFront Project",
    description: "Prepare to create a new project in the user's FreshFront database by generating a structured project using Gemini AI. Pass the current chat context, user intent, or project idea into the context parameter.",
    inputSchema: {
      context: z.string().describe("A summary of the chat context or the user's idea for the project."),
    },
    _meta: { ui: {} },
    // @ts-ignore - The ext-apps SDK does not yet strictly type the securitySchemes array, but the protocol passes it through
    securitySchemes: [
      { type: "oauth2", scopes: ["project.write"] }
    ],
  };

registerAppTool(
  mcpServer,
  "draft_new_project",
  draftToolOptions,
  async (args) => {
    // -------------------------------------------------------------
    // MCP OAuth 2.1 Enforcement
    // -------------------------------------------------------------
    const contextStore = requestContext.getStore();
    const token = contextStore?.authHeader?.replace(/^Bearer\s/i, "");
    
    // Check token logic here. You must verify validity with your Auth System (Auth0/etc).
    // This is a stub showing the exact response shape required by the ChatGPT MCP SDK.
    if (!token && process.env.REQUIRE_OAUTH === "true") {
      return {
        isError: true,
        content: [{ type: "text", text: "Authentication required: no access token provided." }],
        _meta: {
          "mcp/www_authenticate": [
            `Bearer resource_metadata="${appUrl}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="You need to login to continue"`
          ]
        }
      };
    }
    // -------------------------------------------------------------

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    let generated;
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Based on the following context/idea, generate a structured project plan for a research application named FreshFront:\n\n${args.context}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "A concise name for the project" },
              description: { type: "STRING", description: "A short description of what this project aims to research" },
              agentName: { type: "STRING", description: "The name of the AI agent for this project (e.g. 'Research Analyst', 'Market Strategist')" },
              agentApproach: { type: "STRING", description: "The agent's approach (e.g. 'Methodical research with thorough analysis')" },
              agentExpertise: { type: "STRING", description: "The agent's expertise (e.g. 'Deep investigation and knowledge synthesis')" },
              suggestedTopics: { type: "ARRAY", items: { type: "STRING" }, description: "5 distinct suggested initial research topics or queries" },
              seoSeedKeywords: { type: "ARRAY", items: { type: "STRING" }, description: "5 relevant SEO seed keywords" }
            },
            required: ["name", "description", "agentName", "agentApproach", "agentExpertise", "suggestedTopics", "seoSeedKeywords"]
          }
        }
      });
      generated = JSON.parse(response.text || "{}");
    } catch (e) {
      console.error("Gemini AI failed to generate structured payload:", e);
      generated = {};
    }

    // Generate draft payload to pass to the widget
    const payload = {
      name: generated.name || "Untitled Project",
      description: generated.description || "",
      agent: {
        approach: generated.agentApproach || "Methodical research with thorough analysis and evidence-based recommendations",
        expertise: generated.agentExpertise || "Deep investigation, source evaluation, and knowledge synthesis",
        name: generated.agentName || "Research Analyst"
      },
      suggestedTopics: generated.suggestedTopics || ["Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5"],
      seoSeedKeywords: generated.seoSeedKeywords || ["research"],
      aiInsights: [],
      collaborators: [],
      draftResearchSessions: [],
      emailTemplates: [],
      knowledgeBase: [],
      newsArticles: [],
      newsLastFetchedAt: Date.now(),
      notes: [],
      pinnedAssetIds: [],
      projectConversations: [],
      researchSessions: [],
      stripeProducts: [],
      tasks: [],
      worlds: [],
      youtubeVideos: [],
      youtubeLastFetchedAt: Date.now()
    };
    
    return {
      content: [{ type: "text", text: "Draft project prepared using Gemini AI. Please review the details below. We can modify or save it right here in the chat." }],
      structuredContent: { projectDraft: payload },
    };
  }
);

const createToolOptions = {
    title: "Create Project",
    description: "Accepts a finalised project draft and saves it directly to the user's FreshFront database securely using Firebase.",
    inputSchema: {
      projectDraft: z.any().describe("The compiled project draft object to save."),
    },
    _meta: { ui: {} },
    // @ts-ignore
    securitySchemes: [
      { type: "oauth2", scopes: ["project.write"] }
    ],
  };

registerAppTool(
  mcpServer,
  "create_project",
  createToolOptions,
  async (args) => {
    const contextStore = requestContext.getStore();
    const token = contextStore?.authHeader?.replace(/^Bearer\s/i, "");
    
    if (!token && process.env.REQUIRE_OAUTH === "true") {
      return {
        isError: true,
        content: [{ type: "text", text: "Authentication required to save the project." }],
        _meta: {
          "mcp/www_authenticate": [
            `Bearer resource_metadata="${appUrl}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="You need to login to continue"`
          ]
        }
      };
    }

    try {
      // 1. Get User Info from Auth0 Token
      const userInfo = await getAuth0User(token || "");
      const userEmail = userInfo.email;
      
      if (!userEmail) {
         return {
           isError: true,
           content: [{ type: "text", text: "Failed to find an email address associated with your Auth0 account." }]
         };
      }

      const projectData = {
        ...args.projectDraft,
        ownerEmail: userEmail,
        createdAt: new Date().toISOString()
      };

      if (admin.apps?.length === 0) {
         return {
           content: [{ type: "text", text: `Firebase is not configured, but the project would have been saved for ${userEmail}. Project payload: ${JSON.stringify(projectData, null, 2)}` }]
         };
      }

      // 2. Save to Firestore under projects collection
      const db = admin.firestore();
      const docRef = await db.collection("projects").add({
        ...projectData,
        createdAt: admin.firestore.FieldValue.serverTimestamp() // override with actual server timestamp
      });

      return {
        content: [{ type: "text", text: `Success! The project "${args.projectDraft.name}" has been created and saved to your FreshFront account. You can now log into freshfront.co to view it.` }],
        structuredContent: { 
          status: "success", 
          projectId: docRef.id,
          project: projectData
        }
      };
    } catch (e) {
      console.error("Failed to create project:", e);
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to save project: ${e instanceof Error ? e.message : 'Unknown error'}` }]
      };
    }
  }
);

async function startServer() {
  const app = express();

  // -------------------------------------------------------------
  // OpenAI Domain Verification Endpoint
  // -------------------------------------------------------------
  app.get("/.well-known/openai-apps-challenge", (req, res) => {
    // Return the token exactly as provided by ChatGPT
    // You can set it in the OPENAI_APPS_CHALLENGE process env variable or hardcode it
    res.type('text/plain');
    res.send(process.env.OPENAI_APPS_CHALLENGE || "REPLACE_WITH_YOUR_VERIFICATION_TOKEN");
  });

  // -------------------------------------------------------------
  // MCP OAuth 2.1 Discovery Endpoints
  // -------------------------------------------------------------
  app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/*"], (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    const authorizer = process.env.OAUTH_AUTHORIZER_URL || "https://your-auth-domain.auth0.com";
    res.json({
      resource: process.env.OAUTH_RESOURCE || "urn:example:resource",
      authorization_servers: [authorizer],
      scopes_supported: ["project.write", "openid", "email", "profile"],
      resource_documentation: "https://freshfront.dev/docs",
      // These help with discovery of capabilities
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      introspection_endpoint: `${authorizer}/introspect`,
      registration_endpoint: `${authorizer}/oidc/register`
    });
  });

  // Handle MCP Requests
  const MCP_PATH = "/mcp";
  app.options(MCP_PATH, (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.header("Access-Control-Allow-Headers", "content-type, mcp-session-id");
    res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
    res.send();
  });

  app.all(MCP_PATH, async (req, res, next) => {
    if (['POST', 'GET', 'DELETE'].includes(req.method)) {
      requestContext.run({ authHeader: req.headers.authorization }, async () => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless mode
          enableJsonResponse: true,
        });

        res.on("close", () => {
          transport.close();
        });

        try {
          // If the token is missing and we explicitly want to trigger 401 right here at the transport boundary
          // you can return 401, but returning the WWW-Authenticate header dynamically via MCP tool error 
          // triggers the chat-level OAuth linking UI cleanly.
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res);
        } catch (error) {
          console.error("Error handling MCP request:", error);
          if (!res.headersSent) {
            res.status(500).send("Internal server error");
          }
        }
      });
    } else {
      next();
    }
  });

  // Vite + React app middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
