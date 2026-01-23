# Mantic for VS Code

AI-native code search with semantic understanding.

## Features

- **Smart Search** (`Cmd+Shift+M`): Find files by intent, not just keywords
- **Semantic Search**: Neural reranking for improved relevance
- **Code Intelligence**: Definitions, references, and go-to-definition

## Requirements

Install the Mantic CLI:

```bash
npm install -g mantic.sh
```

## Commands

| Command | Description |
|---------|-------------|
| `Mantic: Search` | Search files by query |
| `Mantic: Search (Semantic)` | Search with neural reranking |
| `Mantic: Show Definitions` | List definitions in current file |
| `Mantic: Find References` | Find all references to a symbol |
| `Mantic: Go to Definition` | Jump to symbol definition |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `mantic.cliPath` | `mantic` | Path to Mantic CLI |
| `mantic.defaultSemantic` | `false` | Enable semantic search by default |
| `mantic.maxResults` | `20` | Max results to display |

## Usage

1. Open a workspace
2. Press `Cmd+Shift+M` (Mac) or `Ctrl+Shift+M` (Windows/Linux)
3. Enter your search query
4. Select a file to open

## Links

- [GitHub](https://github.com/marcoaapfortes/Mantic.sh)
- [Documentation](https://github.com/marcoaapfortes/Mantic.sh#readme)
