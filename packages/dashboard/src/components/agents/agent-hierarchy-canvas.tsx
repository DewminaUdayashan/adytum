'use client';

/**
 * Interactive hierarchy canvas for agents (React Flow). Pan, zoom, drag nodes.
 */

import { useCallback, useEffect, useState } from 'react';
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
  type NodeProps,
  MarkerType,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { gatewayFetch } from '@/lib/api';
import { Button, Spinner } from '@/components/ui';
import { RefreshCw, User } from 'lucide-react';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 88;

export interface HierarchyNodeData {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  birthTime: number;
  endedAt: number | null;
  avatar: string | null;
  parentId: string | null;
  uptimeSeconds?: number;
  modelIds?: string[];
}

interface HierarchyTree {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  birthTime: number;
  endedAt: number | null;
  avatar: string | null;
  parentId: string | null;
  uptimeSeconds?: number;
  modelIds?: string[];
  children: HierarchyTree[];
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

function AgentNode(props: NodeProps) {
  const data = props.data as unknown as HierarchyNodeData;
  const selected = props.selected;
  const isDeactivated = data.endedAt != null;
  return (
    <div
      className={`
        relative rounded-xl border-2 shadow-lg transition-all
        ${selected ? 'border-accent-primary ring-2 ring-accent-primary/30' : 'border-border-primary hover:border-accent-primary/50'}
        ${isDeactivated ? 'opacity-60 bg-bg-tertiary' : 'bg-bg-secondary'}
        flex items-center gap-3 px-4 py-3 w-[200px] min-h-[72px]
      `}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !border-2 !border-[#6366f1] !bg-bg-secondary" />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !border-2 !border-[#6366f1] !bg-bg-secondary" />
      <div className="absolute top-0 left-0 w-full h-1 rounded-t-xl bg-gradient-to-r from-accent-primary/80 to-transparent opacity-80" />
      {data.avatar ? (
        <img src={data.avatar} alt="" className="h-12 w-12 rounded-full object-cover shrink-0 border-2 border-border-primary" />
      ) : (
        <div className="h-12 w-12 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0 border-2 border-border-primary">
          <User className="h-6 w-6 text-text-muted" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text-primary truncate text-sm">{data.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-accent-primary">Tier {data.tier}</span>
          {!isDeactivated && data.uptimeSeconds != null && (
            <span className="text-[10px] text-text-muted">↑ {formatUptime(data.uptimeSeconds)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

function getLayoutedElements(nodes: Node[], edges: Edge[]) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: 'TB',
    nodesep: 50,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const pos = dagreGraph.node(node.id);
    node.targetPosition = Position.Top;
    node.sourcePosition = Position.Bottom;
    node.position = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
  });

  return { nodes, edges };
}

function treeToNodesAndEdges(tree: HierarchyTree[], parentId: string | null): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  function walk(t: HierarchyTree) {
    const node: Node = {
      id: t.id,
      type: 'agent',
      data: {
        id: t.id,
        name: t.name,
        tier: t.tier,
        birthTime: t.birthTime,
        endedAt: t.endedAt,
        avatar: t.tier === 1 ? '/avatars/prometheus.png' : t.avatar,
        parentId: t.parentId,
        uptimeSeconds: t.uptimeSeconds,
        modelIds: t.modelIds ?? [],
      },
      position: { x: 0, y: 0 },
    };
    nodes.push(node);
    if (t.parentId) {
      edges.push({
        id: `e-${t.parentId}-${t.id}`,
        source: t.parentId,
        target: t.id,
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#6366f1', strokeWidth: 2.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
        zIndex: 0,
      });
    }
    (t.children || []).forEach(walk);
  }

  tree.forEach(walk);
  return { nodes, edges };
}

interface AgentHierarchyCanvasProps {
  onSelectAgent: (agent: HierarchyNodeData | null) => void;
  selectedAgentId: string | null;
  refreshTrigger?: number;
}

function AgentHierarchyCanvasInner({ onSelectAgent, selectedAgentId, refreshTrigger }: AgentHierarchyCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  const fetchHierarchy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await gatewayFetch<{ hierarchy: HierarchyTree[] }>('/api/agents/hierarchy');
      const tree = res.hierarchy ?? [];
      const { nodes: rawNodes, edges: rawEdges } = treeToNodesAndEdges(tree, null);
      const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(rawNodes, rawEdges);
      setNodes(layouted);
      setEdges(layoutedEdges);
      setTimeout(() => fitView({ duration: 400, padding: 0.25 }), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges, fitView]);

  useEffect(() => {
    void fetchHierarchy();
  }, [fetchHierarchy, refreshTrigger]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({ ...n, selected: n.id === selectedAgentId })),
    );
  }, [selectedAgentId, setNodes]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectAgent(node.data as unknown as HierarchyNodeData);
    },
    [onSelectAgent],
  );

  if (loading && nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[320px]">
        <div className="text-center">
          <Spinner size="lg" className="mb-3" />
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted">Loading hierarchy...</p>
        </div>
      </div>
    );
  }

  if (!loading && nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[320px] bg-bg-primary/50 rounded-xl border border-border-primary/50">
        <div className="text-center text-text-muted">
          <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm font-medium">No agents yet</p>
          <p className="text-xs mt-1">Prometheus (Tier 1) is created on gateway start. Use Birth above or have the alpha spawn agents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full min-h-[580px] bg-bg-primary/50 rounded-xl border border-border-primary/50 overflow-hidden">
      {error && (
        <div className="absolute top-3 left-3 z-50 px-3 py-2 bg-error/10 border border-error/30 rounded-lg text-error text-xs">
          {error}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => onSelectAgent(null)}
        nodeTypes={nodeTypes}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          style: { stroke: '#6366f1', strokeWidth: 2.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
        }}
      >
        <Background color="var(--color-bg-tertiary)" gap={16} size={0.5} />
        <Controls className="!bg-bg-secondary !border-border-primary !shadow-lg" />
        <MiniMap
          nodeColor={(n) => (n.data?.tier === 1 ? '#8b5cf6' : n.data?.tier === 2 ? '#6366f1' : '#4f46e5')}
          maskColor="rgba(0,0,0,0.6)"
          className="!bg-bg-secondary !border-border-primary"
        />
        <Panel position="top-right" className="m-2">
          <Button variant="outline" size="sm" onClick={fetchHierarchy} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function AgentHierarchyCanvas(props: AgentHierarchyCanvasProps) {
  return (
    <ReactFlowProvider>
      <AgentHierarchyCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
