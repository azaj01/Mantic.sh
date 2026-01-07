/**
 * Parallel Mantic Engine Manager
 * Orchestrates multiple worker threads for large-scale repo search.
 */
import { Worker } from 'worker_threads';
import * as os from 'os';
import * as path from 'path';
// ESM compatibility not needed for CommonJS
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

interface SearchResult {
    file: string;
    score: number;
    matchType: 'exact' | 'filename' | 'fuzzy';
}

export class ParallelMantic {
    private workers: Worker[] = [];
    public active = false;

    constructor(allFiles: string[]) {
        this.initWorkers(allFiles);
    }

    private initWorkers(allFiles: string[]) {
        const cpuCount = os.cpus().length || 4;
        // Leave 1 core free for main thread/UI
        const workerCount = Math.max(2, cpuCount - 1);

        const chunkSize = Math.ceil(allFiles.length / workerCount);

        for (let i = 0; i < workerCount; i++) {
            const start = i * chunkSize;
            const end = start + chunkSize;
            const chunk = allFiles.slice(start, end);

            if (chunk.length === 0) continue;

            const worker = new Worker(path.resolve(__dirname, './search.worker.js'), {
                workerData: { files: chunk }
            });

            this.workers.push(worker);
        }
        this.active = true;
    }

    async search(query: string, limit = 50): Promise<SearchResult[]> {
        if (!query) return [];

        // Broadcast query to all workers
        const promises = this.workers.map(worker => {
            return new Promise<SearchResult[]>((resolve, reject) => {
                worker.once('message', (results: SearchResult[]) => resolve(results));
                worker.once('error', reject);
                worker.postMessage({ query, limit });
            });
        });

        // Wait for all chunks to return their Top N
        const resultsArrays = await Promise.all(promises);

        // Flatten and Final Sort
        const merged = resultsArrays.flat();

        return merged
            .sort((a, b) => {
                // Primary Sort: Score (Descending)
                if (b.score !== a.score) return b.score - a.score;
                // Secondary Sort: Path Length (Ascending)
                return a.file.length - b.file.length;
            })
            .slice(0, limit);
    }

    terminate() {
        this.workers.forEach(w => w.terminate());
        this.active = false;
        this.workers = [];
    }
}
