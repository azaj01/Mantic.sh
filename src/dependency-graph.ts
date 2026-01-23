/**
 * Dependency Graph Builder
 * Lightweight import-based dependency analysis for impact assessment
 * Uses fast regex scanning (no AST parsing) for maximum speed
 */

import fs from 'fs/promises';
import path from 'path';

export interface ImportStatement {
    source: string;      // e.g., './Button', 'react', '@/utils/auth'
    importedNames: string[];  // e.g., ['Button', 'ButtonProps']
    isDefault: boolean;
    isDynamic: boolean;  // import() vs static import
    line: number;
}

export interface FileNode {
    path: string;
    imports: ImportStatement[];
    exports: string[];  // Exported names (quick heuristic)
    dependents: string[];  // Files that import this file
}

export interface DependencyGraph {
    nodes: Map<string, FileNode>;
    reverseLookup: Map<string, Set<string>>;  // source -> [files that import it]
}

/**
 * Extract imports from a file using fast regex (no AST parsing)
 * Matches:
 * - import X from 'Y'
 * - import { A, B } from 'Y'
 * - const X = require('Y')
 * - import('Y') - dynamic imports
 */
export async function extractImports(filepath: string, cwd: string): Promise<ImportStatement[]> {
    try {
        const fullPath = path.join(cwd, filepath);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const imports: ImportStatement[] = [];

        // Regex patterns for different import styles
        const patterns = [
            // ES6 imports: import X from 'Y'
            /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
            // ES6 named imports: import { A, B } from 'Y'
            /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/g,
            // ES6 namespace: import * as X from 'Y'
            /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
            // CommonJS: const X = require('Y')
            /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/g,
            // Dynamic imports: import('Y')
            /import\(['"]([^'"]+)['"]\)/g,
        ];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // Skip comments
            if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) {
                continue;
            }

            // Match ES6 default import
            const defaultMatch = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/.exec(line);
            if (defaultMatch) {
                imports.push({
                    source: defaultMatch[2],
                    importedNames: [defaultMatch[1]],
                    isDefault: true,
                    isDynamic: false,
                    line: lineNum + 1
                });
                continue;
            }

            // Match ES6 named imports
            const namedMatch = /import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/.exec(line);
            if (namedMatch) {
                const names = namedMatch[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]);
                imports.push({
                    source: namedMatch[2],
                    importedNames: names,
                    isDefault: false,
                    isDynamic: false,
                    line: lineNum + 1
                });
                continue;
            }

            // Match ES6 star (namespace) import
            if (line.trim().startsWith('import * as')) {
                const starMatch = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/.exec(line);
                if (starMatch) {
                    imports.push({
                        source: starMatch[2],
                        importedNames: [starMatch[1]],
                        isDefault: false,
                        isDynamic: false,
                        line: lineNum + 1
                    });
                    continue;
                }
            }

            // Match dynamic imports
            const dynamicMatch = /import\(['"]([^'"]+)['"]\)/.exec(line);
            if (dynamicMatch) {
                imports.push({
                    source: dynamicMatch[1],
                    importedNames: [],
                    isDefault: false,
                    isDynamic: true,
                    line: lineNum + 1
                });
                continue;
            }

            // Match CommonJS require
            const requireMatch = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\(['"]([^'"]+)['"]\)/.exec(line);
            if (requireMatch) {
                const names = requireMatch[1]
                    ? requireMatch[1].split(',').map(n => n.trim())
                    : [requireMatch[2]];
                imports.push({
                    source: requireMatch[3],
                    importedNames: names,
                    isDefault: !requireMatch[1],
                    isDynamic: false,
                    line: lineNum + 1
                });
                continue;
            }

            // Python imports
            if (filepath.endsWith('.py')) {
                // from module import name
                const fromImportMatch = /^from\s+([\w\.]+)\s+import\s+(.+)$/.exec(line.trim());
                if (fromImportMatch) {
                    const source = fromImportMatch[1];
                    const names = fromImportMatch[2].split(',').map(n => n.trim().split(/\s+as\s+/)[0]);
                    imports.push({
                        source,
                        importedNames: names,
                        isDefault: false,
                        isDynamic: false,
                        line: lineNum + 1
                    });
                    continue;
                }

                // import module
                const importMatch = /^import\s+([\w\.]+)/.exec(line.trim());
                if (importMatch) {
                    imports.push({
                        source: importMatch[1],
                        importedNames: [], // Import entire module
                        isDefault: true,
                        isDynamic: false,
                        line: lineNum + 1
                    });
                    continue;
                }
            }
        }

        return imports;
    } catch (error) {
        // File might not exist or not be readable
        return [];
    }
}

/**
 * Extract exports from a file using fast regex
 * Matches:
 * - export function X
 * - export const X
 * - export class X
 * - export default X
 * - module.exports = X
 */
export async function extractExports(filepath: string, cwd: string): Promise<string[]> {
    try {
        const fullPath = path.join(cwd, filepath);
        const content = await fs.readFile(fullPath, 'utf-8');
        const exports: string[] = [];

        // Match export statements
        const exportPatterns = [
            /export\s+(?:async\s+)?function\s+(\w+)/g,
            /export\s+const\s+(\w+)/g,
            /export\s+let\s+(\w+)/g,
            /export\s+class\s+(\w+)/g,
            /export\s+interface\s+(\w+)/g,
            /export\s+type\s+(\w+)/g,
            /export\s+\{\s*([^}]+)\s*\}/g,  // export { A, B }
            /export\s+default\s+(?:function\s+)?(\w+)?/g,
        ];

        for (const pattern of exportPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1]) {
                    // Handle export { A, B } case
                    if (match[0].includes('{')) {
                        const names = match[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]);
                        exports.push(...names);
                    } else {
                        exports.push(match[1]);
                    }
                }
            }
        }

        // Check for default export
        if (/export\s+default/.test(content)) {
            exports.push('default');
        }

        return [...new Set(exports)];  // Deduplicate
    } catch (error) {
        return [];
    }
}

