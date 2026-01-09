import { ContextResult } from './types.js';
import chalk from 'chalk';

/**
 * Format context result as JSON (for programmatic access)
 */
export function formatAsJSON(context: ContextResult): string {
    return JSON.stringify(context, null, 2);
}

/**
 * Format context result as simple file list (for piping)
 */
export function formatAsFileList(context: ContextResult): string {
    return context.files.map(f => f.path).join('\n');
}

/**
 * Format context result as Markdown (for documentation)
 */
export function formatAsMarkdown(context: ContextResult): string {
    const lines: string[] = [];

    lines.push(`# Context for: "${context.query}"`);
    lines.push('');

    // Intent section
    lines.push(`## Intent: ${context.intent.category}`);
    lines.push(`**Confidence**: ${Math.round(context.intent.confidence * 100)}%`);
    lines.push(`**Keywords**: ${context.intent.keywords.join(', ')}`);
    lines.push('');

    // Files section
    lines.push(`## Relevant Files (${context.files.length})`);
    lines.push('');

    context.files.forEach((file, index) => {
        lines.push(`### ${index + 1}. \`${file.path}\``);
        lines.push(`**Score**: ${file.relevanceScore}`);
        lines.push(`**Why**: ${file.matchReasons.join(', ')}`);

        if (file.excerpts && file.excerpts.length > 0) {
            lines.push('');
            lines.push('**Relevant sections:**');
            file.excerpts.forEach(excerpt => {
                lines.push(`- Line ${excerpt.line}: \`${excerpt.content}\``);
            });
        }
        lines.push('');
    });

    // Metadata section
    lines.push('## Project Metadata');
    lines.push(`- **Type**: ${context.metadata.projectType}`);
    lines.push(`- **Tech Stack**: ${context.metadata.techStack}`);
    lines.push(`- **Scanned**: ${context.metadata.totalScanned} files in ${context.metadata.timeMs}ms`);

    if (context.gitState) {
        lines.push('');
        lines.push('## Git Changes');
        lines.push('```');
        lines.push(context.gitState);
        lines.push('```');
    }

    return lines.join('\n');
}

/**
 * Format context result for MCP (Model Context Protocol)
 */
export function formatAsMCP(context: ContextResult): any {
    return {
        type: 'resource',
        resource: {
            uri: `mantic://context/${encodeURIComponent(context.query)}`,
            name: context.query,
            mimeType: 'application/json',
            text: JSON.stringify({
                query: context.query,
                intent: context.intent,
                files: context.files.map(f => ({
                    path: f.path,
                    relevance: f.relevanceScore,
                    reasons: f.matchReasons,
                    excerpts: f.excerpts
                })),
                metadata: context.metadata
            }, null, 2)
        }
    };
}

/**
 * Format context result for human-readable terminal output (compact)
 */
export function formatForTerminal(context: ContextResult, showExcerpts: boolean = true): string {
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push(chalk.cyan('Context Result'));
    lines.push(chalk.dim('⎿') + ' ' + chalk.gray(`Query: "${context.query}"`));
    lines.push(chalk.dim('⎿') + ' ' + chalk.gray(`Intent: ${context.intent.category} (${Math.round(context.intent.confidence * 100)}% confidence)`));
    lines.push('');

    // Files
    lines.push(chalk.cyan(`Relevant Files (${context.files.length})`));
    context.files.slice(0, 15).forEach((file, index) => {
        const score = file.relevanceScore;
        const scoreColor = score > 100 ? chalk.green : score > 50 ? chalk.yellow : chalk.dim;

        lines.push(chalk.dim('⎿') + '  ' + chalk.bold(file.path) + ' ' + scoreColor(`(${score})`));

        if (showExcerpts && file.excerpts && file.excerpts.length > 0) {
            file.excerpts.slice(0, 2).forEach(excerpt => {
                const preview = excerpt.content.length > 60
                    ? excerpt.content.substring(0, 60) + '...'
                    : excerpt.content;
                lines.push(chalk.dim('    ⎿') + ' ' + chalk.dim(`L${excerpt.line}: ${preview}`));
            });
        }
    });

    if (context.files.length > 15) {
        lines.push(chalk.dim(`... and ${context.files.length - 15} more files`));
    }

    lines.push('');

    // Metadata
    lines.push(chalk.dim(`Scanned ${context.metadata.totalScanned} files in ${context.metadata.timeMs}ms`));
    lines.push('');

    return lines.join('\n');
}

