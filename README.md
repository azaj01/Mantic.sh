# Mantic.sh

[![npm version](https://img.shields.io/npm/v/mantic.sh.svg?style=flat-square&color=CB3837)](https://www.npmjs.com/package/mantic.sh)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install-000000?style=flat-square&logo=cursor&logoColor=white)](https://cursor.com/en/install-mcp?name=mantic&config=eyJ0eXBlIjogInN0ZGlvIiwgImNvbW1hbmQiOiAibnB4IiwgImFyZ3MiOiBbIi15IiwgIm1hbnRpYy5zaEBsYXRlc3QiLCAic2VydmVyIl19)
[![Install in VS Code](https://img.shields.io/badge/VS%20Code-Install-007ACC?style=flat-square&logo=visual-studio-code&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=mantic&config=%7B%22type%22%3A%20%22stdio%22%2C%20%22command%22%3A%20%22npx%22%2C%20%22args%22%3A%20%5B%22-y%22%2C%20%22mantic.sh%40latest%22%2C%20%22server%22%5D%7D)
[![Agent Rules](https://img.shields.io/badge/Agent%20Rules-Copy%20Config-8A2BE2?style=flat-square&logo=robot&logoColor=white)](https://github.com/marcoaapfortes/Mantic.sh/blob/main/AGENT_RULES.md)
[![Claude Desktop](https://img.shields.io/badge/Claude%20Desktop-Setup%20Guide-D94F30?style=flat-square&logo=anthropic&logoColor=white)](#mcp-server-installation)


## Summary

Mantic is a **context-aware code search engine** that prioritizes **relevance over raw speed**. After testing across 5 repositories (cal.com, next.js, tensorflow, supabase, chromium), it demonstrates **superior result quality** compared to grep/ripgrep, despite some trade-offs in speed for very large codebases.

**Overall Assessment**: 4/5 - Excellent for AI agents, good for developers, needs speed optimization for 100K+ file repos.

## What's New in v1.0.25 🚀

**Enterprise-Grade Context Infrastructure**

- **Semantic Reranking (Hybrid Intelligence)**: Combines heuristic speed with neural understanding. Uses local embeddings (`transformers.js`) to find "conceptually relevant" code even without exact keyword matches.
  - Usage: `mantic "verify user" --semantic`
- **Code Intelligence**: Deep understanding of your codebase structure using Tree-sitter.
  - **Go to Definition**: `mantic goto UserService` returns the exact line number across your entire monorepo.
  - **Find References**: `mantic references handleLogin` finds every usage, respecting `.gitignore`.
- **Learned Context (Team Memories)**: Mantic now remembers which files solved previous queries. These patterns are saved locally (`.mantic/search-patterns.json`) and can be committed to git to share knowledge across your team.
- **Python Support**: Now includes first-class support for Python imports in the dependency graph.
- **Security & Stability**: 
  - Regex DoS protection for user inputs.
  - Command injection mitigations for VS Code extension.
  - Safe fallback for non-git directories (scans allow-listed extensions).

**Performance Update**: v1.0.25 is **~2x faster** than previous versions, scanning Chromium (481K files) in <2 seconds.

**Tested on 481K files (Chromium) with 100% multi-repo accuracy.**

See the [CHANGELOG](https://github.com/marcoaapfortes/Mantic.sh/blob/main/CHANGELOG.md) for detailed release notes.

## Table of Contents

- [About the Project](#about-the-project)
- [Proprietary vs Mantic](#proprietary-vs-mantic-cost-analysis)
- [Performance Benchmarks](#performance-benchmarks)
- [Accuracy & Relevance](#accuracy--relevance-analysis)
- [Feature Comparison](#feature-comparison-matrix)
- [Use Case Recommendations](#use-case-recommendations)
- [Installation](#installation)
  - [CLI Installation](#cli-installation)
  - [MCP Server Installation](#mcp-server-installation)
- [Usage](#usage)
- [Agent Rules](#agent-rules-auto-pilot)
- [How It Works](#how-it-works)
- [License](#license)

## About the Project

Mantic is an infrastructure layer designed to remove unnecessary context retrieval overhead for AI agents. It infers intent from file structure and metadata rather than brute-force reading content, enabling retrieval speeds faster than human reaction time.

### Key Benefits

- **Speed**: Retrieval is consistently under 500ms for most repos, under 4s for massive monorepos (Chromium).
- **Efficiency**: Reduces token usage by up to 63% by filtering irrelevant files before reading.
- **Privacy**: Runs entirely locally with zero data egress.

### Proprietary vs Mantic (Cost Analysis)

For a team of 100 developers performing 100 searches per day (approx. 3M searches/year):

| Tool | Annual Cost (Est.) | Per-Search Cost | Privacy |
|------|---|---|---|
| **Mantic** | **$0** | **$0** | **Local-First** |
| Vector Embeddings (DIY) | $1,680 - $10,950* | $0.0005 - $0.003 | Cloud |
| SaaS Alternatives | $46,800+ | $0.015+ | Cloud |

**Note**: *Mantic costs are zero. Vector/SaaS costs are estimates based on standard managed infrastructure (e.g. Pinecone/Weaviate managed pods + compute) or per-seat Enterprise licensing (e.g. GitHub Copilot Enterprise).*

## Performance Benchmarks

### Speed Comparison (Real-world queries)

| Repository | Files | Query | Mantic v1.0.25 | ripgrep | fzf | Verdict |
|------------|-------|-------|-----------------|---------|-----|--------|
| **cal.com** | 9.7K | "stripe payment" | **0.288s** | 0.121s | 0.534s | Fast |
| **next.js** | 25K | "router server" | **0.440s** | 0.034s | 0.049s | Fast |
| **tensorflow** | 35K | "gpu" | **0.550s** | 0.022s | N/A | Fast |
| **chromium** | 481K | "ScriptController" | **1.961s** | 0.380s | 0.336s | <2s (Massive) |

**Speed Verdict**:
- **Caching works well** for most repos (4-17% improvement on second run).
- **Large repos (Chromium)** show modest but consistent improvements.
- **Mantic is slower** than ripgrep/fzf on raw speed but prioritizes ranking.

## Accuracy & Relevance Analysis

### Major Strengths

#### 1. Exact Path Matching
- **Query**: `"router server"` in next.js
- **Mantic**: Found `packages/next/src/server/lib/router-server.ts` (Score: 220)
- **ripgrep**: Found files mentioning "router" and "server" separately (many false positives)
- **Verdict**: Mantic found the **exact file** that matches the intent.

#### 2. CamelCase Detection
- **Query**: `"ScriptController"` in chromium
- **Mantic**: Found `script_controller.h`, `script_controller.cc` (Score: 200)
- **ripgrep**: Requires manual regex `script.*controller`
- **Verdict**: Mantic's CamelCase detection is **production-ready**.

#### 3. Directory Boosting for Acronyms
- **Query**: `"gpu"` in tensorflow
- **Mantic**: Prioritized files in `tensorflow/lite/delegates/gpu/`
- **Verdict**: Mantic correctly prioritizes **structural relevance**.

#### 4. Path Sequence Matching
- **Query**: `"blink renderer core dom"` in chromium
- **Mantic**: Found `third_party/blink/renderer/core/dom/README.md`
- **Verdict**: Mantic matches multi-term path queries perfectly.

## Feature Comparison Matrix

| Feature | Mantic | ripgrep | ag | fzf |
|---------|--------|---------|----|-----|
| **Text Search Speed** | 2-10x slower | Fastest | Slow (large repos) | Very Fast |
| **Relevance Ranking** | **Excellent** | None | None | Basic |
| **Path Structure Awareness** | **Perfect** | None | None | Partial |
| **CamelCase Detection** | **Yes** | No | No | No |
| **Exact Filename Matching** | **Yes** | No | No | Yes |
| **Multi-Word Queries** | **Semantic** | Regex needed | Regex needed | AND logic |
| **Go to Definition** | **Yes (Cross-Repo)** | No | No | No |
| **Find References** | **Yes** | No | No | No |
| **Impact Analysis** | **Yes** | No | No | No |
| **Zero-Query Mode** | **Yes** | No | No | No |

## Use Case Recommendations

### Best For
1. **AI Agents** (Context-aware search with metadata)
2. **Finding Files by Intent** ("Where is payment code?")
3. **Understanding Code Structure** (Path sequence queries)
4. **Code Reviews** (Impact analysis shows blast radius)

### Not Ideal For
1. **Quick Text Searches** ("Find all TODOs" -> Use ripgrep)
2. **Very Large Repos (100K+)** (Speed tradeoff: 4s vs 0.3s)
3. **Exact String Matching** (Use ripgrep with -F)
4. **Interactive File Browsing** (Use fzf)

## Installation

### CLI Installation

**Quick Start** (no installation required):

```bash
npx mantic.sh@latest "your search query"
```

**New Commands**:

```bash
# Semantic Search (Neural Reranking)
npx mantic.sh@latest "verify user identity" --semantic

# Go to Definition
npx mantic.sh@latest goto "UserService"

# Find References
npx mantic.sh@latest references "handleLogin"
```

**From Source**:

```bash
git clone https://github.com/marcoaapfortes/Mantic.sh.git
cd Mantic.sh
npm install
npm run build
npm link
```

### MCP Server Installation

Mantic works as an MCP (Model Context Protocol) server for Claude Desktop, Cursor, VS Code, and other MCP-compatible tools.

**One-Click Install:**
- [Install in Cursor](https://cursor.com/en/install-mcp?name=mantic&config=eyJ0eXBlIjogInN0ZGlvIiwgImNvbW1hbmQiOiAibnB4IiwgImFyZ3MiOiBbIi15IiwgIm1hbnRpYy5zaEBsYXRlc3QiLCAic2VydmVyIl19)
- [Install in VS Code](https://vscode.dev/redirect/mcp/install?name=mantic&config=%7B%22type%22%3A%20%22stdio%22%2C%20%22command%22%3A%20%22npx%22%2C%20%22args%22%3A%20%5B%22-y%22%2C%20%22mantic.sh%40latest%22%2C%20%22server%22%5D%7D)

**Manual Configuration** (for Claude Desktop or other MCP clients):

Add this to your MCP settings file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mantic": {
      "command": "npx",
      "args": ["-y", "mantic.sh@latest", "server"]
    }
  }
}
```

## Usage

### Basic Search

Find files matching your intent:

```bash
mantic "stripe payment integration"
```
*Returns JSON with ranked files, confidence scores, and token estimates.*

### Advanced Usage

**Zero-Query Mode** (proactive context):
```bash
mantic ""
# Shows modified files, related dependencies, impact analysis
```

**Context Carryover** (session mode):
```bash
mantic "auth logic" --session my-task
# Previously viewed files get +150 boost
```

**Impact Analysis**:
```bash
mantic "payment processing" --impact
# Shows blast radius and dependents

### Session Management (CLI)

You can manage sessions directly from the terminal to persist context across multiple runs:

```bash
# Start a named session with an intent
mantic session start my-feature --intent "implement payment webhook"

# List all active sessions
mantic session list

# Get detailed info (viewed files, query history)
mantic session info <sessionId>

# End a session
mantic session end <sessionId>
```
```

### CLI Options

```bash
mantic <query> [options]

Options:
  --code          Only search code files (.ts, .js, etc)
  --config        Only search config files
  --test          Only search test files
  --json          Output as JSON (default, includes metadata)
  --files         Output as newline-separated file paths
  --markdown      Pretty terminal output
  --impact        Include dependency analysis and blast radius
  --session <id>  Use session for context carryover
  --path <dir>    Restrict search to specific directory
  --include-generated  Include generated files (.lock, dist/, etc)
  --quiet, -q     Minimal output mode
  --semantic      Enable neural reranking (slower, but "smarter")
```

**Code Intelligence Commands**:

```bash
mantic goto <symbol>        # Find definition of a symbol
mantic references <symbol>  # Find all usages of a symbol
```

### MCP Tools

When using Mantic through MCP (Claude Desktop, Cursor):

- `search_files` - Primary search (supports `semantic: true` for neural reranking)
- `get_definition` - Go to definition of a symbol
- `find_references` - Find usages of a symbol
- `get_context` - Zero-query mode for proactive context
- `session_start/end` - Manage coding sessions
- `session_record_view` - Track viewed files
- `session_list/info` - View session history
- `analyze_intent` - Understand query intent

## Agent Rules (Auto-Pilot)

Want Cursor or Claude to use Mantic automatically?

1. Copy the [Agent Rules](AGENT_RULES.md).
2. Paste them into your AI tool's system prompt or "Rules for AI" section.
3. The Agent will now automatically use `mantic` to find context before writing code.

## How It Works

### Architecture Overview

```
User Query
    ↓
Intent Analyzer (categorizes: UI/backend/auth/etc)
    ↓
Brain Scorer (ranks files using metadata)
    ↓
File Classifier (filters by type: code/config/test)
    ↓
Impact Analyzer (calculates blast radius)
    ↓
Output (JSON/Files/Markdown/MCP)
```

### Core Algorithm (v1.0.21)

1. **Intent Recognition**: Analyzes query to determine code category (e.g., "auth", "ui")
2. **File Enumeration**: Uses `git ls-files` for tracked files (significantly faster than traversals)
3. **Normalization & Matching**:
   - **CamelCase detection**: "ScriptController" -> "script controller" for matching
   - **Word-boundary matching**: "script" won't match "javascript"
   - **Path sequence matching**: Multi-term queries match consecutive path components
   - **Directory boosting**: Single-term queries prioritize files in matching directories
4. **Structural Scoring**: Ranks files based on:
   - **Exact filename match**: +10,000 points for perfect matches
   - **Path relevance**: `packages/features/payments` indicates high signal
   - **Filename matching**: `stripe.service.ts` > `stripe.txt`
   - **Business logic awareness**: `.service.ts` boosted over `.test.ts`
   - **Boilerplate penalties**: `index.ts` or `page.tsx` ranked lower
5. **Progressive Disclosure**: Calculates metadata (size, tokens, confidence, timestamps)
6. **Context Carryover**: Applies +150 boost to session-viewed files
7. **Learning**: Caches successful patterns for future queries

## Configuration

Mantic works out of the box with zero configuration for most projects.

### Environment Variables

```bash
MANTIC_MAX_FILES=5000         # Maximum files to scan
MANTIC_TIMEOUT=30000          # Search timeout in ms (default: 30000)
MANTIC_IGNORE_PATTERNS=...    # Custom glob patterns to ignore
MANTIC_FUNCTION_SCAN_LIMIT=30 # Top files to scan for function names (default: dynamic, max 50)
```

## License

Mantic.sh is **Dual Licensed** to support both open access and sustainable development.

### 1. AGPL-3.0 (Open Source & Internal Use)
**Ideal for**: Individuals, Internal Business Tools, Open Source Projects.

- **Free for internal use** (e.g., using Mantic.sh CLI in your company's dev team).
- **Free for open source** (integrating into other AGPL/GPL projects).
- **Requirement**: If you distribute Mantic.sh (or a modified version) as part of your own application (e.g., embedding it in a proprietary IDE or SaaS), you **must open-source your entire application** under AGPL-3.0. For hosted services, users must have access to the modified source code.

### 2. Commercial License (Proprietary & Embedding)
**Ideal for**: Commercial IDEs, SaaS Platforms, Proprietary Products.

- **Embed Mantic.sh** in proprietary software (e.g., VS Code forks, AI Agents, SaaS tools).
- **No open-source requirement** (keep your source code private).
- **Support & Indemnification**: Priority email support and legal indemnification included.

**Pricing**:
- **Internal Use**: Free (under AGPL-3.0).
- **Commercial Integration**: Contact for pricing (starts at $500/year, based on usage).

**Enforcement**:
All derivatives must comply with AGPL-3.0 unless under a commercial license. Unauthorized copying or rewrites may violate copyright laws.

**Contributing**:
To maintain the dual-license model, all contributors must sign a Contributor License Agreement (CLA) granting relicensing rights.

**Contact**: [license@mantic.sh](mailto:license@mantic.sh)

See [LICENSE](LICENSE) for the full AGPL-3.0 terms.
