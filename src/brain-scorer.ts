/**
 * Mantic Engine v2
 * High-performance, structural code search engine.
 * 
 * Key Features:
 * 1. Soft AND Filtering (Penalty-based)
 * 2. Pre-computed Index (Zero allocation in hot path)
 * 3. Structural Awareness (Filename == Parent Directory)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { IntentAnalysis, CacheIndex, FileScore } from './types.js';

interface FileEntry {
    original: string;
    lower: string;
    normalized: string;  // Separator-normalized version for fuzzy matching
    fileName: string;
    fileNameLower: string;
    fileNameNormalized: string;  // Normalized filename
    parentDirLower: string;
    parentDirNormalized: string;  // Normalized parent directory
    pathParts: string[];  // All path components (for path matching)
    ext: string;
    depth: number;
}

interface SearchResult {
    file: string;
    score: number;
    matchType: 'exact' | 'filename' | 'fuzzy';
}

const EXTENSION_WEIGHTS: Record<string, number> = {
    '.ts': 20, '.tsx': 20, '.js': 15, '.jsx': 15,
    '.rs': 20, '.go': 20, '.py': 15,
    '.prisma': 15, '.graphql': 10,
    '.css': 5, '.json': 5, '.md': 2
};

// Definition vs Usage Patterns
// Prioritize files that define things over files that use them
const DEFINITION_PATTERNS = [
    /\.model\./i,
    /\.schema\./i,
    /\.entity\./i,
    /\.type\./i,
    /\.interface\./i,
    /\/models\//i,
    /\/schemas\//i,
    /\/entities\//i,
];

const IMPLEMENTATION_PATTERNS = [
    /\.service\./i,
    /\.controller\./i,
    /\.handler\./i,
    /\.manager\./i,
    /\/services\//i,
    /\/controllers\//i,
];

const TEST_PATTERNS = [
    /\.test\./i,
    /\.spec\./i,
    /\.e2e\./i,
    /\/tests?\//i,
    /__tests__/i,
];

export class ManticEngine {
    private index: FileEntry[] = [];
    private cache: CacheIndex | null = null;
    private extensionRegex: RegExp;

    constructor(cache?: CacheIndex) {
        this.cache = cache || null;

        // Build dynamic extension regex from EXTENSION_WEIGHTS
        // Sort by length descending so longer extensions match first
        const extensions = Object.keys(EXTENSION_WEIGHTS)
            .map(ext => ext.slice(1)) // Remove leading dot
            .sort((a, b) => b.length - a.length);
        const alts = extensions.join('|');
        this.extensionRegex = new RegExp(`\\.(${alts})\\b`, 'i');
    }

    /**
     * Builds the search index from a list of file paths.
     * This moves expensive string operations out of the search loop.
     */
    buildIndex(filePaths: string[]) {
        this.index = filePaths.map(p => {
            const parts = p.split(/[/\\]/);
            const fileName = parts[parts.length - 1];
            // Get parent directory (if exists), otherwise empty
            const parentDir = parts.length > 1 ? parts[parts.length - 2] : '';
            const lower = p.toLowerCase();

            return {
                original: p,
                lower: lower,
                normalized: this.normalizeSeparators(lower),
                fileName: fileName,
                fileNameLower: fileName.toLowerCase(),
                fileNameNormalized: this.normalizeSeparators(fileName.toLowerCase()),
                parentDirLower: parentDir.toLowerCase(),
                parentDirNormalized: this.normalizeSeparators(parentDir.toLowerCase()),
                pathParts: parts.map(part => part.toLowerCase()),
                ext: fileName.includes('.') ? '.' + fileName.split('.').pop()! : '',
                depth: parts.length
            };
        });
    }

    /**
     * Normalize separators for fuzzy matching
     * Treats underscores, hyphens, spaces, and CamelCase as equivalent
     * e.g., "v8_gc_controller" matches "v8 gc controller"
     * e.g., "ScriptController" matches "script controller"
     */
    private normalizeSeparators(text: string): string {
        // First, handle CamelCase: ScriptController → script controller
        const withSpacesFromCamel = text.replace(/([a-z])([A-Z])/g, '$1 $2');
        // Then normalize separators
        return withSpacesFromCamel.replace(/[-_\s]+/g, ' ');
    }

    /**
     * The hot path search function.
     * Optimized for V8 performance.
     */
    search(query: string, limit = 100): SearchResult[] {
        if (!query) return [];

        const queryTrimmed = query.trim();
        const queryNormalized = this.normalizeSeparators(queryTrimmed);  // Normalize FIRST (handles CamelCase)
        const queryLower = queryNormalized.toLowerCase();  // THEN lowercase
        const terms = queryLower.split(/\s+/).filter(Boolean);

        if (terms.length === 0) return [];

        const results: SearchResult[] = [];

        for (let i = 0; i < this.index.length; i++) {
            const entry = this.index[i];
            const score = this.scoreEntry(entry, terms, queryLower, queryTrimmed);

            if (score > 0) {
                results.push({
                    file: entry.original,
                    score,
                    matchType: score > 150 ? 'exact' : 'fuzzy'
                });
            }
        }

        return results
            .sort((a, b) => {
                // Primary Sort: Score (Descending)
                if (b.score !== a.score) return b.score - a.score;
                // Secondary Sort: Path Length (Ascending) - Shortest wins
                return a.file.length - b.file.length;
            })
            .slice(0, limit);
    }

    /**
     * Legacy compatibility method for process-request.ts
     * Maps the new search output to the old FileScore[] format
     */
    async rankFiles(
        files: string[],
        keywords: string[],
        intent: IntentAnalysis,
        projectRoot: string
    ): Promise<FileScore[]> {
        // Build index if not already built or file count mismatch
        if (this.index.length === 0 || this.index.length !== files.length) {
            this.buildIndex(files);
        }

        // Use original prompt to preserve query structure (e.g., "download_manager.cc" not ".cc download manager")
        const query = intent.originalPrompt || keywords.join(' ');
        const results = this.search(query);

        return results.map(r => ({
            path: r.file,
            score: r.score,
            reasons: r.matchType === 'exact' ? ['exact-match']
                : r.matchType === 'filename' ? ['filename-match']
                    : ['keyword-match']
        }));
    }

    private scoreEntry(entry: FileEntry, terms: string[], fullQueryLower: string, originalQuery: string): number {
        let score = 0;
        const normalizedQuery = this.normalizeSeparators(originalQuery).toLowerCase();

        // A0. DIRECTORY MATCH FOR SINGLE-TERM QUERIES (e.g., "gpu" matches files in gpu/ directory)
        // This handles acronyms and module names
        // Only apply if original query had no spaces and no CamelCase (is truly a single term)
        const isSingleTermQuery = !originalQuery.includes(' ') && originalQuery === originalQuery.toLowerCase();
        if (terms.length === 1 && isSingleTermQuery && terms[0].length <= 4) {
            // Check if any directory in path exactly matches the term
            const matchingDir = entry.pathParts.some(part => part === terms[0]);
            if (matchingDir) {
                score += 8000;  // High boost, but less than exact filename match
            }
        }

        // A. EXACT FULL FILENAME MATCH (with extension) - CHECK FIRST, HIGHEST PRIORITY
        // e.g., "download_manager.cc" should match EXACTLY
        if (entry.fileNameLower === fullQueryLower) {
            return 10000;  // Massive boost for exact filename match
        }

        // A2. EXACT NORMALIZED FILENAME MATCH (handles underscores/hyphens/CamelCase)
        // e.g., "DownloadManager.cc" matches "download_manager.cc"
        if (entry.fileNameNormalized === normalizedQuery) {
            return 9000;  // Very high boost for normalized match
        }

        // B. EXACT FILENAME WITHOUT EXTENSION
        // e.g., "download_manager" matches "download_manager.cc"
        const fileNameWithoutExt = entry.fileName.replace(/\.[^.]+$/, '').toLowerCase();
        const queryWithoutExt = fullQueryLower.replace(/\.[^.]+$/, '');
        if (fileNameWithoutExt === queryWithoutExt) {
            return 5000;  // Very high score for filename-only match
        }

        // C. EXTENSION FILTER: If query contains known extension, ONLY match that extension
        // (Checked AFTER exact matches so "download_manager.cc" can match exactly first)
        const queryExtMatch = originalQuery.match(this.extensionRegex);
        if (queryExtMatch) {
            const requestedExt = '.' + queryExtMatch[1].toLowerCase();
            if (entry.ext !== requestedExt) {
                return 0;  // Immediate disqualification if extension doesn't match
            }
            // Extension matches, continue scoring with extension removed from query
            // Note: terms are already computed without extension from search() method
            // Fall through to continue scoring
        }

        // D. INTERSECTION CHECK (Soft AND) - Use normalized for fuzzy matching
        // Add points for matches, penalize misses
        let termsmatched = 0;
        for (let i = 0; i < terms.length; i++) {
            if (entry.normalized.includes(terms[i])) {
                termsmatched++;
                score += 10; // Base points per match
            } else {
                score -= 50; // Heavy penalty for missing term
            }
        }

        // Base score adjustment (buffer against negative scores)
        score += 50;

        // D. PATH SEQUENCE MATCHING
        // If query contains slashes or multiple path-like terms, check if they appear in order
        // e.g., "v8 heap mark compact" should match "v8/src/heap/mark-compact.cc"
        const queryHasSlashes = originalQuery.includes('/');
        if (queryHasSlashes || terms.length >= 3) {
            let pathScore = 0;
            let lastMatchIndex = -1;
            let consecutiveMatches = 0;

            for (const term of terms) {
                // Find this term in path parts (prioritize exact directory/filename matches)
                let matchIndex = -1;
                let isExactMatch = false;

                for (let idx = 0; idx < entry.pathParts.length; idx++) {
                    if (idx <= lastMatchIndex) continue;

                    const part = entry.pathParts[idx];

                    // Exact match gets highest priority (e.g., "booking" matches directory "booking")
                    if (part === term) {
                        matchIndex = idx;
                        isExactMatch = true;
                        break;
                    }

                    // Word boundary matches (e.g., "dom" matches "dom_parser" or "dom-events")
                    if (matchIndex === -1 && (part.startsWith(term + '_') || part.startsWith(term + '-') ||
                        part.startsWith(term + '.'))) {
                        matchIndex = idx;
                        continue;
                    }

                    // For longer terms (4+ chars), allow substring matches
                    // This prevents "dom" from matching "random" or "freedom"
                    if (matchIndex === -1 && term.length >= 4 && part.includes(term)) {
                        matchIndex = idx;
                    }
                }

                if (matchIndex > lastMatchIndex) {
                    consecutiveMatches++;
                    let bonus = 25 * consecutiveMatches;
                    // Extra bonus for exact component matches in paths
                    if (isExactMatch) {
                        bonus += 10; // Reward exact directory/file matches in path
                    }
                    pathScore += bonus;
                    lastMatchIndex = matchIndex;
                } else {
                    consecutiveMatches = 0; // Reset if not consecutive
                }
            }

            score += pathScore;

            // BONUS: Perfect sequential path match
            // If all terms match consecutive path components in order, huge bonus
            // e.g., "apps web components booking" matches "apps/web/components/booking/file.tsx"
            if (consecutiveMatches === terms.length && terms.length >= 3) {
                // Check if they're truly consecutive (no gaps)
                let startIdx = -1;
                let allConsecutive = true;
                for (let i = 0; i < terms.length; i++) {
                    const idx = entry.pathParts.findIndex((part, pidx) =>
                        pidx > startIdx && part === terms[i]
                    );
                    if (idx === -1 || (startIdx !== -1 && idx !== startIdx + 1)) {
                        allConsecutive = false;
                        break;
                    }
                    startIdx = idx;
                }
                if (allConsecutive) {
                    score += 100; // Massive bonus for perfect sequential path
                }
            }
        }

        // E. STRUCTURAL SPECIFICITY
        // Reward matches in Filename and Parent Directory
        let termsInStructure = 0;
        for (const term of terms) {
            // Check filename with word boundaries to avoid false positives
            // "script" should match "script_controller" but not "javascript"
            const filenameWords = entry.fileNameNormalized.split(/[\s_\-\.]+/);
            const filenameHasTerm = filenameWords.some(word => word === term || word.startsWith(term));

            if (filenameHasTerm) {
                score += 30; // Filename match
                termsInStructure++;
            } else if (entry.parentDirLower === term) {
                // EXACT parent directory match (e.g., "gpu" matches directory "gpu/")
                score += 60; // Double bonus for exact directory match
                termsInStructure++;
            } else if (entry.parentDirNormalized.includes(term)) {
                score += 30; // Parent Dir substring match
                termsInStructure++;
            } else {
                score += 5; // Loose path match
            }
        }

        // Structural Bonus: All terms matched in high-value spots
        if (termsInStructure === terms.length) {
            score += 50;
        }

        // D. ADJACENCY BONUS (normalized)
        const normalizedQueryNoSpaces = normalizedQuery.replace(/\s/g, '');
        if (entry.normalized.replace(/\s/g, '').includes(normalizedQueryNoSpaces)) {
            score += 20;
        }

        // E. EXTENSION PRIORITIZATION
        score += (EXTENSION_WEIGHTS[entry.ext] || 0);

        // F. DEFINITION vs USAGE BOOSTING
        // Prioritize: Definition > Implementation > Tests
        const original = entry.original;

        // Check if it's a definition file (highest priority)
        if (DEFINITION_PATTERNS.some(pattern => pattern.test(original))) {
            score += 40; // Big boost for definition files
        }
        // Check if it's an implementation file (medium priority)
        else if (IMPLEMENTATION_PATTERNS.some(pattern => pattern.test(original))) {
            score += 20; // Moderate boost for service/controller files
        }
        // Penalize test files heavily (lowest priority)
        if (TEST_PATTERNS.some(pattern => pattern.test(original))) {
            score -= 60; // Heavy penalty - tests are usually noise in search
        }

        return Math.max(0, score);
    }
}