/**
 * Format zero-query context (proactive context detection)
 */
export function formatZeroQueryContext(zeroContext: any): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(chalk.bold('Mantic Zero-Query Mode'));
    lines.push(chalk.gray('Proactive context detection - showing what you\'re working on'));
    lines.push('');

    // Working Context
    lines.push(chalk.white(`Working Context: ${zeroContext.context.topic}`));
    lines.push(chalk.dim('⎿') + ' ' + chalk.gray(`Confidence: ${Math.round(zeroContext.context.confidence * 100)}%`));
    if (zeroContext.context.evidence && zeroContext.context.evidence.length > 0) {
        zeroContext.context.evidence.forEach((ev: string) => {
            lines.push(chalk.dim('⎿') + ' ' + chalk.dim(ev));
        });
    }
    lines.push('');

    // Modified Files
    if (zeroContext.modified && zeroContext.modified.length > 0) {
        lines.push(chalk.yellow(`Recently Modified (${zeroContext.modified.length})`));
        zeroContext.modified.slice(0, 5).forEach((file: any) => {
            lines.push(chalk.dim('⎿') + '  ' + chalk.bold(file.path) + ' ' + chalk.yellow(`[${file.status}]`));
        });
        if (zeroContext.modified.length > 5) {
            lines.push(chalk.dim(`⎿  ... and ${zeroContext.modified.length - 5} more`));
        }
        lines.push('');
    }

    // Related Files
    if (zeroContext.related && zeroContext.related.length > 0) {
        lines.push(chalk.cyan(`Related Files (${zeroContext.related.length})`));
        zeroContext.related.slice(0, 10).forEach((file: any) => {
            const priorityColor = file.priority === 'critical' ? chalk.red
                : file.priority === 'high' ? chalk.yellow
                    : file.priority === 'medium' ? chalk.blue
                        : chalk.dim;
            lines.push(chalk.dim('⎿') + '  ' + file.path + ' ' + priorityColor(`[${file.priority}]`));
            lines.push(chalk.dim('     ⎿') + ' ' + chalk.dim(file.reason));
        });
        if (zeroContext.related.length > 10) {
            lines.push(chalk.dim(`⎿  ... and ${zeroContext.related.length - 10} more`));
        }
        lines.push('');
    }

    // Impact Analysis
    if (zeroContext.impact) {
        const radiusColor = zeroContext.impact.blast_radius === 'critical' ? chalk.red
            : zeroContext.impact.blast_radius === 'large' ? chalk.yellow
                : zeroContext.impact.blast_radius === 'medium' ? chalk.blue
                    : chalk.green;

        lines.push(chalk.white('Impact Analysis'));
        lines.push(chalk.dim('⎿') + ' ' + radiusColor(`Blast Radius: ${zeroContext.impact.blast_radius}`));
        lines.push(chalk.dim('⎿') + ' ' + chalk.gray(`Affected Files: ${zeroContext.impact.affected_files}`));
        lines.push(chalk.dim('⎿') + ' ' + chalk.gray(zeroContext.impact.risk_assessment));
        lines.push('');
    }

    // Suggestions
    if (zeroContext.suggestions && zeroContext.suggestions.next_steps && zeroContext.suggestions.next_steps.length > 0) {
        lines.push(chalk.cyan('Suggested Next Steps'));
        zeroContext.suggestions.next_steps.forEach((suggestion: string) => {
            lines.push(chalk.dim('⎿') + '  ' + chalk.white(suggestion));
        });
        lines.push('');
    }

    // Session Info
    if (zeroContext.session) {
        lines.push(chalk.dim(`Session: ${zeroContext.session.id} | Files tracked: ${zeroContext.session.files_tracked}`));
        if (zeroContext.session.auto_started) {
            lines.push(chalk.dim('(Session auto-started based on file activity)'));
        }
    }

    lines.push('');
    return lines.join('\n');
}
