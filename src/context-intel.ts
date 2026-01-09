/**
 * Context Intelligence Engine
 * Zero-Query Mode: Proactive context detection
 *
 * Analyzes git status + session history + dependencies to infer what user is working on
 * Returns actionable context without requiring explicit search queries
 */

import { getGitModifiedFiles } from './git-utils.js';
import { SessionManager, SessionFile } from './session-manager.js';
import { buildDependencyGraph, DependencyGraph } from './dependency-graph.js';
import { analyzeMultipleImpacts, ImpactAnalysis, BlastRadius } from './impact-analyzer.js';
import { IntentAnalyzer } from './intent-analyzer.js';
import path from 'path';

export interface WorkingContext {
    topic: string;  // e.g., "payment processing", "authentication", "UI components"
    confidence: number;  // 0-1
    evidence: string[];
}

export interface RelatedFile {
    path: string;
    reason: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    line?: number;  // Line number where relationship exists
}

export interface ImpactSummary {
    blast_radius: BlastRadius;
    affected_files: number;
    risk_assessment: string;
}

export interface ZeroQueryContext {
    context: WorkingContext;
    modified: Array<{
        path: string;
        status: string;
        last_modified: string;
    }>;
    related: RelatedFile[];
    impact: ImpactSummary;
    suggestions: {
        next_steps: string[];
    };
    session: {
        id: string;
        auto_started: boolean;
        files_tracked: number;
    };
}

