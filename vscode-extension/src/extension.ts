import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

interface ManticFile {
    path: string;
    relevanceScore: number;
    matchReasons: string[];
    metadata?: {
        lines?: number;
        estimatedTokens?: number;
        confidence?: number;
    };
}

interface ManticResult {
    query: string;
    files: ManticFile[];
    metadata: {
        totalScanned: number;
        filesReturned: number;
        timeMs: number;
    };
}

interface Definition {
    name: string;
    type: string;
    line: number;
    column: number;
    file: string;
}

interface Reference {
    name: string;
    line: number;
    column: number;
    file: string;
    context: string;
}

function getCliPath(): string {
    const config = vscode.workspace.getConfiguration('mantic');
    return config.get<string>('cliPath') || 'mantic';
}

function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new Error('No workspace folder open');
    }
    return folders[0].uri.fsPath;
}

const DEFAULT_TIMEOUT_MS = 60000;

async function runMantic(args: string[], cwd: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
    const cli = getCliPath();

    return new Promise((resolve, reject) => {
        const proc = spawn(cli, args, {
            cwd,
            shell: false,
            env: { ...process.env }
        });

        let stdout = '';
        let stderr = '';

        const timeout = setTimeout(() => {
            proc.kill();
            reject(new Error(`Mantic command timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr || `Mantic exited with code ${code}`));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

export function activate(context: vscode.ExtensionContext) {
    // Search command
    const searchCommand = vscode.commands.registerCommand('mantic.search', async () => {
        const query = await vscode.window.showInputBox({
            prompt: 'Enter search query',
            placeHolder: 'e.g., user authentication, payment handler'
        });

        if (!query) return;

        try {
            const cwd = getWorkspaceRoot();
            const output = await runMantic([query, '--json', '--fast'], cwd);
            const result: ManticResult = JSON.parse(output);
            await showSearchResults(result, cwd);
        } catch (error) {
            vscode.window.showErrorMessage(`Mantic search failed: ${error}`);
        }
    });

    // Semantic search command
    const searchSemanticCommand = vscode.commands.registerCommand('mantic.searchSemantic', async () => {
        const query = await vscode.window.showInputBox({
            prompt: 'Enter search query (semantic)',
            placeHolder: 'e.g., verify user identity, handle payments'
        });

        if (!query) return;

        try {
            const cwd = getWorkspaceRoot();

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Mantic Semantic Search',
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Searching...' });
                const output = await runMantic([query, '--json', '--semantic'], cwd);
                const result: ManticResult = JSON.parse(output);
                await showSearchResults(result, cwd);
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Mantic semantic search failed: ${error}`);
        }
    });

    // Definitions command
    const definitionsCommand = vscode.commands.registerCommand('mantic.definitions', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No file open');
            return;
        }

        try {
            const cwd = getWorkspaceRoot();
            const relativePath = path.relative(cwd, editor.document.uri.fsPath);
            const output = await runMantic(['definitions', relativePath, '--json'], cwd);
            const definitions: Definition[] = JSON.parse(output);

            if (definitions.length === 0) {
                vscode.window.showInformationMessage('No definitions found');
                return;
            }

            const items = definitions.map(d => ({
                label: `$(symbol-${getSymbolIcon(d.type)}) ${d.name}`,
                description: `${d.type} at line ${d.line}`,
                definition: d
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a definition to jump to'
            });

            if (selected) {
                const uri = vscode.Uri.file(path.join(cwd, selected.definition.file));
                const position = new vscode.Position(selected.definition.line - 1, selected.definition.column);
                const doc = await vscode.workspace.openTextDocument(uri);
                const ed = await vscode.window.showTextDocument(doc);
                ed.selection = new vscode.Selection(position, position);
                ed.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to get definitions: ${error}`);
        }
    });

    // References command
    const referencesCommand = vscode.commands.registerCommand('mantic.references', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No file open');
            return;
        }

        const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
        const word = wordRange ? editor.document.getText(wordRange) : '';

        const symbol = await vscode.window.showInputBox({
            prompt: 'Enter symbol name',
            value: word,
            placeHolder: 'e.g., UserService, handleLogin'
        });

        if (!symbol) return;

        try {
            const cwd = getWorkspaceRoot();

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Finding references to "${symbol}"`,
                cancellable: false
            }, async () => {
                const output = await runMantic(['references', symbol, '--json'], cwd);
                const references: Reference[] = JSON.parse(output);

                if (references.length === 0) {
                    vscode.window.showInformationMessage(`No references found for "${symbol}"`);
                    return;
                }

                const items = references.slice(0, 50).map(r => ({
                    label: `${path.basename(r.file)}:${r.line}`,
                    description: r.file,
                    detail: r.context,
                    reference: r
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `${references.length} references found`
                });

                if (selected) {
                    const uri = vscode.Uri.file(path.join(cwd, selected.reference.file));
                    const position = new vscode.Position(selected.reference.line - 1, selected.reference.column);
                    const doc = await vscode.workspace.openTextDocument(uri);
                    const ed = await vscode.window.showTextDocument(doc);
                    ed.selection = new vscode.Selection(position, position);
                    ed.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to find references: ${error}`);
        }
    });

    // Go to definition command
    const gotoCommand = vscode.commands.registerCommand('mantic.goto', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No file open');
            return;
        }

        const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
        const word = wordRange ? editor.document.getText(wordRange) : '';

        const symbol = await vscode.window.showInputBox({
            prompt: 'Enter symbol name',
            value: word,
            placeHolder: 'e.g., UserService, handleLogin'
        });

        if (!symbol) return;

        try {
            const cwd = getWorkspaceRoot();
            const output = await runMantic(['goto', symbol, '--json'], cwd);
            const result = JSON.parse(output);
            const definition: Definition | null = result.definition;

            if (!result.found || !definition) {
                vscode.window.showInformationMessage(`Definition not found for "${symbol}"`);
                return;
            }

            const uri = vscode.Uri.file(path.join(cwd, definition.file));
            const position = new vscode.Position(definition.line - 1, definition.column);
            const doc = await vscode.workspace.openTextDocument(uri);
            const ed = await vscode.window.showTextDocument(doc);
            ed.selection = new vscode.Selection(position, position);
            ed.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to go to definition: ${error}`);
        }
    });

    context.subscriptions.push(
        searchCommand,
        searchSemanticCommand,
        definitionsCommand,
        referencesCommand,
        gotoCommand
    );

    // Show activation message
    console.log('Mantic extension activated');
}

async function showSearchResults(result: ManticResult, cwd: string) {
    if (result.files.length === 0) {
        vscode.window.showInformationMessage('No results found');
        return;
    }

    const config = vscode.workspace.getConfiguration('mantic');
    const maxResults = config.get<number>('maxResults') || 20;

    const items = result.files.slice(0, maxResults).map(f => ({
        label: `$(file) ${path.basename(f.path)}`,
        description: path.dirname(f.path),
        detail: `Score: ${f.relevanceScore} | ${f.metadata?.lines || '?'} lines | ${f.matchReasons.join(', ')}`,
        file: f
    }));

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${result.files.length} files found (${result.metadata.timeMs}ms)`,
        matchOnDescription: true,
        matchOnDetail: true
    });

    if (selected) {
        const uri = vscode.Uri.file(path.join(cwd, selected.file.path));
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
    }
}

function getSymbolIcon(type: string): string {
    const icons: Record<string, string> = {
        'function': 'method',
        'method': 'method',
        'class': 'class',
        'interface': 'interface',
        'type': 'type-hierarchy',
        'variable': 'variable'
    };
    return icons[type] || 'symbol-misc';
}

export function deactivate() { }
