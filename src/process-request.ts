/**
 * Machine-first request processor
 * Supports JSON, file list, markdown, and MCP output formats
 */

import { scanProject } from './scanner.js';
import { buildContextResult } from './context-builder.js';
import { formatAsJSON, formatAsFileList, formatAsMarkdown, formatAsMCP } from './context-formatter.js';
import { classifyFile } from './file-classifier.js';
import { FileType } from './types.js';
import { buildDependencyGraph } from './dependency-graph.js';
import { analyzeMultipleImpacts } from './impact-analyzer.js';
import { ParallelMantic } from './parallel-mantic.js';

import * as path from 'path';
import * as fs from 'fs';

/**
 * Calculate progressive disclosure metadata for a file
 */
async function calculateFileMetadata(filePath: string, targetDir: string, maxScore: number, fileScore: number): Promise<any> {
    try {
        const fullPath = path.join(targetDir, filePath);
        const stats = await fs.promises.stat(fullPath);
        const content = await fs.promises.readFile(fullPath, 'utf8');
        const lines = content.split(/\r?\n/).length;
        const estimatedTokens = lines * 4;

        const confidence = maxScore > 0 ? Math.min(1.0, fileScore / maxScore) : 0.5;

        return {
            sizeBytes: stats.size,
            lines,
            estimatedTokens,
            lastModified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString(),
            confidence: Math.round(confidence * 100) / 100
        };
    } catch (error) {
        return undefined;
    }
}

