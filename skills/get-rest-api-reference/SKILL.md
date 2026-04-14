---
description: Guidance for working with the ThoughtSpot REST API v2
---

# ThoughtSpot REST API v2

This skill provides guidance for working with the ThoughtSpot REST API.

## When to Use

Apply this skill whenever helping a user call ThoughtSpot REST API endpoints — creating users, exporting Liveboards, managing orgs, fetching metadata, or any other programmatic operation.

## Tool Routing

Always retrieve documentation before answering. Use:

| Question type | Tool |
|---|---|
| Known endpoint (e.g., "createUser") | `get-rest-api-reference` with `apiName` |
| Searching for the right endpoint | `get-rest-api-reference` with `query` |
| Java or TypeScript SDK setup | `get-rest-api-reference` with `additionalDocs: "java"` or `"typescript"` |
| Auth concepts (SAML, OIDC, RBAC) | `get-developer-docs-reference` |

## API Basics

- Base URL: `https://<your-instance>/api/rest/2.0`
- Auth: Bearer token via `/auth/token/full` or `/auth/token/object`
- All requests use JSON body and return JSON
- SDK available for Java and TypeScript — use `additionalDocs` parameter to get setup guides

## Common Operations

| Operation | Endpoint area |
|---|---|
| User management | `createUser`, `updateUser`, `deleteUser` |
| Group management | `createGroup`, `updateGroup` |
| Liveboard export | `exportLiveboardReport` |
| Metadata search | `searchMetadata` |
| Data queries | `searchQueryData` |
| Org management | `createOrg`, `updateOrg` |

## Query Tips

- Use `apiName` for exact endpoint lookups — it returns the full spec including all parameters
- Call `additionalDocs` once per session, not on every call — it returns the same SDK setup guide each time
- If an endpoint isn't found, try a semantic `query` instead of the exact name
- Fall back to `get-developer-docs-reference` for auth concepts and platform-level questions
