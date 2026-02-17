/**
 * @file packages/gateway/src/domain/knowledge/graph-indexer.ts
 * @description Logic for crawling files and performing incremental updates to the knowledge graph.
 */

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { KnowledgeGraph, GraphNode, GraphEdge, GraphNodeType } from '@adytum/shared';
import { GraphStore } from './graph-store.js';
import { logger } from '../../logger.js';
import { SemanticProcessor } from './semantic-processor.js';

export class GraphIndexer {
  private supportedExtensions = [
    '.ts',
    '.js',
    '.tsx',
    '.jsx',
    '.py',
    '.go',
    '.md',
    '.yaml',
    '.yml',
    '.dart',
    '.pdf',
    '.zip',
    '.png',
    '.jpg',
    '.jpeg',
    '.txt',
    '.json',
  ];
  private ignoredDirs = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.dart_tool',
    'ios',
    'android',
    'macos',
    'windows',
    'linux',
    '.fvm',
    '.symlinks',
    '.cxx',
    'Pods',
    'Carthage',
    'Debug',
    'Release',
    'derivedData',
    '.adytum_extracted',
  ];

  constructor(
    private workspacePath: string,
    private store: GraphStore,
    private semanticProcessor?: SemanticProcessor,
  ) {}

  /**
   * Performs an incremental update of the knowledge graph.
   * @param options - Indexing options including custom path and mode.
   */
  async update(
    customPath?: string,
    workspaceId?: string,
    options: { mode?: 'fast' | 'deep' } = { mode: 'fast' },
  ): Promise<KnowledgeGraph> {
    const path = customPath || this.workspacePath;
    const graph = this.store.load(workspaceId);
    const existingNodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.path || n.id, n]));

    const startTime = Date.now();
    const currentFiles = this.getAllFiles(path);
    const updatedNodes: GraphNode[] = [];

    // 0. Ensure root node exists
    if (!existingNodeMap.has('.')) {
      updatedNodes.push({
        id: '.',
        type: 'directory',
        label: basename(path) || 'Project Root',
        path: '.',
      });
    }

    const updatedEdges: GraphEdge[] = []; // Re-extract all edges for simplicity/consistency

    // 1. Process Files
    for (const filePath of currentFiles) {
      const relPath = relative(path, filePath);

      try {
        const hash = this.getFileHash(filePath);

        const existingNode = existingNodeMap.get(relPath);
        let currentNode: GraphNode;

        if (!existingNode || existingNode.metadata?.hash !== hash) {
          logger.debug(`Processing changed file: ${relPath}`);
          currentNode = this.createFileNode(relPath, filePath, hash);
        } else {
          currentNode = existingNode;
        }
        updatedNodes.push(currentNode);

        // 2. Extract Relationships (Hierarchy)
        this.ensureDirectoryNodes(relPath, updatedNodes, updatedEdges, path);
      } catch (err: any) {
        logger.warn(`Skipping file due to access error: ${relPath} - ${err.message}`);
        continue;
      }
    }

    // 3. Extract Code Relationships (Imports)
    graph.nodes = updatedNodes;
    graph.edges = updatedEdges;

    for (const node of updatedNodes) {
      if (node.type === 'file' || node.type === 'doc') {
        const fullPath = join(path, node.path!);
        if (extname(fullPath) === '.md') {
          this.extractMarkdownRelationships(fullPath, node, graph, path);
        } else {
          this.extractCodeRelationships(fullPath, node, graph, path);
        }
      }
    }

    graph.lastUpdated = Date.now();

    // 4. Handle Deep Indexing (Semantic Analysis)
    if (options.mode === 'deep' && this.semanticProcessor) {
      logger.info('Performing deep semantic analysis...');
      const nodesToProcess = graph.nodes.filter((n) => n.type === 'file' || n.type === 'doc');
      await this.semanticProcessor.process(nodesToProcess);
    }

    this.store.save(graph, workspaceId);

    logger.info(
      `Scan [${options.mode}] completed in ${Date.now() - startTime}ms. Total nodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`,
    );
    return graph;
  }

  private ensureDirectoryNodes(
    relPath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    workspacePath: string,
  ): void {
    const parts = relPath.split(/[\\/]/);
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      const parentPath = currentPath;
      currentPath = currentPath ? join(currentPath, parts[i]) : parts[i];

      // Ensure directory node exists
      if (!nodes.find((n) => n.id === currentPath)) {
        nodes.push({
          id: currentPath,
          type: 'directory',
          label: parts[i],
          path: currentPath,
        });
      }

      // Create "contains" edge from parent to this dir, or root to this dir
      const source = parentPath || '.'; // '.' represents workspace root if needed, but we can just use empty or special ID
      if (source !== currentPath) {
        const edgeId = `hierarchy:${source}->${currentPath}`;
        if (!edges.find((e) => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            source,
            target: currentPath,
            type: 'contains',
          });
        }
      }
    }

    // Final link to the file itself
    const fileDir = parts.slice(0, -1).join('/') || '.';
    const fileId = relPath;
    const finalEdgeId = `hierarchy:${fileDir}->${fileId}`;

    // Ensure fileDir node exists if it's '.'
    if (fileDir === '.' && !nodes.find((n) => n.id === '.')) {
      nodes.push({
        id: '.',
        type: 'directory',
        label: basename(workspacePath) || 'Project Root',
        path: '.',
      });
    }

    if (!edges.find((e) => e.id === finalEdgeId)) {
      edges.push({
        id: finalEdgeId,
        source: fileDir,
        target: fileId,
        type: 'contains',
      });
    }
  }

  private extractMarkdownRelationships(
    filePath: string,
    node: GraphNode,
    graph: KnowledgeGraph,
    workspacePath: string,
  ): void {
    try {
      const content = readFileSync(filePath, 'utf-8');

      // 1. Wikilinks [[Link]] or [[Link|Label]]
      const wikiRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let match;
      while ((match = wikiRegex.exec(content)) !== null) {
        const target = match[1].trim();
        this.addMarkdownEdge(node, target, graph, filePath, workspacePath, 'wikilink');
      }

      // 2. Standard links [Label](path)
      const stdRegex = /\[[^\]]+\]\(([^)]+)\)/g;
      while ((match = stdRegex.exec(content)) !== null) {
        const target = match[1].trim();
        if (target.startsWith('http')) continue;
        this.addMarkdownEdge(node, target, graph, filePath, workspacePath, 'link');
      }
    } catch (err) {
      logger.warn(`Failed to extract markdown relationships from ${filePath}: ${err}`);
    }
  }

  private addMarkdownEdge(
    sourceNode: GraphNode,
    target: string,
    graph: KnowledgeGraph,
    sourceFullPath: string,
    workspacePath: string,
    edgeType: string,
  ): void {
    let resolvedTarget = target;

    // Try resolving as relative path first
    if (target.startsWith('.')) {
      const sourceDir = join(sourceFullPath, '..');
      const absoluteTarget = resolve(sourceDir, target);
      resolvedTarget = relative(workspacePath, absoluteTarget);
    }

    // Find node by path or id or label (for wikilinks)
    let targetNode = graph.nodes.find((n) => n.id === resolvedTarget || n.path === resolvedTarget);

    if (!targetNode && !target.includes('/')) {
      // Try finding by label (ignoring case/extension)
      targetNode = graph.nodes.find(
        (n) =>
          n.label.toLowerCase() === target.toLowerCase() ||
          basename(n.path || '')
            .replace(/\.md$/i, '')
            .toLowerCase() === target.toLowerCase(),
      );
    }

    if (targetNode && targetNode.id !== sourceNode.id) {
      const edgeId = `md:${sourceNode.id}->${targetNode.id}`;
      if (!graph.edges.find((e) => e.id === edgeId)) {
        graph.edges.push({
          id: edgeId,
          source: sourceNode.id,
          target: targetNode.id,
          type: 'references',
          metadata: { subtype: edgeType },
        });
      }
    }
  }

  private extractCodeRelationships(
    filePath: string,
    node: GraphNode,
    graph: KnowledgeGraph,
    workspacePath: string,
  ): void {
    const ext = extname(filePath);
    const codeExts = ['.ts', '.js', '.tsx', '.jsx', '.py', '.dart'];
    if (!codeExts.includes(ext)) return;

    try {
      const content = readFileSync(filePath, 'utf-8');

      if (['.ts', '.js', '.tsx', '.jsx', '.dart'].includes(ext)) {
        const regex =
          ext === '.dart'
            ? /^(?:import|export)\s+['"]([^'"]+)['"]/gm
            : /(?:import|from)\s+['"]([^'"]+)['"]/g;

        let match;
        while ((match = regex.exec(content)) !== null) {
          let target = match[1];
          if (ext === '.dart') {
            if (target.startsWith('dart:')) continue;
            if (target.startsWith('package:')) {
              target = target.split('/').pop()?.replace('.dart', '') || target;
            }
          }
          this.addImportEdge(node, target, graph, filePath, workspacePath);
        }
      } else if (ext === '.py') {
        const pyImportRegex = /^(?:from|import)\s+([a-zA-Z0-9_.]+)/gm;
        let match;
        while ((match = pyImportRegex.exec(content)) !== null) {
          const target = match[1].replace(/\./g, '/');
          this.addImportEdge(node, target, graph, filePath, workspacePath);
        }
      }
    } catch (err) {
      logger.warn(
        `Failed to extract relationships from ${filePath}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private addImportEdge(
    sourceNode: GraphNode,
    targetPath: string,
    graph: KnowledgeGraph,
    sourceFullPath: string,
    workspacePath: string,
  ): void {
    // Try to resolve relative imports
    let resolvedTarget = targetPath;
    if (targetPath.startsWith('.')) {
      const sourceDir = join(sourceFullPath, '..');
      const absoluteTarget = resolve(sourceDir, targetPath);
      resolvedTarget = relative(workspacePath, absoluteTarget);

      // Try adding extensions if not present
      const possibleExts = ['.ts', '.js', '.tsx', '.jsx', '/index.ts', '/index.js', '.dart'];
      for (const ext of possibleExts) {
        const pathWithExt = resolvedTarget + ext;
        if (graph.nodes.find((n) => n.path === pathWithExt)) {
          resolvedTarget = pathWithExt;
          break;
        }
      }
    }

    const targetNode = graph.nodes.find(
      (n) => n.id === resolvedTarget || n.path === resolvedTarget,
    );
    if (targetNode && targetNode.id !== sourceNode.id) {
      const edgeId = `import:${sourceNode.id}->${targetNode.id}`;
      if (!graph.edges.find((e) => e.id === edgeId)) {
        graph.edges.push({
          id: edgeId,
          source: sourceNode.id,
          target: targetNode.id,
          type: 'imports',
        });
      }
    }
  }

  private getAllFiles(dir: string, fileList: string[] = []): string[] {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const name = join(dir, entry.name);
        if (this.ignoredDirs.includes(entry.name) || entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          this.getAllFiles(name, fileList);
        } else if (entry.isFile()) {
          if (this.supportedExtensions.includes(extname(entry.name))) {
            fileList.push(name);
          }
        }
      }
    } catch (err: any) {
      logger.error(`Failed to read directory ${dir}: ${err.message}`);
    }
    return fileList;
  }

  private getFileHash(filePath: string): string {
    const buffer = readFileSync(filePath);
    return createHash('md5').update(buffer).digest('hex');
  }

  private createFileNode(relPath: string, fullPath: string, hash: string): GraphNode {
    const ext = extname(relPath).toLowerCase();
    let type: GraphNodeType = 'file';

    // Group extensions by type
    const docExts = ['.md', '.txt', '.yaml', '.yml', '.json', '.pdf'];
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const archiveExts = ['.zip', '.tar', '.gz', '.rar'];

    if (docExts.includes(ext)) type = 'doc';
    else if (imageExts.includes(ext)) type = 'image';
    else if (archiveExts.includes(ext)) type = 'archive';

    return {
      id: relPath, // Use relative path as ID for files
      type,
      label: basename(relPath),
      path: relPath,
      metadata: {
        hash,
        size: existsSync(fullPath) ? statSync(fullPath).size : 0,
        extension: ext,
        lastProcessed: Date.now(),
      },
    };
  }
}
