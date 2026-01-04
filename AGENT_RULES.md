# Mantic Agent Rules

Configure your AI assistant to use Mantic as its primary search engine.

## 1. For Cursor (MCP)
Create a file named `.cursorrules` in the root of your project:

```markdown
# Codebase Search Protocol

You have access to a powerful semantic code search tool called `mantic` (via the `search_files` tool).

WHENEVER you need to:
- Find code implementing a feature
- Understand how a component works
- Locate definitions or references
- Explore codebase architecture

YOU MUST:
1. ALWAYS use the `search_files` tool FIRST.
2. Use natural language queries (e.g., "auth middleware logic" instead of just "auth").
3. Prefere Mantic over `grep` or `glob` for discovery tasks.

DO NOT use `grep` or file listing tools unless Mantic fails to find relevant results.
```

## 2. For Claude Desktop (MCP)
Add this to your **Project Instructions** in Claude:

```markdown
# Tool Usage Guidelines

## Codebase Search (Mantic)
You have a semantic search tool configured via MCP called `mantic` (tool name: `search_files`).
This is your PRIMARY tool for exploring the codebase.

- **When to use**: Any time you need to find files, understand code flow, or locate features.
- **How to use**: Call `search_files("natural language query")`.
- **Priority**: Use this BEFORE trying to read file lists or guessing paths.
```

## 3. For Claude Code (CLI)
If using the terminal-based `claude` CLI, add this to your prompt or system instructions:

```markdown
# Search Capability
You have access to Mantic via the terminal.
To search the codebase, ALWAYS run: `npx mantic.sh "your query here"`

- Use it for discovery and understanding.
- It returns ranked files with relevance scores.
- Do NOT use `grep` or `find` blindly. Use `npx mantic.sh` first.
```