/**
 * Resolve import source to actual file path
 * Handles:
 * - Relative imports: ./Button, ../utils/auth
 * - Alias imports: @/components/Button
 * - Node modules: react, lodash (returns as-is)
 * - TypeScript .js imports: ./types.js → types.ts
 */
export function resolveImportPath(
    importSource: string,
    importerPath: string,
    allFiles: string[],
    cwd: string
): string | null {
    // External module (node_modules)
    if (!importSource.startsWith('.') && !importSource.startsWith('@/')) {
        return null;  // Ignore external dependencies
    }

    // Handle @ alias (common in Next.js, Vite, etc.)
    let resolvedSource = importSource;
    if (importSource.startsWith('@/')) {
        resolvedSource = importSource.replace('@/', 'src/');
    }

    // Resolve relative to importer
    const importerDir = path.dirname(importerPath);
    let candidatePath = path.join(importerDir, resolvedSource);

    // Strip existing extension for TypeScript module resolution
    // e.g., './types.js' should try 'types.ts'
    const currentExt = path.extname(candidatePath);
    if (currentExt) {
        candidatePath = candidatePath.slice(0, -currentExt.length);
    }

    // Try with common extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', ''];
    const indexFiles = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

    for (const ext of extensions) {
        const testPath = candidatePath + ext;
        if (allFiles.includes(testPath)) {
            return testPath;
        }
    }

    // Try index files for directory imports
    for (const indexFile of indexFiles) {
        const testPath = candidatePath + indexFile;
        if (allFiles.includes(testPath)) {
            return testPath;
        }
    }

    return null;  // Could not resolve
}

/**
 * Build dependency graph for a set of files
 * Fast: parallel I/O + regex-based parsing
 */
export async function buildDependencyGraph(
    files: string[],
    cwd: string,
    maxConcurrency: number = 50
): Promise<DependencyGraph> {
    const nodes = new Map<string, FileNode>();
    const reverseLookup = new Map<string, Set<string>>();

    // Process files in batches
    for (let i = 0; i < files.length; i += maxConcurrency) {
        const batch = files.slice(i, i + maxConcurrency);

        const results = await Promise.all(
            batch.map(async (filepath) => {
                const imports = await extractImports(filepath, cwd);
                const exports = await extractExports(filepath, cwd);

                return { filepath, imports, exports };
            })
        );

        // Build nodes
        for (const { filepath, imports, exports } of results) {
            nodes.set(filepath, {
                path: filepath,
                imports,
                exports,
                dependents: []
            });
        }
    }

    // Build reverse lookup (who imports each file)
    for (const [filepath, node] of nodes.entries()) {
        for (const imp of node.imports) {
            const resolved = resolveImportPath(imp.source, filepath, files, cwd);
            if (resolved) {
                if (!reverseLookup.has(resolved)) {
                    reverseLookup.set(resolved, new Set());
                }
                reverseLookup.get(resolved)!.add(filepath);
            }
        }
    }

    // Populate dependents in nodes
    for (const [filepath, dependentSet] of reverseLookup.entries()) {
        const node = nodes.get(filepath);
        if (node) {
            node.dependents = Array.from(dependentSet);
        }
    }

    return { nodes, reverseLookup };
}

/**
 * Calculate import rank (PageRank-like) for files
 * Returns a map of filepath -> rank (0-100)
 * Files imported by many others get higher ranks
 */
export function calculateImportRanks(graph: DependencyGraph): Map<string, number> {
    const ranks = new Map<string, number>();

    // Count dependents for each file
    const dependentCounts: Array<[string, number]> = [];
    for (const [filepath, dependents] of graph.reverseLookup.entries()) {
        dependentCounts.push([filepath, dependents.size]);
    }

    if (dependentCounts.length === 0) {
        return ranks;
    }

    // Find max for normalization
    const maxDependents = Math.max(...dependentCounts.map(([_, count]) => count));

    // Normalize to 0-100 scale
    for (const [filepath, count] of dependentCounts) {
        const normalizedRank = Math.round((count / maxDependents) * 100);
        ranks.set(filepath, normalizedRank);
    }

    return ranks;
}

/**
 * Quick import rank calculation without full graph build
 * Uses cached index or fast regex scan
 */
export async function getQuickImportRanks(
    files: string[],
    cwd: string
): Promise<Map<string, number>> {
    const importCounts = new Map<string, number>();

    // Only scan code files
    const codeFiles = files.filter(f =>
        f.endsWith('.ts') || f.endsWith('.tsx') ||
        f.endsWith('.js') || f.endsWith('.jsx') ||
        f.endsWith('.py')
    );

    // Limit to first 1000 files for speed
    const filesToScan = codeFiles.slice(0, 1000);

    for (const filepath of filesToScan) {
        try {
            const imports = await extractImports(filepath, cwd);
            for (const imp of imports) {
                const resolved = resolveImportPath(imp.source, filepath, files, cwd);
                if (resolved) {
                    importCounts.set(resolved, (importCounts.get(resolved) || 0) + 1);
                }
            }
        } catch {
            // Skip files that can't be read
        }
    }

    // Normalize to 0-100
    const ranks = new Map<string, number>();
    if (importCounts.size === 0) return ranks;

    const maxCount = Math.max(...importCounts.values());
    for (const [filepath, count] of importCounts.entries()) {
        ranks.set(filepath, Math.round((count / maxCount) * 100));
    }

    return ranks;
}
