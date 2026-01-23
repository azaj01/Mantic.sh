# Mantic Agent Rules (v1.0.25)

Configure your AI assistant to use Mantic as its primary search engine with advanced features.

## 1. For Cursor (MCP)
Create a file named `.cursorrules` in the root of your project:

```markdown
# Codebase Search Protocol (Mantic v1.0.25)

You have access to `mantic`, a semantic code search engine with Hybrid Intelligence.

## Tools Available
- `search_files`: Primary search. Use `semantic: true` for concept searches.
- `get_definition`: Go to definition of a symbol (Class, Function, Interface).
- `find_references`: Find all usages of a symbol.
- `get_context`: Proactive zero-query context detection.
- `session_start/end`: Manage context for multi-step tasks.

## Search Strategy

### 1. Initial Context
At the start of ANY task, run `get_context()` to see modified files and suggestions.

### 2. Finding Features (Heuristic vs Semantic)
- **Heuristic (Default)**: Use for precise terms.
  - `search_files({ query: "auth middleware" })`
- **Semantic (Concept)**: Use when you don't know the exact terms.
  - `search_files({ query: "how is user identity verified", semantic: true })`

### 3. Code Navigation (Deep Intel)
- **Definition**: `get_definition({ symbol: "AuthService" })`
- **Usages**: `find_references({ symbol: "loginUser" })`

## Session Workflow
1. `get_context()`
2. `session_start({ name: "refactor-auth" })`
3. `search_files({ query: "...", sessionId: "..." })`
4. `session_record_view({ sessionId, files: [...] })`
5. `session_end({ sessionId })` (when done)
```

## 2. For Claude Desktop (MCP)
Add this to your **Project Instructions** in Claude:

```markdown
# Tool Usage Guidelines (Mantic v1.0.25)

## Capabilities
You have access to Mantic, capable of:
1. **Hybrid Search**: Keyword + Neural (`semantic: true`).
2. **Code Intelligence**: Tree-setter based navigation.

## When to Use Which Tool
- **Unknown Codebase**: Start with `get_context()`.
- **Feature Search**: Use `search_files`. If standard search fails, retry with `semantic: true`.
- **Reading Code**: Use `get_definition` to jump to definitions instead of guessing paths.
- **Refactoring**: Use `find_references` to ensure you catch all usages.

## Progressive Disclosure
Mantic returns file metadata (tokens, confidence). Use this to decide what to read.
ALWAYS prioritize high-confidence files.
```

## 3. For Claude Code (CLI)
If using the terminal-based `claude` CLI, add this to your prompt:

```markdown
# Search Capability (Mantic v1.0.25)

You have access to Mantic via the terminal.

## commands

**1. Semantic Search (Concept matching):**
`npx mantic.sh "verify user identity" --semantic`

**2. Standard Search (Fast):**
`npx mantic.sh "script controller" --code`

**3. Code Intelligence:**
- Go to Definition: `npx mantic.sh goto "AppController"`
- Find References: `npx mantic.sh references "handleClick"`

**4. Zero-Query (Context):**
`npx mantic.sh ""`

## Best Practices
- Use **Semantic Search** for "how to", "logic for", or broad concepts.
- Use **Standard Search** for exact filenames or known terms.
- Use **Code Intel** for precise navigation, avoid `grep` for code symbols.
- Use **Impact Analysis** (`--impact`) before making changes.

## 4. Best Practices Summary for Agents

### Query Patterns
- **Concept**: "how does stripe payment flow work" -> **Use `--semantic`**
- **Specific**: "StripeService.ts" -> **Use Standard**
- **Debugging**: "NullReference in Auth" -> **Use `--semantic` to find root cause**

### Navigation
- Stop guessing file paths.
- Use `get_definition` to find where classes/functions are defined.
- Use `find_references` to check blast radius.

### Context
- Always start with `get_context` (or `mantic ""` in CLI) to align with the user's active work.
```
