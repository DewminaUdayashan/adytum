'use client';

import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Node,
  Edge,
  Position,
  Handle,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { AdytumAgent } from '@adytum/shared';
import { Bot, Zap, Brain, Shield, Terminal } from 'lucide-react';

interface SwarmVisualizerProps {
  agents: AdytumAgent[];
  onAgentSelect: (agent: AdytumAgent) => void;
}

const nodeWidth = 172;
const nodeHeight = 80;

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({ rankdir: 'TB' });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
      targetPosition: Position.Top,
      sourcePosition: Position.Bottom,
    };
  });

  return { nodes: layoutedNodes, edges };
};

const AgentNode = ({ data }: { data: { agent: AdytumAgent } }) => {
  const { agent } = data;

  const getIcon = () => {
    const cls = 'w-3.5 h-3.5 shrink-0';
    if (agent.type === 'architect') return <Brain className={`${cls} text-purple-400`} />;
    if (agent.role.toLowerCase().includes('research'))
      return <Zap className={`${cls} text-yellow-400`} />;
    if (agent.role.toLowerCase().includes('security'))
      return <Shield className={`${cls} text-red-400`} />;
    if (agent.role.toLowerCase().includes('engineer'))
      return <Terminal className={`${cls} text-blue-400`} />;
    return <Bot className={`${cls} text-green-400`} />;
  };

  return (
    <div
      className={`px-4 py-3 shadow-md rounded-lg border-2 bg-slate-800 w-[180px] ${
        agent.status === 'working'
          ? 'border-yellow-500 animate-pulse'
          : agent.status === 'idle'
            ? 'border-green-500'
            : 'border-slate-600'
      }`}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-slate-400" />

      <div className="flex items-center gap-3">
        {/* Avatar */}
        <img
          src={agent.avatarUrl || ''}
          alt="avatar"
          className="w-10 h-10 rounded-full bg-slate-700 border border-slate-600 shrink-0"
        />

        <div className="flex flex-col min-w-0">
          <span className="text-xs font-bold text-slate-100 truncate">{agent.name}</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            {getIcon()}
            <span className="text-[10px] text-slate-400 truncate font-medium">{agent.role}</span>
          </div>
        </div>
      </div>

      <div className="mt-2 flex justify-between items-center">
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase font- tracking-wider ${
            agent.status === 'idle'
              ? 'bg-green-900/50 text-green-300'
              : agent.status === 'working'
                ? 'bg-yellow-900/50 text-yellow-300'
                : 'bg-slate-700 text-slate-400'
          }`}
        >
          {agent.status}
        </span>
        {agent.metadata?.tier && (
          <span className="text-[9px] text-slate-500">T{agent.metadata.tier}</span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-slate-400" />
    </div>
  );
};

const nodeTypes = {
  agent: AgentNode,
};

export const SwarmVisualizer: React.FC<SwarmVisualizerProps> = ({ agents, onAgentSelect }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useMemo(() => {
    // Transform agents to nodes
    const initialNodes: Node[] = agents.map((agent) => ({
      id: agent.id,
      type: 'agent',
      data: { agent },
      position: { x: 0, y: 0 }, // DAGRE will fix this
    }));

    const initialEdges: Edge[] = agents
      .filter((a) => a.parentId)
      .map((agent) => ({
        id: `e-${agent.parentId}-${agent.id}`,
        source: agent.parentId!,
        target: agent.id,
        animated: true,
        style: { stroke: '#64748b' },
      }));

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      initialNodes,
      initialEdges,
    );

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [agents, setNodes, setEdges]);

  return (
    <div className="w-full h-[600px] bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onAgentSelect(node.data.agent as AdytumAgent)}
        nodeTypes={nodeTypes}
        fitView
        className="bg-slate-950"
      >
        <Background gap={16} size={1} color="#334155" />
        <Controls className="bg-slate-800 border-slate-700 fill-slate-300" />
        <MiniMap
          nodeColor="#475569"
          maskColor="rgba(15, 23, 42, 0.6)"
          className="bg-slate-900 border-slate-800"
        />
      </ReactFlow>
    </div>
  );
};
