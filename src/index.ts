#!/usr/bin/env node
/**
 * Mantic - Machine-First Code Search
 * Fast context layer for AI agents
 */

import { Command } from 'commander';
import * as path from 'path';

const program = new Command();

program
    .name('mantic')
    .description('Mantic: The reference implementation of cognitive code search.')
    .version('1.0.24');

// Main search command (default)
program
    .argument('[query...]', 'Search query')
    .option('-p, --path <dir>', 'Restrict search to specific path')
    .option('-q, --quiet', 'Minimal output')
    .option('--json', 'Output as JSON (default)')
    .option('--files', 'Output file paths only')
    .option('--markdown', 'Output as Markdown')
    .option('--mcp', 'Output in MCP format')
    // Context Filters
    .option('--code', 'Only code files')
    .option('--config', 'Only config files')
    .option('--test', 'Only test files')
    .option('--include-generated', 'Include generated files (.lock, .log, dist/)')
    // Impact Analysis
    .option('--impact', 'Include impact analysis (blast radius, dependents)')
    // Semantic Search
    .option('--semantic', 'Enable neural reranking for improved relevance')
    .option('--fast', 'Skip semantic reranking (heuristic only)')
    // Session Memory
    .option('--session <id>', 'Use active session for context carryover')
    .action(async (queryParts, options) => {
        const query = queryParts.join(' ');

        // Allow empty query for zero-query mode
        // if (!query) {
        //     console.error('Error: Query required');
        //     console.error('Usage: mantic <query> [options]');
        //     console.error('Example: mantic "stripe payment" --code --json');
        //     console.error('Tip: Run "mantic" with no arguments to see your current context');
        //     process.exit(1);
        // }

        // Default to JSON output (machine-first)
        if (!options.json && !options.files && !options.markdown && !options.mcp) {
            options.json = true;
        }

        const { processRequest } = await import('./process-request.js');
        await processRequest(query, options);
        process.exit(0);
    });

// Session management commands
const session = program.command('session').description('Manage agent sessions');

session
    .command('start')
    .argument('[name]', 'Session name (optional)')
    .option('-i, --intent <text>', 'Session intent/goal')
    .description('Start a new session')
    .action(async (name, options) => {
        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(process.cwd());
        const newSession = await sm.startSession(name || `session-${Date.now()}`, options.intent);
        console.log(JSON.stringify({
            sessionId: newSession.metadata.id,
            name: newSession.metadata.name,
            intent: newSession.metadata.intent,
            created: newSession.metadata.created
        }, null, 2));
    });

session
    .command('list')
    .description('List all sessions')
    .action(async () => {
        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(process.cwd());
        const sessions = await sm.listSessions();

        if (sessions.length === 0) {
            console.log('No sessions found.');
            return;
        }

        console.log(JSON.stringify(sessions.map(s => ({
            sessionId: s.id,
            name: s.name,
            intent: s.intent,
            created: s.created,
            lastActive: s.lastActive,
            queryCount: s.queryCount,
            status: s.status
        })), null, 2));
    });

session
    .command('info')
    .argument('<sessionId>', 'Session ID')
    .description('Get session details')
    .action(async (sessionId) => {
        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(process.cwd());
        const loadedSession = await sm.loadSession(sessionId);

        if (!loadedSession) {
            console.error(`Session not found: ${sessionId}`);
            process.exit(1);
        }

        console.log(JSON.stringify({
            metadata: loadedSession.metadata,
            viewedFiles: Array.from(loadedSession.viewedFiles.entries()).map(([path, data]) => ({
                path,
                viewCount: data.viewCount,
                lastViewed: data.lastViewed,
                relevanceScore: data.relevanceScore,
                blastRadius: data.blastRadius,
                notes: data.notes
            })),
            queryHistory: loadedSession.queryHistory,
            insights: loadedSession.insights
        }, null, 2));
    });

session
    .command('end')
    .argument('[sessionId]', 'Session ID (uses current if not specified)')
    .description('End a session')
    .action(async (sessionId) => {
        const { SessionManager } = await import('./session-manager.js');
        const sm = new SessionManager(process.cwd());

        if (sessionId) {
            const loadedSession = await sm.loadSession(sessionId);
            if (!loadedSession) {
                console.error(`Session not found: ${sessionId}`);
                process.exit(1);
            }
        }

        await sm.endSession();
        console.log(`Session ended: ${sessionId || 'current'}`);
    });

