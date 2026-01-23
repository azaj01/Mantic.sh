/**
 * Semantic Scorer - Neural reranking for improved search relevance
 *
 * Uses a lightweight sentence transformer model to rerank search results
 * based on semantic similarity between the query and file content summaries.
 *
 * Model: all-MiniLM-L6-v2 (quantized) - ~25MB, runs locally via ONNX
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Model configuration
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const CACHE_DIR = path.join(os.homedir(), '.mantic', 'models');

interface FileCandidate {
    path: string;
    score: number;
}

interface RankedFile extends FileCandidate {
    semanticScore: number;
    combinedScore: number;
}

export class SemanticScorer {
    private pipeline: any = null;
    private isInitializing = false;
    private initPromise: Promise<void> | null = null;

    /**
     * Ensure the model is downloaded and loaded
     * Downloads to ~/.mantic/models/ on first use
     */
    async ensureModel(): Promise<void> {
        // Check initPromise first as the atomic guard to prevent race conditions
        if (this.initPromise) {
            return this.initPromise;
        }

        // If pipeline is already initialized, return immediately
        if (this.pipeline) {
            this.initPromise = Promise.resolve();
            return this.initPromise;
        }

        // Assign initPromise immediately before any async work to prevent duplicates
        this.initPromise = this._initModel().catch((error) => {
            // Clear initPromise on failure so retry is possible
            this.initPromise = null;
            throw error;
        });
        return this.initPromise;
    }

    private async _initModel(): Promise<void> {
        if (this.isInitializing) return;
        this.isInitializing = true;

        try {
            // Ensure cache directory exists
            await fs.mkdir(CACHE_DIR, { recursive: true });

            // Dynamic import to avoid loading transformers.js until needed
            const { pipeline, env } = await import('@xenova/transformers');

            // Configure cache location
            env.cacheDir = CACHE_DIR;
            env.allowLocalModels = true;
            env.allowRemoteModels = true;

            // Check if model exists locally
            const modelPath = path.join(CACHE_DIR, MODEL_NAME.replace('/', '_'));
            const modelExists = await this.checkModelExists(modelPath);

            if (!modelExists) {
                process.stderr.write('Initializing neural engine (one-time download)...\n');
            }

            // Load the feature extraction pipeline
            this.pipeline = await pipeline('feature-extraction', MODEL_NAME, {
                quantized: true,
                progress_callback: modelExists ? undefined : (progress: any) => {
                    if (progress.status === 'downloading') {
                        const pct = Math.round((progress.loaded / progress.total) * 100);
                        process.stderr.write(`\rDownloading model: ${pct}%`);
                    }
                }
            });

            if (!modelExists) {
                process.stderr.write('\rNeural engine ready.                    \n');
            }
        } catch (error) {
            this.isInitializing = false;
            this.initPromise = null;
            throw error;
        }
    }

    private async checkModelExists(modelPath: string): Promise<boolean> {
        try {
            await fs.access(modelPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Generate embeddings for a list of texts
     */
    async embed(texts: string[]): Promise<number[][]> {
        await this.ensureModel();

        const embeddings: number[][] = [];

        for (const text of texts) {
            // Truncate long texts to avoid memory issues
            const truncated = text.slice(0, 512);
            const output = await this.pipeline(truncated, {
                pooling: 'mean',
                normalize: true
            });
            embeddings.push(Array.from(output.data));
        }

        return embeddings;
    }

    /**
     * Calculate cosine similarity between two vectors
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        return denominator === 0 ? 0 : dotProduct / denominator;
    }

    /**
     * Extract a content summary from a file for embedding
     * Uses first N lines + exports/function names if available
     */
    private async getFileSummary(filepath: string, projectRoot: string): Promise<string> {
        try {
            const fullPath = path.join(projectRoot, filepath);
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split(/\r?\n/);

            // Take first 20 lines (usually imports + main logic start)
            const head = lines.slice(0, 20).join('\n');

            // Extract function/class names for additional context
            const functionNames: string[] = [];
            const patterns = [
                /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
                /(?:export\s+)?class\s+(\w+)/g,
                /(?:export\s+)?const\s+(\w+)\s*=/g,
                /def\s+(\w+)\s*\(/g,  // Python
                /func\s+(\w+)\s*\(/g, // Go
            ];

            for (const pattern of patterns) {
                pattern.lastIndex = 0; // Reset state for reuse
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    functionNames.push(match[1]);
                }
            }

            // Combine filename + head + function names
            const filename = path.basename(filepath);
            const summary = `${filename}\n${head}\n${functionNames.join(' ')}`;

            return summary.slice(0, 1000); // Limit total length
        } catch {
            // If file can't be read, use filename only
            return path.basename(filepath);
        }
    }

    /**
     * Rerank files based on semantic similarity to the query
     *
     * @param query - The search query
     * @param files - Top N files from heuristic search
     * @param projectRoot - Project root directory
     * @returns Files with semantic scores, sorted by combined score
     */
    async rerank(
        query: string,
        files: FileCandidate[],
        projectRoot: string
    ): Promise<RankedFile[]> {
        if (files.length === 0) return [];

        await this.ensureModel();

        // Get file summaries
        const summaries = await Promise.all(
            files.map(f => this.getFileSummary(f.path, projectRoot))
        );

        // Generate embeddings
        const queryEmbedding = (await this.embed([query]))[0];
        const fileEmbeddings = await this.embed(summaries);

        // Calculate semantic scores
        const rankedFiles: RankedFile[] = files.map((file, i) => {
            const semanticScore = this.cosineSimilarity(queryEmbedding, fileEmbeddings[i]);

            // Normalize heuristic score to 0-1 range (assuming max ~10000)
            const normalizedHeuristic = Math.min(file.score / 10000, 1);

            // Combined score: 60% heuristic + 40% semantic
            // Heuristic is still important for structural matches
            const combinedScore = (normalizedHeuristic * 0.6) + (semanticScore * 0.4);

            return {
                path: file.path,
                score: file.score,
                semanticScore: Math.round(semanticScore * 1000) / 1000,
                combinedScore: Math.round(combinedScore * 1000) / 1000
            };
        });

        // Sort by combined score
        rankedFiles.sort((a, b) => b.combinedScore - a.combinedScore);

        return rankedFiles;
    }

    /**
     * Check if semantic scoring is available
     * Returns false if transformers.js is not installed
     */
    static async isAvailable(): Promise<boolean> {
        try {
            await import('@xenova/transformers');
            return true;
        } catch {
            return false;
        }
    }
}