export async function processRequest(userPrompt: string, options: any): Promise<string> {
    const startTime = Date.now();

    // Determine target directory (default to CWD)
    const targetDir = options.path
        ? path.resolve(process.cwd(), options.path)
        : process.cwd();

    // Determine output format
    const outputFormat = options.json ? 'json'
        : options.files ? 'files'
            : options.markdown ? 'markdown'
                : options.mcp ? 'mcp'
                    : 'json'; // Default to JSON for machine-first

    try {
        // ZERO-QUERY MODE: Proactive context detection
        if (!userPrompt || userPrompt.trim() === '') {
            const { ContextIntel } = await import('./context-intel.js');
            const { getGitFiles } = await import('./git-utils.js');
            const { formatZeroQueryContext } = await import('./context-formatter.js');

            const contextIntel = new ContextIntel(targetDir);
            const allFiles = getGitFiles(targetDir);

            const zeroQueryContext = await contextIntel.buildContext(allFiles);

            if (!zeroQueryContext) {
                // No context available - return helpful message
                const emptyResponse = {
                    mode: 'zero-query',
                    message: 'No active context detected. Start by editing files or try: mantic "your search query"',
                    suggestion: 'Make some changes to files or start a session to enable context tracking'
                };

                if (outputFormat === 'json') {
                    console.log(JSON.stringify(emptyResponse, null, 2));
                } else {
                    console.log('\nMantic Zero-Query Mode');
                    console.log('No active context detected.');
                    console.log('Tip: Start by editing files or try: mantic "your search query"\n');
                }
                return JSON.stringify(emptyResponse);
            }

            // Return zero-query context
            const response = {
                mode: 'zero-query',
                ...zeroQueryContext
            };

            // Format output based on requested format
            if (outputFormat === 'json') {
                console.log(JSON.stringify(response, null, 2));
            } else if (outputFormat === 'files') {
                // For files-only mode, show modified + related files
                const allPaths = [
                    ...zeroQueryContext.modified.map((f: any) => f.path),
                    ...zeroQueryContext.related.map((f: any) => f.path)
                ];
                console.log(allPaths.join('\n'));
            } else {
                // Pretty terminal output
                console.log(formatZeroQueryContext(zeroQueryContext));
            }

            return JSON.stringify(response);
        }
        // PHASE 0: Load Session Context (if active)
        let sessionContextFiles: string[] = [];
        if (options.session) {
            const { SessionManager } = await import('./session-manager.js');
            const sm = new SessionManager(targetDir);
            const session = await sm.loadSession(options.session);
            if (session) {
                // Get previously viewed files for context carryover
                sessionContextFiles = Array.from(session.viewedFiles.keys());
            }
        }

        // PHASE 1: Analyze Intent
        const { IntentAnalyzer } = await import('./intent-analyzer.js');
        const intentAnalyzer = new IntentAnalyzer();
        const intentAnalysis = await intentAnalyzer.analyze(userPrompt);

        // PHASE 2: Scan Project
        // Fast brain scorer (no semantic parsing for machine mode)
        const projectContext = await scanProject(targetDir, {
            intentAnalysis,
            parseSemantics: false,
            onProgress: undefined,
            skipScoring: true // Defer scoring to processRequest for parallelization support
        });

        const scanTimeMs = Date.now() - startTime;

        // Use ManticEngine scores (Parallel or Single-Threaded)
        let scoredFilesFn: () => Promise<any[]>;
        const allFiles = projectContext.fileStructure;

        // Threshold for parallelization
        if (allFiles.length > 50000) {
            console.error(`⚡ Large repo detected (${allFiles.length} files). Switching to Parallel Mantic Engine...`);
            const parallelEngine = new ParallelMantic(allFiles);

            scoredFilesFn = async () => {
                // Use original prompt to preserve query structure (e.g., "download_manager.cc" not ".cc download manager")
                const query = intentAnalysis.originalPrompt || intentAnalysis.keywords.join(' ');
                const results = await parallelEngine.search(query);
                parallelEngine.terminate();
                return results;
            };
        } else {
            // Standard V2 Engine (Fast enough for <50k files)
            scoredFilesFn = async () => {
                // Reuse the existing scores from scanner context or re-run lightly
                if (projectContext.scoredFiles && projectContext.scoredFiles.length > 0) {
                    return projectContext.scoredFiles;
                }

                // If scanner skipped scoring, we must do it validly here (Single Threaded for <50k)
                const { ManticEngine } = await import('./brain-scorer.js');
                const engine = new ManticEngine();
                // Note: rankFiles expects files, keywords, intent, cwd
                return engine.rankFiles(allFiles, intentAnalysis.keywords, intentAnalysis, targetDir);
            };
        }

        const rawResults = await scoredFilesFn();

        // Calculate max score for confidence calculation
        const maxScore = rawResults.length > 0 ? Math.max(...rawResults.map(r => r.score)) : 0;

        // Prepare file data without metadata first
        const filesWithoutMetadata = rawResults.map((sf) => {
            // Handle both result shapes (Parallel returns {file, score}, Scanner returns {path, score})
            const pathStr = sf.path || sf.file;
            const scoreVal = sf.score;
            const reasons = sf.reasons || (sf.matchType ? [sf.matchType] : []);

            const fileType = classifyFile(pathStr);

            return {
                path: pathStr,
                score: scoreVal,
                matchedConstraints: reasons,
                isImported: false,
                isExported: false,
                fileType,
                matchedLines: projectContext.fileLocations
                    ?.find(fl => fl.path === pathStr)
                    ?.lines?.map(l => ({ line: l.line, content: l.content, keyword: l.keyword }))
            };
        });

        // Batch calculate metadata for top 100 files to avoid blocking on large result sets
        const topFilesForMetadata = filesWithoutMetadata.slice(0, 100);
        const metadataPromises = topFilesForMetadata.map(file =>
            calculateFileMetadata(file.path, targetDir, maxScore, file.score)
        );
        const metadataResults = await Promise.all(metadataPromises);

        // Attach metadata to files
        let scoredFiles = filesWithoutMetadata.map((file, index) => {
            if (index < 100) {
                return { ...file, metadata: metadataResults[index] };
            }
            return { ...file, metadata: undefined };
        });

        // If scoredFiles is missing, something went wrong in the scanner
        if (!scoredFiles) {
            // Warn but don't crash - return empty array
            console.warn('Scanner produced no results.');
            scoredFiles = [];
        }

        // Apply context carryover boost for session files
        if (sessionContextFiles.length > 0) {
            scoredFiles.forEach(file => {
                if (sessionContextFiles.includes(file.path)) {
                    file.score += 150;
                    file.matchedConstraints.push('session-context');
                }
            });
        }

        // Apply context filters
        const filterType: FileType | null = options.code ? 'code'
            : options.config ? 'config'
                : options.test ? 'test'
                    : null;

        if (filterType) {
            scoredFiles = scoredFiles.filter(f => f.fileType === filterType);
        }

        // Exclude generated files by default (unless --include-generated is specified)
        if (!options.includeGenerated) {
            scoredFiles = scoredFiles.filter(f => f.fileType !== 'generated');
        }

        // Filter out low-confidence results (score < 50) to reduce false positives
        // High scores: 10000+ (exact match), 5000+ (filename match), 200+ (good structural match)
        // Low scores: < 50 are typically weak keyword matches with many missing terms
        const qualityThreshold = 50;
        const beforeFilter = scoredFiles.length;
        scoredFiles = scoredFiles.filter(f => f.score >= qualityThreshold);

        if (beforeFilter > 0 && scoredFiles.length === 0) {
            console.warn(`No high-confidence matches found (all ${beforeFilter} results had score < ${qualityThreshold})`);
        }

        const contextResult = buildContextResult(
            userPrompt,
            intentAnalysis,
            scoredFiles,
            projectContext,
            scanTimeMs
        );

        // PHASE 3: Impact Analysis (if requested)
        if (options.impact && contextResult.files.length > 0) {
            // Build dependency graph for all project files
            const allFiles = projectContext.fileStructure.filter(
                f => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.jsx')
            );

            const graph = await buildDependencyGraph(allFiles, targetDir);

            // Analyze impact for top files (limit to top 10 to avoid slowdown)
            const topFilePaths = contextResult.files.slice(0, 10).map(f => f.path);
            const impactAnalyses = await analyzeMultipleImpacts(topFilePaths, graph, allFiles);

            // Attach impact analysis to each file in results
            contextResult.files = contextResult.files.map(file => {
                const impact = impactAnalyses.get(file.path);
                if (impact) {
                    return {
                        ...file,
                        impact: {
                            blastRadius: impact.blastRadius,
                            score: impact.score,
                            directDependents: impact.dependents.direct.length,
                            indirectDependents: impact.dependents.indirect.length,
                            relatedTests: impact.dependents.tests.length,
                            warnings: impact.warnings
                        }
                    };
                }
                return file;
            });
        }

        // PHASE 4: Session Recording (if active)
        if (options.session) {
            const { SessionManager } = await import('./session-manager.js');
            const sm = new SessionManager(targetDir);
            // Try to load session (handles ID or name)
            const session = await sm.loadSession(options.session);
            if (session) {
                await sm.recordQuery(userPrompt, contextResult.files.length);

                // Record file views for context carryover
                await sm.recordFileViews(contextResult.files.map(f => ({
                    path: f.path,
                    relevanceScore: f.relevanceScore,
                    blastRadius: f.impact?.blastRadius
                })));
            }
        }

        // Output in requested format
        let output = '';
        switch (outputFormat) {
            case 'json':
                output = formatAsJSON(contextResult);
                console.log(output);
                return output;

            case 'files':
                output = formatAsFileList(contextResult);
                console.log(output);
                return output;

            case 'markdown':
                output = formatAsMarkdown(contextResult);
                console.log(output);
                return output;

            case 'mcp':
                output = JSON.stringify(formatAsMCP(contextResult), null, 2);
                console.log(output);
                return output;
        }

        return '';

    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
