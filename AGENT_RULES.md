# Mantic Agent Rules (v1.0.21)

Configure your AI assistant to use Mantic as its primary search engine with advanced features.

## 1. For Cursor (MCP)
Create a file named `.cursorrules` in the root of your project:

```markdown
# Codebase Search Protocol (Mantic v1.0.21)

You have access to a powerful semantic code search tool called `mantic` with the following MCP tools:
- `search_files` - Primary search with context carryover support
- `get_context` - Zero-query mode for proactive context detection
- `session_start`, `session_end`, `session_record_view` - Session management for context continuity

## Search Strategy

WHENEVER you need to:
- Find code implementing a feature
- Understand how a component works
- Locate definitions or references
- Explore codebase architecture
- Start working on a task

YOU MUST:
1. Use `get_context()` at the START of work to understand current context
2. ALWAYS use `search_files` tool FIRST before grep/glob
3. Use natural language queries (e.g., "auth middleware logic" not just "auth")
4. Start sessions for multi-step tasks to enable context carryover
5. Record viewed files with `session_record_view` to boost them in future searches

## Session Workflow (Recommended)

1. get_context() → See modified files and suggestions
2. session_start({ name: "task-name" }) → Get sessionId
3. search_files({ query: "...", sessionId: "..." }) → Context-aware search
4. session_record_view({ sessionId, files: [...] }) → Record what you viewed
5. search_files({ query: "related query", sessionId: "..." }) → Viewed files boosted
6. session_end({ sessionId }) → Clean up when done

## Progressive Disclosure

Search results include:
- File size, line count, estimated tokens
- Confidence scores (0-1)
- Last modified timestamps
- Impact analysis (with includeImpact: true)

Use this metadata to decide which files to read first.

DO NOT use `grep` or file listing tools unless Mantic fails to find relevant results.
```

## 2. For Claude Desktop (MCP)
Add this to your **Project Instructions** in Claude:

```markdown
# Tool Usage Guidelines (Mantic v1.0.21)

## Codebase Search (Mantic)
You have a semantic search tool configured via MCP with advanced context awareness.

### Available Tools
- `search_files` - Primary search (supports sessionId for context carryover)
- `get_context` - Zero-query mode (shows current working context)
- `session_start/end` - Manage coding sessions
- `session_record_view` - Track viewed files for context boost
- `analyze_intent` - Understand query intent

### When to Use

**Start of Work:**
1. Call `get_context()` to see modified files and suggestions
2. Start a session if working on multi-step task

**During Work:**
1. Use `search_files` with sessionId for context-aware search
2. Record viewed files with `session_record_view`
3. Previously viewed files get +150 score boost in subsequent searches

**Key Features:**
- Progressive disclosure: Results include file size, tokens, confidence
- Impact analysis: Use includeImpact for blast radius
- Context carryover: Sessions remember what you've seen

### Priority
Use Mantic BEFORE reading file lists or guessing paths. Let it guide your exploration.
```

## 3. For Claude Code (CLI)
If using the terminal-based `claude` CLI, add this to your prompt or system instructions:

```markdown
# Search Capability (Mantic v1.0.21)

You have access to Mantic via the terminal with enhanced features.

## Basic Search
npx mantic.sh "your query here"

## Advanced Features

**Zero-Query Mode (Context Detection):**
npx mantic.sh ""  # Shows modified files, suggestions, impact

**Context Carryover (Session Mode):**
npx mantic.sh "query" --session "session-name"

**Output Formats:**
npx mantic.sh "query" --json        # Full metadata
npx mantic.sh "query" --files       # Paths only
npx mantic.sh "query" --markdown    # Pretty output

**Impact Analysis:**
npx mantic.sh "query" --impact  # Shows blast radius

**File Type Filters:**
npx mantic.sh "query" --code     # Code files only
npx mantic.sh "query" --test     # Test files only
npx mantic.sh "query" --config   # Config files only

### Search Quality (v1.0.21)
- CamelCase detection: "ScriptController" finds script_controller.h
- Exact filename matching: "download_manager.cc" returns exact file first
- Path sequence: "blink renderer core dom" matches directory structure
- Word boundaries: "script" won't match "javascript"
- Directory boosting: "gpu" prioritizes files in gpu/ directories

### Do NOT use grep/find blindly. Use Mantic first.
```

## 4. Best Practices

### Query Patterns That Work Best

**Good Queries:**
- "authentication middleware logic"
- "stripe payment processing"
- "user profile component"
- "database migration files"
- "api rate limiting"

**Exact Match Queries:**
- "BookingPage.tsx" (exact filename)
- "EventType" (CamelCase component)
- "download_manager.cc" (exact file)

**Path Queries:**
- "apps web components booking" (directory structure)
- "blink renderer core dom" (path sequence)
- "tensorflow core framework" (package path)

**Avoid:**
- Single generic words ("user", "data")
- Just file extensions (".ts")
- Overly broad queries without context

### Context Carryover Strategy

1. Start sessions for tasks lasting 3+ queries
2. Record ALL files you read/modify
3. Use same sessionId across related searches
4. Previously viewed files get automatic +150 boost
5. End sessions when switching tasks

### Progressive Disclosure Usage

Use metadata to prioritize:
- Read high-confidence files first (confidence > 0.8)
- Skip large files if possible (check lines/tokens)
- Check timestamps to understand recency
- Use impact analysis before modifying files