export class ContextIntel {
    private projectRoot: string;
    private sessionManager: SessionManager;
    private intentAnalyzer: IntentAnalyzer;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.sessionManager = new SessionManager(projectRoot);
        this.intentAnalyzer = new IntentAnalyzer();
    }

    /**
     * Build zero-query context
     * Proactive context detection without explicit search
     */
    async buildContext(allFiles: string[]): Promise<ZeroQueryContext | null> {
        // 1. Get git modified files (what they're editing NOW)
        let modifiedFiles: string[] = [];
        try {
            modifiedFiles = Array.from(getGitModifiedFiles(this.projectRoot));
        } catch (e) {
            // Not a git repo or git unavailable - proceed with session-only context
            console.warn('Unable to detect git changes, using session-only context:', e instanceof Error ? e.message : String(e));
        }

        // 2. Load or create session
        let session = this.sessionManager.getActiveSession();
        let autoStarted = false;

        if (!session) {
            // Auto-start session if we detect activity
            if (modifiedFiles.length > 0) {
                session = await this.sessionManager.startSession(`auto-${Date.now()}`);
                if (!session) {
                    // Failed to start session - return null
                    return null;
                }
                autoStarted = true;
            } else {
                // No activity, no session - return null
                return null;
            }
        }

        // 3. Get session history (what they viewed recently)
        const sessionFiles = Array.from(session.viewedFiles.keys());

        // 4. Combine modified + session files as "working set"
        const workingSet = [...new Set([...modifiedFiles, ...sessionFiles.slice(0, 10)])];

        if (workingSet.length === 0) {
            return null;  // No context to provide
        }

        // 5. Infer what they're working on (topic detection)
        const workingContext = await this.inferWorkingContext(workingSet, session);

        // 6. Build dependency graph for working set + related files
        const relevantFiles = this.getRelevantFilesForGraph(workingSet, allFiles);
        const graph = await buildDependencyGraph(relevantFiles, this.projectRoot);

        // 7. Find related files based on dependencies
        const relatedFiles = await this.findRelatedFiles(workingSet, graph, allFiles);

        // 8. Analyze impact of modified files
        const impact = await this.calculateImpact(modifiedFiles, graph, allFiles);

        // 9. Generate smart suggestions
        const suggestions = this.generateSuggestions(
            workingContext,
            modifiedFiles,
            relatedFiles,
            impact
        );

        // 10. Format modified files with metadata
        const modifiedWithMeta = modifiedFiles.map(filepath => ({
            path: filepath,
            status: 'M',  // TODO: Get actual git status (M, A, D, etc)
            last_modified: 'recently'  // TODO: Get actual timestamp
        }));

        return {
            context: workingContext,
            modified: modifiedWithMeta,
            related: relatedFiles,
            impact,
            suggestions: {
                next_steps: suggestions
            },
            session: {
                id: session.metadata.id,
                auto_started: autoStarted,
                files_tracked: session.viewedFiles.size
            }
        };
    }

    /**
     * Infer what the user is working on based on file patterns
     * Uses directory structure + file names to detect topic
     */
    private async inferWorkingContext(
        workingSet: string[],
        session: any
    ): Promise<WorkingContext> {
        const evidence: string[] = [];
        const topicCounts = new Map<string, number>();

        // 1. Extract topics from file paths
        for (const filepath of workingSet) {
            const parts = filepath.toLowerCase().split('/');

            // Topic detection patterns
            const topics = [
                { pattern: /payment|stripe|checkout|billing/, topic: 'payment processing' },
                { pattern: /auth|login|signup|session|token/, topic: 'authentication' },
                { pattern: /ui|component|button|modal|card/, topic: 'UI components' },
                { pattern: /api|endpoint|route|controller/, topic: 'API development' },
                { pattern: /test|spec|e2e/, topic: 'testing' },
                { pattern: /config|env|setup/, topic: 'configuration' },
                { pattern: /database|db|prisma|schema/, topic: 'database' },
                { pattern: /webhook|event|notification/, topic: 'integrations' },
            ];

            for (const { pattern, topic } of topics) {
                if (parts.some(part => pattern.test(part))) {
                    topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
                }
            }
        }

        // 2. Find dominant topic
        let dominantTopic = 'general development';
        let maxCount = 0;

        for (const [topic, count] of topicCounts.entries()) {
            if (count > maxCount) {
                dominantTopic = topic;
                maxCount = count;
            }
        }

        // 3. Build evidence list
        if (workingSet.length > 0) {
            const fileList = workingSet.slice(0, 3).join(', ');
            evidence.push(`Modified: ${fileList}`);
        }

        if (session && session.viewedFiles.size > 0) {
            evidence.push(`Session: Viewed ${session.viewedFiles.size} related files`);
        }

        if (maxCount >= 2) {
            evidence.push(`Pattern: ${maxCount}/${workingSet.length} files in ${dominantTopic} domain`);
        }

        // 4. Calculate confidence
        const confidence = this.calculateTopicConfidence(maxCount, workingSet.length);

        return {
            topic: dominantTopic,
            confidence,
            evidence
        };
    }

    /**
     * Calculate confidence score for topic detection
     */
    private calculateTopicConfidence(matchCount: number, totalFiles: number): number {
        if (totalFiles === 0) return 0;

        const ratio = matchCount / totalFiles;

        if (ratio >= 0.7) return 0.95;  // 70%+ match = very confident
        if (ratio >= 0.5) return 0.85;  // 50%+ match = confident
        if (ratio >= 0.3) return 0.70;  // 30%+ match = moderately confident
        return 0.50;  // Default: somewhat confident
    }

    /**
     * Get relevant files for building dependency graph
     * Limits scope to avoid scanning entire monorepo
     */
    private getRelevantFilesForGraph(workingSet: string[], allFiles: string[]): string[] {
        const relevant = new Set<string>(workingSet);

        // Add files in same directories as working set
        for (const file of workingSet) {
            const dir = path.dirname(file);
            // Normalize paths for cross-platform consistency (git uses forward slashes)
            const normalizedDir = dir.replace(/\\/g, '/');

            for (const candidate of allFiles) {
                const normalizedCandidate = candidate.replace(/\\/g, '/');
                // Ensure directory boundary is respected
                if ((normalizedCandidate === normalizedDir || normalizedCandidate.startsWith(normalizedDir + '/')) && !candidate.includes('node_modules')) {
                    relevant.add(candidate);
                    if (relevant.size > 500) break;  // Limit graph size
                }
            }
        }

        return Array.from(relevant);
    }

    /**
     * Find related files based on import relationships
     */
    private async findRelatedFiles(
        workingSet: string[],
        graph: DependencyGraph,
        allFiles: string[]
    ): Promise<RelatedFile[]> {
        const related: RelatedFile[] = [];
        const seen = new Set<string>(workingSet);

        for (const filepath of workingSet) {
            const node = graph.nodes.get(filepath);
            if (!node) continue;

            // 1. Files that import this file (dependents)
            for (const dependent of node.dependents.slice(0, 5)) {
                if (!seen.has(dependent)) {
                    related.push({
                        path: dependent,
                        reason: `imports ${path.basename(filepath)}`,
                        priority: 'critical'
                    });
                    seen.add(dependent);
                }
            }

            // 2. Files that this file imports (dependencies)
            for (const imp of node.imports.slice(0, 5)) {
                const resolvedPath = this.resolveImport(imp.source, filepath, allFiles);
                if (resolvedPath && !seen.has(resolvedPath)) {
                    related.push({
                        path: resolvedPath,
                        reason: 'dependency',
                        priority: 'high',
                        line: imp.line
                    });
                    seen.add(resolvedPath);
                }
            }

            // 3. Test files
            const testFiles = this.findTestFiles(filepath, allFiles);
            for (const testFile of testFiles) {
                if (!seen.has(testFile)) {
                    related.push({
                        path: testFile,
                        reason: 'tests',
                        priority: 'medium'
                    });
                    seen.add(testFile);
                }
            }

            // 4. Config files
            const configFiles = this.findConfigFiles(filepath, allFiles);
            for (const configFile of configFiles.slice(0, 2)) {
                if (!seen.has(configFile)) {
                    related.push({
                        path: configFile,
                        reason: 'configuration',
                        priority: 'low'
                    });
                    seen.add(configFile);
                }
            }
        }

        // Sort by priority
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        related.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

        return related.slice(0, 10);  // Limit to top 10
    }

    /**
     * Calculate aggregate impact of modified files
     */
    private async calculateImpact(
        modifiedFiles: string[],
        graph: DependencyGraph,
        allFiles: string[]
    ): Promise<ImpactSummary> {
        if (modifiedFiles.length === 0) {
            return {
                blast_radius: 'small',
                affected_files: 0,
                risk_assessment: 'No changes detected'
            };
        }

        const impacts = await analyzeMultipleImpacts(modifiedFiles, graph, allFiles);

        let maxRadius: BlastRadius = 'small';
        let totalAffected = 0;
        const radiusOrder = { small: 0, medium: 1, large: 2, critical: 3 };

        for (const [filepath, impact] of impacts.entries()) {
            if (radiusOrder[impact.blastRadius] > radiusOrder[maxRadius]) {
                maxRadius = impact.blastRadius;
            }
            totalAffected += impact.dependents.direct.length;
        }

        // Generate risk assessment
        let risk = 'Changes isolated to modified files';
        if (maxRadius === 'critical') {
            risk = `CRITICAL: ${totalAffected}+ files depend on changes`;
        } else if (maxRadius === 'large') {
            risk = `HIGH: ${totalAffected} files may be affected`;
        } else if (maxRadius === 'medium') {
            risk = `MODERATE: ${totalAffected} files depend on changes`;
        }

        return {
            blast_radius: maxRadius,
            affected_files: totalAffected,
            risk_assessment: risk
        };
    }

    /**
     * Generate smart next-step suggestions
     */
    private generateSuggestions(
        context: WorkingContext,
        modifiedFiles: string[],
        relatedFiles: RelatedFile[],
        impact: ImpactSummary
    ): string[] {
        const suggestions: string[] = [];

        // 1. Review critical dependents
        const criticalFiles = relatedFiles.filter(f => f.priority === 'critical');
        if (criticalFiles.length > 0) {
            const file = criticalFiles[0];
            suggestions.push(`Review ${file.path} (${file.reason})`);
        }

        // 2. Run tests if impact is medium+
        if (impact.blast_radius !== 'small') {
            const testFiles = relatedFiles.filter(f => f.reason === 'tests');
            if (testFiles.length > 0) {
                suggestions.push(`Run tests: npm test ${context.topic.replace(/ /g, '-')}`);
            } else {
                suggestions.push('WARN: No tests found - consider adding test coverage');
            }
        }

        // 3. Suggest related exploration
        if (context.confidence > 0.7) {
            suggestions.push(`Explore more: mantic "${context.topic}"`);
        }

        // 4. Check config if working on integrations
        if (context.topic.includes('payment') || context.topic.includes('integration')) {
            const configs = relatedFiles.filter(f => f.reason === 'configuration');
            if (configs.length > 0) {
                suggestions.push(`Verify config: ${configs[0].path}`);
            }
        }

        return suggestions.slice(0, 4);  // Max 4 suggestions
    }

    /**
     * Resolve import path to actual file
     */
    private resolveImport(importSource: string, importerPath: string, allFiles: string[]): string | null {
        // Skip external modules
        if (!importSource.startsWith('.') && !importSource.startsWith('@/')) {
            return null;
        }

        // Handle @ alias
        let resolvedSource = importSource;
        if (importSource.startsWith('@/')) {
            resolvedSource = importSource.replace('@/', 'src/');
        }

        // Resolve relative to importer
        const importerDir = path.dirname(importerPath);
        let candidatePath = path.join(importerDir, resolvedSource);

        // Try with extensions
        const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
        for (const ext of extensions) {
            const testPath = candidatePath + ext;
            if (allFiles.includes(testPath)) {
                return testPath;
            }
        }

        return null;
    }

    /**
     * Find test files for a given file
     */
    private findTestFiles(filepath: string, allFiles: string[]): string[] {
        const baseName = path.basename(filepath, path.extname(filepath));
        const dir = path.dirname(filepath);
        const tests: string[] = [];

        const patterns = [
            `${baseName}.test.`,
            `${baseName}.spec.`,
            `__tests__/${baseName}`,
        ];

        for (const file of allFiles) {
            if (patterns.some(p => file.includes(p))) {
                tests.push(file);
            }
        }

        return tests;
    }

    /**
     * Find config files related to a file
     */
    private findConfigFiles(filepath: string, allFiles: string[]): string[] {
        const configs: string[] = [];
        const dir = path.dirname(filepath);

        const configPatterns = ['.env', 'config', 'setup'];

        for (const file of allFiles) {
            // Ensure directory boundary is respected (normalize for cross-platform)
            const normalizedDir = dir.replace(/\\/g, '/');
            const normalizedFile = file.replace(/\\/g, '/');
            if ((normalizedFile === normalizedDir || normalizedFile.startsWith(normalizedDir + '/')) && configPatterns.some(p => file.includes(p))) {
                configs.push(file);
            }
        }

        return configs.slice(0, 3);
    }
}
