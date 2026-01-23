/**
 * Code Intelligence - Tree-sitter based code analysis
 *
 * Provides definition and reference finding using Tree-sitter WASM parsers.
 * Parsers are downloaded to ~/.mantic/parsers/ on first use.
 *
 * Supported languages:
 * - Python
 * - TypeScript/JavaScript
 * - Go (planned)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Parser, Language, Tree, Node as SyntaxNode } from 'web-tree-sitter';

const PARSERS_DIR = path.join(os.homedir(), '.mantic', 'parsers');

// Tree-sitter WASM files from web-tree-sitter releases
const PARSER_URLS: Record<string, string> = {
    'python': 'https://cdn.jsdelivr.net/npm/tree-sitter-python@0.23.6/tree-sitter-python.wasm',
    'typescript': 'https://cdn.jsdelivr.net/npm/tree-sitter-typescript@0.23.2/tree-sitter-typescript.wasm',
    'tsx': 'https://cdn.jsdelivr.net/npm/tree-sitter-typescript@0.23.2/tree-sitter-tsx.wasm',
    'javascript': 'https://cdn.jsdelivr.net/npm/tree-sitter-javascript@0.23.1/tree-sitter-javascript.wasm',
};

export interface Definition {
    name: string;
    type: 'function' | 'class' | 'variable' | 'type' | 'method' | 'interface';
    line: number;
    column: number;
    endLine: number;
    file: string;
}

export interface Reference {
    name: string;
    line: number;
    column: number;
    file: string;
    context: string;
}

export class CodeIntel {
    private parser: Parser | null = null;
    private languages: Map<string, Language> = new Map();
    private initialized = false;

    /**
     * Initialize Tree-sitter
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        await Parser.init();
        this.parser = new Parser();
        this.initialized = true;
    }

    /**
     * Get the language for a file extension
     */
    private getLanguageForFile(filepath: string): string | null {
        const ext = path.extname(filepath).toLowerCase();
        const langMap: Record<string, string> = {
            '.py': 'python',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.mjs': 'javascript',
            '.go': 'go',
        };
        return langMap[ext] || null;
    }

    /**
     * Load a language parser, downloading if necessary
     */
    private async loadLanguage(lang: string): Promise<Language | null> {
        // For TypeScript files with JSX, use tsx parser
        const parserLang = lang === 'typescript' ? 'tsx' : lang;

        if (this.languages.has(parserLang)) {
            return this.languages.get(parserLang)!;
        }

        await fs.mkdir(PARSERS_DIR, { recursive: true });

        const wasmPath = path.join(PARSERS_DIR, `tree-sitter-${parserLang}.wasm`);

        // Check if we have the WASM file locally
        try {
            await fs.access(wasmPath);
        } catch {
            // Download the WASM file
            const url = PARSER_URLS[parserLang];
            if (!url) {
                process.stderr.write(`No parser available for ${parserLang}\n`);
                return null;
            }

            process.stderr.write(`Downloading ${parserLang} parser...\n`);

            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to download parser: ${response.status}`);
                }
                const buffer = await response.arrayBuffer();
                await fs.writeFile(wasmPath, Buffer.from(buffer));
                process.stderr.write(`Parser ready.\n`);
            } catch (error) {
                process.stderr.write(`Failed to download ${parserLang} parser: ${error}\n`);
                return null;
            }
        }

        // Load the language
        try {
            const language = await Language.load(wasmPath);
            this.languages.set(parserLang, language);
            return language;
        } catch (error) {
            process.stderr.write(`Failed to load ${parserLang} parser: ${error}\n`);
            return null;
        }
    }

    /**
     * Parse a file and return the syntax tree
     */
    private async parseFile(filepath: string, cwd: string): Promise<Tree | null> {
        if (!this.parser) await this.init();

        const lang = this.getLanguageForFile(filepath);
        if (!lang) return null;

        const language = await this.loadLanguage(lang);
        if (!language) return null;

        this.parser!.setLanguage(language);

        const fullPath = path.resolve(cwd, filepath);
        const content = await fs.readFile(fullPath, 'utf-8');

        return this.parser!.parse(content);
    }

    /**
     * Get all definitions in a file
     */
    async getDefinitions(filepath: string, cwd: string): Promise<Definition[]> {
        const tree = await this.parseFile(filepath, cwd);
        if (!tree) return [];

        const definitions: Definition[] = [];
        const lang = this.getLanguageForFile(filepath);

        // Walk the tree and extract definitions
        const cursor = tree.walk();

        const visit = () => {
            const node = cursor.currentNode;
            let def: Definition | null = null;

            if (lang === 'python') {
                def = this.extractPythonDefinition(node, filepath);
            } else if (lang === 'typescript' || lang === 'javascript') {
                def = this.extractTypeScriptDefinition(node, filepath);
            }

            if (def) {
                definitions.push(def);
            }

            // Visit children
            if (cursor.gotoFirstChild()) {
                do {
                    visit();
                } while (cursor.gotoNextSibling());
                cursor.gotoParent();
            }
        };

        visit();
        return definitions;
    }

    /**
     * Extract definition from Python AST node
     */
    private extractPythonDefinition(node: SyntaxNode, filepath: string): Definition | null {
        const type = node.type;

        if (type === 'function_definition') {
            const nameNode = node.childForFieldName('name');
            if (nameNode) {
                return {
                    name: nameNode.text,
                    type: 'function',
                    line: node.startPosition.row + 1,
                    column: node.startPosition.column,
                    endLine: node.endPosition.row + 1,
                    file: filepath
                };
            }
        }

        if (type === 'class_definition') {
            const nameNode = node.childForFieldName('name');
            if (nameNode) {
                return {
                    name: nameNode.text,
                    type: 'class',
                    line: node.startPosition.row + 1,
                    column: node.startPosition.column,
                    endLine: node.endPosition.row + 1,
                    file: filepath
                };
            }
        }

        if (type === 'assignment') {
            const left = node.childForFieldName('left');
            if (left && left.type === 'identifier') {
                // Only top-level assignments (rough heuristic)
                const parent = node.parent;
                if (parent && parent.type === 'module') {
                    return {
                        name: left.text,
                        type: 'variable',
                        line: node.startPosition.row + 1,
                        column: node.startPosition.column,
                        endLine: node.endPosition.row + 1,
                        file: filepath
                    };
                }
            }
        }

        return null;
    }

    /**
     * Extract definition from TypeScript/JavaScript AST node
     */
    private extractTypeScriptDefinition(node: SyntaxNode, filepath: string): Definition | null {
        const type = node.type;

        // Function declarations
        if (type === 'function_declaration' || type === 'method_definition') {
            const nameNode = node.childForFieldName('name');
            if (nameNode) {
                return {
                    name: nameNode.text,
                    type: type === 'method_definition' ? 'method' : 'function',
                    line: node.startPosition.row + 1,
                    column: node.startPosition.column,
                    endLine: node.endPosition.row + 1,
                    file: filepath
                };
            }
        }

        // Arrow functions assigned to const
        if (type === 'lexical_declaration') {
            const declarator = node.namedChildren.find(c => c.type === 'variable_declarator');
            if (declarator) {
                const nameNode = declarator.childForFieldName('name');
                const valueNode = declarator.childForFieldName('value');
                if (nameNode && valueNode && valueNode.type === 'arrow_function') {
                    return {
                        name: nameNode.text,
                        type: 'function',
                        line: node.startPosition.row + 1,
                        column: node.startPosition.column,
                        endLine: node.endPosition.row + 1,
                        file: filepath
                    };
                }
            }
        }

        // Class declarations
        if (type === 'class_declaration') {
            const nameNode = node.childForFieldName('name');
            if (nameNode) {
                return {
                    name: nameNode.text,
                    type: 'class',
                    line: node.startPosition.row + 1,
                    column: node.startPosition.column,
                    endLine: node.endPosition.row + 1,
                    file: filepath
                };
            }
        }

        // Interface declarations (TypeScript)
        if (type === 'interface_declaration') {
            const nameNode = node.childForFieldName('name');
            if (nameNode) {
                return {
                    name: nameNode.text,
                    type: 'interface',
                    line: node.startPosition.row + 1,
                    column: node.startPosition.column,
                    endLine: node.endPosition.row + 1,
                    file: filepath
                };
            }
        }

        // Type alias declarations (TypeScript)
        if (type === 'type_alias_declaration') {
            const nameNode = node.childForFieldName('name');
            if (nameNode) {
                return {
                    name: nameNode.text,
                    type: 'type',
                    line: node.startPosition.row + 1,
                    column: node.startPosition.column,
                    endLine: node.endPosition.row + 1,
                    file: filepath
                };
            }
        }

        return null;
    }

    /**
     * Find all references to a symbol across files
     */
    async findReferences(
        symbol: string,
        files: string[],
        cwd: string
    ): Promise<Reference[]> {
        const references: Reference[] = [];

        // Validate symbol length to prevent ReDoS
        if (!symbol || symbol.length > 100) {
            return [];
        }

        for (const filepath of files) {
            try {
                const fullPath = path.resolve(cwd, filepath);
                const content = await fs.readFile(fullPath, 'utf-8');
                const lines = content.split(/\r?\n/);

                // Simple text search for references (fast, not semantic)
                const pattern = new RegExp(`\\b${this.escapeRegex(symbol)}\\b`, 'g');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    let match;

                    while ((match = pattern.exec(line)) !== null) {
                        // Skip import statements
                        if (line.trim().startsWith('import ') || line.trim().startsWith('from ')) {
                            continue;
                        }

                        references.push({
                            name: symbol,
                            line: i + 1,
                            column: match.index,
                            file: filepath,
                            context: line.trim().slice(0, 100)
                        });
                    }
                }
            } catch {
                // Skip files that can't be read
            }
        }

        return references;
    }

    /**
     * Find where a symbol is defined
     */
    async goToDefinition(
        symbol: string,
        files: string[],
        cwd: string
    ): Promise<Definition | null> {
        for (const filepath of files) {
            try {
                const definitions = await this.getDefinitions(filepath, cwd);
                const match = definitions.find(d => d.name === symbol);
                if (match) {
                    return match;
                }
            } catch {
                // Skip files that can't be parsed
            }
        }

        return null;
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Check if Code Intelligence is available
     */
    static async isAvailable(): Promise<boolean> {
        try {
            await import('web-tree-sitter');
            return true;
        } catch {
            return false;
        }
    }
}