// Repository Map command
program
    .command('map [directory]')
    .description('Show repository architecture map')
    .option('-d, --depth <n>', 'Max directory depth', '4')
    .option('--no-ranks', 'Hide importance indicators')
    .option('--all', 'Include all files (not just code)')
    .action(async (directory, options) => {
        const { generateRepoMap } = await import('./repo-map.js');

        const targetDir = directory
            ? path.resolve(process.cwd(), directory)
            : process.cwd();

        try {
            const map = await generateRepoMap(targetDir, {
                maxDepth: parseInt(options.depth) || 4,
                showRanks: options.ranks !== false,
                codeOnly: !options.all
            });
            console.log(map);
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

// Code Intelligence commands
program
    .command('definitions <file>')
    .description('List all definitions in a file')
    .option('--json', 'Output as JSON')
    .action(async (file, options, command) => {
        const globalOptions = command.parent?.opts() || {};
        const jsonMode = options.json || globalOptions.json;
        const { CodeIntel } = await import('./code-intel.js');

        try {
            const intel = new CodeIntel();
            await intel.init();
            const definitions = await intel.getDefinitions(file, process.cwd());

            if (jsonMode) {
                console.log(JSON.stringify(definitions, null, 2));
            } else {
                if (definitions.length === 0) {
                    console.log('No definitions found.');
                    return;
                }

                for (const def of definitions) {
                    console.log(`${def.type.padEnd(10)} ${def.name.padEnd(30)} ${def.file}:${def.line}`);
                }
            }
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

program
    .command('references <symbol>')
    .description('Find all references to a symbol')
    .option('-d, --dir <dir>', 'Search directory')
    .option('--json', 'Output as JSON')
    .action(async (symbol, options, command) => {
        const globalOptions = command.parent?.opts() || {};
        const jsonMode = options.json || globalOptions.json;
        const { CodeIntel } = await import('./code-intel.js');
        const { getGitFiles, isGitRepo } = await import('./git-utils.js');
        const fg = (await import('fast-glob')).default;

        try {
            const cwd = options.dir ? path.resolve(process.cwd(), options.dir) : process.cwd();
            let files = getGitFiles(cwd);

            if (files.length === 0 && !isGitRepo(cwd)) {
                // Fallback for non-git directories
                if (!jsonMode) {
                    console.error('Note: Not a git repository. Scanning all files (this might take a moment)...');
                }
                files = await fg(['**/*.{ts,js,jsx,tsx,py,go,rs,c,cpp,h,java}'], {
                    cwd,
                    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
                    dot: false
                });
            }

            if (files.length === 0) {
                if (jsonMode) {
                    console.log(JSON.stringify([], null, 2));
                } else {
                    console.log('No files found to search.');
                }
                return;
            }

            const intel = new CodeIntel();
            await intel.init();
            const references = await intel.findReferences(symbol, files, cwd);

            if (jsonMode) {
                console.log(JSON.stringify(references, null, 2));
            } else {
                if (references.length === 0) {
                    console.log(`No references found for "${symbol}".`);
                    return;
                }

                console.log(`Found ${references.length} references to "${symbol}":\n`);
                for (const ref of references.slice(0, 50)) {
                    console.log(`  ${ref.file}:${ref.line}`);
                    console.log(`    ${ref.context}`);
                }

                if (references.length > 50) {
                    console.log(`\n  ... and ${references.length - 50} more`);
                }
            }
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

program
    .command('goto <symbol>')
    .description('Go to the definition of a symbol')
    .option('-p, --path <dir>', 'Search directory')
    .option('--json', 'Output as JSON')
    .action(async (symbol, options, command) => {
        const globalOptions = command.parent?.opts() || {};
        const jsonMode = options.json || globalOptions.json;
        const { CodeIntel } = await import('./code-intel.js');
        const { getGitFiles, isGitRepo } = await import('./git-utils.js');
        const fg = (await import('fast-glob')).default;

        try {
            const cwd = options.path ? path.resolve(process.cwd(), options.path) : process.cwd();
            let files = getGitFiles(cwd);

            if (files.length === 0 && !isGitRepo(cwd)) {
                // Fallback for non-git directories
                if (!jsonMode) {
                    console.error('Note: Not a git repository. Scanning all files (this might take a moment)...');
                }
                files = await fg(['**/*.{ts,js,jsx,tsx,py,go,rs,c,cpp,h,java}'], {
                    cwd,
                    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
                    dot: false
                });
            }

            if (files.length === 0) {
                if (jsonMode) {
                    console.log(JSON.stringify({ found: false, symbol, cwd, definition: null }, null, 2));
                } else {
                    console.log('No files found to search.');
                }
                return;
            }

            const intel = new CodeIntel();
            await intel.init();
            const definition = await intel.goToDefinition(symbol, files, cwd);

            if (jsonMode) {
                console.log(JSON.stringify({
                    found: !!definition,
                    symbol,
                    cwd,
                    definition
                }, null, 2));
            } else {
                if (!definition) {
                    console.log(`Definition not found for "${symbol}".`);
                    return;
                }

                console.log(`${definition.file}:${definition.line}:${definition.column}`);
                console.log(`  ${definition.type} ${definition.name}`);
            }
        } catch (error) {
            console.error('Error:', error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });

// MCP Server command
program
    .command('server')
    .description('Start the MCP server')
    .action(async () => {
        const { runServer } = await import('./mcp-server.js');
        await runServer();
    });

program.parse();
