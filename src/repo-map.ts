/**
 * Repository Map Generator
 *
 * Generates an ASCII tree showing the architecture of a codebase,
 * highlighting hub files (imported by many) and entry points.
 */

import * as path from 'path';
import { buildDependencyGraph, calculateImportRanks, DependencyGraph } from './dependency-graph.js';
import { classifyProject } from './project-classifier.js';
import { getGitFiles } from './git-utils.js';

interface FileNode {
    name: string;
    path: string;
    children: Map<string, FileNode>;
    isFile: boolean;
    importRank: number;
    exports: number;
    imports: number;
}

interface MapOptions {
    maxDepth?: number;
    showRanks?: boolean;
    codeOnly?: boolean;
}

/**
 * Build a tree structure from file paths
 */
function buildTree(files: string[], importRanks: Map<string, number>, graph: DependencyGraph): FileNode {
    const root: FileNode = {
        name: '.',
        path: '.',
        children: new Map(),
        isFile: false,
        importRank: 0,
        exports: 0,
        imports: 0
    };

    for (const filePath of files) {
        const parts = filePath.split(/[/\\]/);
        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLast = i === parts.length - 1;
            const currentPath = parts.slice(0, i + 1).join('/');

            if (!current.children.has(part)) {
                const node = graph.nodes.get(filePath);
                current.children.set(part, {
                    name: part,
                    path: currentPath,
                    children: new Map(),
                    isFile: isLast,
                    importRank: isLast ? (importRanks.get(filePath) || 0) : 0,
                    exports: isLast && node ? node.exports.length : 0,
                    imports: isLast && node ? node.imports.length : 0
                });
            }
            current = current.children.get(part)!;
        }
    }

    return root;
}

/**
 * Get an indicator for file importance
 */
function getIndicator(node: FileNode): string {
    if (!node.isFile) return '';

    if (node.importRank >= 80) return ' ★★★';  // Top hub
    if (node.importRank >= 50) return ' ★★';   // Major hub
    if (node.importRank >= 20) return ' ★';    // Minor hub
    if (node.exports > 5) return ' ◆';         // Many exports
    return '';
}

/**
 * Render tree as ASCII
 */
function renderTree(
    node: FileNode,
    prefix: string = '',
    isLast: boolean = true,
    depth: number = 0,
    maxDepth: number = 4,
    showRanks: boolean = true
): string[] {
    const lines: string[] = [];

    if (depth > maxDepth) return lines;

    // Skip root node display
    if (depth > 0) {
        const connector = isLast ? '└── ' : '├── ';
        const indicator = showRanks ? getIndicator(node) : '';
        lines.push(prefix + connector + node.name + indicator);
    }

    // Sort children: directories first, then by import rank, then alphabetically
    const children = Array.from(node.children.values()).sort((a, b) => {
        // Directories first
        if (!a.isFile && b.isFile) return -1;
        if (a.isFile && !b.isFile) return 1;
        // Then by import rank (descending)
        if (b.importRank !== a.importRank) return b.importRank - a.importRank;
        // Then alphabetically
        return a.name.localeCompare(b.name);
    });

    // Limit children shown per directory
    const maxChildren = 15;
    const visibleChildren = children.slice(0, maxChildren);
    const hiddenCount = children.length - maxChildren;

    for (let i = 0; i < visibleChildren.length; i++) {
        const child = visibleChildren[i];
        const isLastChild = i === visibleChildren.length - 1 && hiddenCount <= 0;
        const newPrefix = depth === 0 ? '' : prefix + (isLast ? '    ' : '│   ');

        lines.push(...renderTree(child, newPrefix, isLastChild, depth + 1, maxDepth, showRanks));
    }

    if (hiddenCount > 0) {
        const newPrefix = depth === 0 ? '' : prefix + (isLast ? '    ' : '│   ');
        lines.push(newPrefix + `└── ... and ${hiddenCount} more`);
    }

    return lines;
}

/**
 * Generate repository map
 */
export async function generateRepoMap(cwd: string, options: MapOptions = {}): Promise<string> {
    const maxDepth = options.maxDepth ?? 4;
    const showRanks = options.showRanks ?? true;
    const codeOnly = options.codeOnly ?? true;

    // Get files
    let files = getGitFiles(cwd);
    if (files.length === 0) {
        return 'No files found. Is this a git repository?';
    }

    // Filter to code files if requested
    if (codeOnly) {
        const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.php']);
        files = files.filter(f => {
            const ext = path.extname(f).toLowerCase();
            return codeExtensions.has(ext);
        });
    }

    // Limit file count for performance
    if (files.length > 5000) {
        files = files.slice(0, 5000);
    }

    // Build dependency graph
    const graph = await buildDependencyGraph(files, cwd);
    const importRanks = calculateImportRanks(graph);

    // Build tree
    const tree = buildTree(files, importRanks, graph);

    // Classify project
    const projectInfo = classifyProject(files, '');

    // Generate header
    const header = [
        `Repository: ${path.basename(cwd)}`,
        `Type: ${projectInfo.projectType}`,
        `Files: ${files.length} code files`,
        '',
        'Legend: ★★★ = Top Hub (80%+) | ★★ = Major Hub (50%+) | ★ = Minor Hub (20%+) | ◆ = Many Exports',
        ''
    ];

    // Render tree
    const treeLines = renderTree(tree, '', true, 0, maxDepth, showRanks);

    // Find top hubs
    const topHubs = Array.from(importRanks.entries())
        .filter(([_, rank]) => rank >= 50)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    const hubSection = topHubs.length > 0 ? [
        '',
        '─'.repeat(50),
        'Top Hub Files (imported by many):',
        ...topHubs.map(([file, rank]) => `  ${rank}% │ ${file}`)
    ] : [];

    return [...header, ...treeLines, ...hubSection].join('\n');
}
