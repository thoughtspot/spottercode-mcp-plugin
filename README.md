# ThoughtSpot MCP Plugin

Configuration for integrating the ThoughtSpot developer documentation MCP server with Claude Code and Cursor IDE. Enables semantic search over the Visual Embed SDK, REST API v2, and developer guides — all through natural language.

## Features

- **Get Visual Embed SDK Docs** — Types, interfaces, configuration, events, authentication, and CSS theming
- **Get REST API Docs** — Endpoint specs, request/response schemas, authentication, and Java/TypeScript SDK guides
- **Get Developer Docs** — Platform features, SSO/SAML, deployment, TML, and general ThoughtSpot guidance

## Prerequisites

Before integrating SpotterCode:

- Ensure your IDE is AI-native and supports chat sessions with AI models.
- Ensure you have the necessary permissions to configure MCP servers on your IDE.
- Ensure the latest version of Node.js is installed in your environment (required for building embedding code with the SDK).
- Ensure you have access to a ThoughtSpot instance and can view the objects and resources you want to embed or access via the REST API.

## Installation

### Claude Code

Clone the plugin and load it:

```bash
git clone https://github.com/thoughtspot/thoughtspot-mcp-plugin.git
cd thoughtspot-mcp-plugin
claude --plugin-dir ./
```

Or add it globally:

```bash
claude mcp add spottercode --transport http https://spottercode.thoughtspot.app/mcp
```

The Claude plugin uses the following MCP configuration (`.mcp.json`):

```json
{
  "mcpServers": {
    "spottercode": {
      "type": "http",
      "url": "https://spottercode.thoughtspot.app/mcp"
    }
  }
}
```

### Cursor

**Option 1 — One-click installation:**

Copy the link below and open it in Cursor:

```
cursor://anysphere.cursor-deeplink/mcp/install?name=SpotterCode&config=eyJ1cmwiOiJodHRwczovL3Nwb3R0ZXJjb2RlLnRob3VnaHRzcG90LmFwcC9tY3AifQ==
```

Cursor opens the MCP server installation page. Click **Install**.

**Option 2 — `mcp.json` file:**

Go to **Cursor Settings** → **Tools and MCP** and add:

```json
{
  "mcpServers": {
    "SpotterCode": {
      "url": "https://spottercode.thoughtspot.app/mcp"
    }
  }
}
```

Click **Save** and close the file. This installs the SpotterCode MCP server and tools for AI models in Cursor to execute.

### Visual Studio Code

> **Note:** You'll need GitHub Copilot or a similar extension to start chat sessions with the AI agent.

Add via the `MCP: Add Server` command (command palette) or edit the `mcp.json` file in your workspace configuration:

```json
{
  "servers": {
    "SpotterCode": {
      "url": "https://spottercode.thoughtspot.app/mcp",
      "type": "http"
    }
  }
}
```

After adding the MCP server URL, SpotterCode will be available in the Extensions view. See the [VS Code MCP documentation](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) for more details.

## Usage Examples

- **"How do I embed a Liveboard with trusted auth?"**
- **"What is the CustomCssInterface type?"**
- **"Show me the createUser endpoint spec"**
- **"How does SAML SSO work in ThoughtSpot?"**
- **"What embed events are available for LiveboardEmbed?"**

## Verifying the Integration

1. Open your application project in your IDE. If the integration is successful, SpotterCode will appear in the MCP servers list.
2. Check the available SpotterCode skills. In Cursor, go to **Tools & MCP** and verify the SpotterCode skills are listed. You can hover over each skill to view its description and input schema, and disable skills you don't want the AI model to use.
3. Initiate a chat session and ask a question related to ThoughtSpot embedding, REST APIs, or the SDKs. For example:
   > *"I want to embed a ThoughtSpot Liveboard in my React application. Use the available tools to get this information and generate the embed code."*
4. Verify that the AI agent discovers and uses SpotterCode skills to generate a response.
5. Review the response — the agent will identify the minimum configuration required (ThoughtSpot host URL, Liveboard ID, authentication attributes) to complete the embedding.

## Limitations

- Responses are scoped to features and parameters supported in the Visual Embed SDK, REST API, and official ThoughtSpot Developer documentation. SpotterCode cannot generate code for unsupported or undocumented features.
- Code samples cover the most common use cases. Highly specialized workflows may require manual coding beyond what SpotterCode provides.
- SpotterCode does not influence how the Spotter feature infers semantic modeling and is not intended for querying data models or interpreting metadata definitions.
- The behavior of the IDE agent, including tool selection and reasoning, is not controlled by SpotterCode.

## MCP Server

The MCP server is hosted at `https://spottercode.thoughtspot.app`. No local installation required.