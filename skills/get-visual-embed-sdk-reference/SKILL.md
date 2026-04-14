---
description: Guidance for embedding ThoughtSpot content in web applications using the Visual Embed SDK
---

# ThoughtSpot Embedding

This skill provides guidance for working with the ThoughtSpot Visual Embed SDK.

## When to Use

Apply this skill whenever helping a user embed ThoughtSpot content — Liveboards, Search, Answers, Spotter, or the full app — in a web application.

## Tool Routing

Always retrieve documentation before answering. Use:

| Question type | Tool |
|---|---|
| SDK types, interfaces, enums | `get-visual-embed-sdk-reference` with `symbolName` |
| Embed configuration and options | `get-visual-embed-sdk-reference` |
| Authentication (AuthType, trusted auth, SSO) | `get-visual-embed-sdk-reference` |
| CSS theming and customization | `get-visual-embed-sdk-reference` |
| Events and callbacks | `get-visual-embed-sdk-reference` |
| Platform concepts (what is a Liveboard, etc.) | `get-developer-docs-reference` |

## Embed Types

ThoughtSpot supports several embed types via the SDK:

- `LiveboardEmbed` — Embed a full Liveboard
- `SearchEmbed` — Embed the Search experience
- `AppEmbed` — Embed the full ThoughtSpot app
- `SageEmbed` / `SpotterEmbed` — Embed the AI-powered Spotter experience
- `AnswerEmbed` — Embed a specific saved Answer
- `SearchBarEmbed` — Embed just the search bar

## Authentication

Always use `init()` before rendering any embed. Key auth types:

- `AuthType.None` — No auth (dev/testing only)
- `AuthType.EmbedSSO` — SAML/OIDC SSO passthrough
- `AuthType.TrustedAuthToken` — Server-side token-based auth (most common for production)
- `AuthType.TrustedAuthTokenCookieless` — Cookieless variant for stricter environments

## Query Tips

- Split multi-topic questions into separate tool calls for best results
- Use `symbolName` to look up a specific type (e.g., `symbolName: "CustomCssInterface"`)
- If `get-visual-embed-sdk-reference` returns insufficient results, fall back to `get-developer-docs-reference`
