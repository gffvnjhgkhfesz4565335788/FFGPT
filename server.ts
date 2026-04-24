import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const appUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : `http://localhost:${PORT}`;

// Setup MCP Server
const mcpServer = new McpServer({ name: "freshfront-project-creator", version: "1.0.0" });

// Relay iframe HTML (this is the widget delivered to ChatGPT)
const widgetHtml = `<!DOCTYPE html>
<html>
<head>
  <style>body,html,iframe{margin:0;padding:0;width:100%;height:100vh;border:none;overflow:hidden;}</style>
</head>
<body>
  <iframe id="inner" src="${appUrl}/?widget=project" allow="clipboard-read; clipboard-write; popup"></iframe>
  <script>
    const inner = document.getElementById('inner');
    
    // Sometimes the iframe isn't loaded right away.
    // We queue messages from ChatGPT to send them when inner confirms it's ready.
    let isInnerReady = false;
    let queuedMessages = [];

    window.addEventListener('message', (e) => {
      if (e.source === inner.contentWindow) {
        if (e.data === 'inner-ready') {
          isInnerReady = true;
          queuedMessages.forEach(msg => {
            inner.contentWindow.postMessage(msg, '*');
          });
          queuedMessages = [];
        } else {
          window.parent.postMessage(e.data, '*');
        }
      } else if (e.source === window.parent) {
        if (isInnerReady && inner.contentWindow) {
          inner.contentWindow.postMessage(e.data, '*');
        } else {
          queuedMessages.push(e.data);
        }
      }
    });
  </script>
</body>
</html>`;

registerAppResource(
  mcpServer,
  "project-widget",
  "ui://widget/project.html",
  {},
  async () => ({
    contents: [
      {
        uri: "ui://widget/project.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
      },
    ],
  })
);

registerAppTool(
  mcpServer,
  "draft_new_project",
  {
    title: "Draft New FreshFront Project",
    description: "Prepare to create a new project in the user's FreshFront database by generating a structured project using Gemini AI. Pass the current chat context, user intent, or project idea into the context parameter.",
    inputSchema: {
      context: z.string().describe("A summary of the chat context or the user's idea for the project."),
    },
    _meta: {
      ui: { resourceUri: "ui://widget/project.html" },
    },
  },
  async (args) => {
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
      content: [{ type: "text", text: "Draft project prepared using Gemini AI. Please review and save it in the widget UI." }],
      structuredContent: { projectDraft: payload },
    };
  }
);

async function startServer() {
  const app = express();

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
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.status(500).send("Internal server error");
        }
      }
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
