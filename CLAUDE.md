# SpotterCode Plugin

This plugin integrates ThoughtSpot developer documentation with Claude Code, giving you semantic search over the Visual Embed SDK, REST API v2, and developer guides — plus guided procedures for platform migrations.

## Skills

### Documentation lookup

- **get-visual-embed-sdk-reference** — Guidance for embedding ThoughtSpot content in web applications
- **get-rest-api-reference** — Guidance for working with the ThoughtSpot REST API v2
- **get-developer-docs-reference** — Guidance for searching general ThoughtSpot developer documentation

### Guided procedures

- **migrate-tml-copies-to-publishing** — Replace a Model copy made by TML export/import in a secondary Org with the governed Model published into that Org, carrying the copy's sharing and repointing its Answers (v0: one Org, identical columns, Answers only)

Procedure skills write to your instance. Every write step needs a confirmation, backs up what it changes, and deletes the replaced copy only after verification.
