/**
 * Mantic Search Worker
 * Handles a partition of the file system in a separate thread.
 */
import { parentPort, workerData } from 'worker_threads';
import { ManticEngine } from './brain-scorer.js';

// Receive file chunk from main thread
const filesChunk: string[] = workerData.files;

// Initialize engine for this chunk
const engine = new ManticEngine();
engine.buildIndex(filesChunk);

// Listen for search queries
if (parentPort) {
    parentPort.on('message', (task: { query: string; limit: number }) => {
        try {
            // Run search on local chunk
            const results = engine.search(task.query, task.limit);

            // Post back top results
            parentPort!.postMessage(results);
        } catch (error) {
            console.error('Worker search error:', error);
            parentPort!.postMessage([]);
        }
    });
}
