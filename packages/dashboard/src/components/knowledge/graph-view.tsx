'use client';

/**
 * @file packages/dashboard/src/components/knowledge/graph-view.tsx
 * @description Knowledge Graph visualization component using React Flow.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Panel,
  Node,
  Edge,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { gatewayFetch } from '@/lib/api';
import { Card, Button, Spinner, Badge } from '@/components/ui';
import { RefreshCw, Layout, ArrowDown, ArrowRight } from 'lucide-react';
import { KnowledgeGraph, GraphNode, GraphEdge } from '@adytum/shared';
import dagre from 'dagre';

const nodeWidth = 172;
const nodeHeight = 36;

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({
    rankdir: 'TB',
    nodesep: 40,
    ranksep: 300, // Significantly expanded for vertical growth
    marginx: 80,
    marginy: 80,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = Position.Top;
    node.sourcePosition = Position.Bottom;

    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };

    return node;
  });

  return { nodes, edges };
};

interface GraphViewProps {
  workspaceId?: string;
  onIndexingStatusChange?: (status: boolean) => void;
}

export function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphViewInner {...props} />
    </ReactFlowProvider>
  );
}

function GraphViewInner({ workspaceId, onIndexingStatusChange }: GraphViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const { fitView } = useReactFlow();

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = workspaceId
        ? `/api/knowledge/graph?workspaceId=${workspaceId}`
        : '/api/knowledge/graph';
      const graph = await gatewayFetch<KnowledgeGraph>(url);

      const newNodes: Node[] = graph.nodes.map((n: GraphNode) => ({
        id: n.id,
        data: { label: n.label, type: n.type, path: n.path, description: n.description },
        position: { x: 0, y: 0 },
        type: 'default',
        style: {
          background: n.type === 'directory' ? '#2d1b4d' : n.type === 'doc' ? '#1e2d1b' : '#1e1e2e',
          color: '#fff',
          border: `1px solid ${n.type === 'directory' ? '#4a3a8a' : '#4a4a6a'}`,
          borderRadius: '8px',
          padding: '8px 12px',
          width: nodeWidth,
          fontSize: '11px',
          fontWeight: n.type === 'directory' ? '600' : '400',
        },
      }));

      const newEdges: Edge[] = graph.edges.map((e: GraphEdge) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.type,
        animated: e.type === 'imports',
        style: { stroke: e.type === 'contains' ? '#4a4a6a' : '#6366f1', opacity: 0.6 },
        labelStyle: { fill: '#888', fontSize: '10px' },
      }));

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        newNodes,
        newEdges,
      );

      setNodes([...layoutedNodes]);
      setEdges([...layoutedEdges]);

      // Auto-focus on the root node (id: '.') after a short delay
      const rootNode = layoutedNodes.find((n) => n.id === '.');
      if (rootNode) {
        setTimeout(() => {
          void fitView({ duration: 800, padding: 0.3, nodes: [rootNode] });
        }, 300);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges, workspaceId]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  const onNodeClick = (_: any, node: Node) => {
    setSelectedNode(node);
  };

  if (loading && nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center opacity-50">
          <Spinner size="lg" className="mb-4" />
          <p className="text-xs font-medium uppercase tracking-widest">Loading Neural Map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-bg-primary overflow-hidden">
      {error && (
        <div className="absolute top-4 left-4 z-50 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-xs">
          {error}
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        colorMode="dark"
      >
        <Background color="#1e1e2e" gap={20} />
        <Controls />
        <MiniMap
          nodeColor={(n) => (n.data?.type === 'directory' ? '#6366f1' : '#4b5563')}
          maskColor="rgba(0, 0, 0, 0.1)"
          style={{ backgroundColor: '#0f111a' }}
        />

        <Panel position="top-right" className="m-4">
          <div className="flex flex-col gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="bg-bg-secondary/80 backdrop-blur-sm border border-border-primary"
              onClick={fetchGraph}
              disabled={loading}
            >
              <RefreshCw className={`h-3 w-3 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>

            {selectedNode && (
              <Card className="w-80 animate-slide-in shadow-2xl border-accent-primary/20 bg-bg-secondary/90 backdrop-blur-md">
                <div className="flex items-center justify-between mb-4">
                  <Badge variant="info" className="uppercase text-[9px] font-bold tracking-tighter">
                    {String(selectedNode.data?.type || 'Node')}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-text-muted hover:text-text-primary"
                    onClick={() => setSelectedNode(null)}
                  >
                    ×
                  </Button>
                </div>
                <h3 className="text-sm font-bold text-text-primary mb-2 truncate">
                  {String(selectedNode.data?.label)}
                </h3>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-[9px] text-text-muted uppercase font-bold tracking-widest">
                      Path
                    </p>
                    <p className="text-[10px] text-text-secondary font-mono break-all bg-bg-tertiary/50 p-2 rounded border border-border-primary/30">
                      {String(selectedNode.data?.path || 'N/A')}
                    </p>
                  </div>
                  {!!selectedNode.data?.description && (
                    <div className="space-y-1">
                      <p className="text-[9px] text-text-muted uppercase font-bold tracking-widest">
                        Description
                      </p>
                      <p className="text-[10px] text-text-tertiary leading-relaxed">
                        {String(selectedNode.data?.description || '')}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
