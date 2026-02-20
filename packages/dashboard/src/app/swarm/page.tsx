'use client';

import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { AdytumAgent, SwarmEvents } from '@adytum/shared';
import { SwarmVisualizer } from '@/components/swarm/SwarmVisualizer';
import { AgentDetail } from '@/components/swarm/AgentDetail';
import { Activity, RefreshCw } from 'lucide-react';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001';

export default function SwarmPage() {
  const [agents, setAgents] = useState<AdytumAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AdytumAgent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  // Initial Fetch
  const fetchAgents = async () => {
    try {
      const res = await fetch(`${GATEWAY_URL}/api/agents/hierarchy`);
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = await res.json();
      setAgents(data.hierarchy);
    } catch (err) {
      console.error('Error fetching swarm:', err);
    }
  };

  useEffect(() => {
    void fetchAgents();

    // Socket Connection
    const newSocket = io(GATEWAY_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to Gateway Swarm');
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Disconnected from Gateway Swarm');
    });

    // Listen for Swarm Events
    newSocket.on(SwarmEvents.AGENT_SPAWNED, (agent: AdytumAgent) => {
      console.log('Agent Spawned:', agent.name);
      setAgents((prev) => {
        if (prev.find((p) => p.id === agent.id)) return prev;
        return [...prev, agent];
      });
    });

    newSocket.on(SwarmEvents.AGENT_UPDATED, (update: { id: string; status: any }) => {
      setAgents((prev) =>
        prev.map((a) => (a.id === update.id ? { ...a, status: update.status } : a)),
      );

      // Also update selected agent if matches
      setSelectedAgent((curr) =>
        curr?.id === update.id ? { ...curr, status: update.status } : curr,
      );
    });

    newSocket.on(SwarmEvents.AGENT_TERMINATED, (payload: { id: string }) => {
      setAgents((prev) => prev.filter((a) => a.id !== payload.id));
      setSelectedAgent((curr) => (curr?.id === payload.id ? null : curr));
    });

    // Explicit refresh event if needed
    newSocket.on('swarm:refresh', fetchAgents);

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100 relative overflow-hidden">
      {/* Header */}
      <div className="flex-none h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 z-10">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold tracking-tight">Swarm Intelligence</h1>
          <div
            className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider border ${
              isConnected
                ? 'bg-green-900/20 text-green-400 border-green-900'
                : 'bg-red-900/20 text-red-400 border-red-900'
            }`}
          >
            {isConnected ? 'Live Uplink' : 'Offline'}
          </div>
          <div className="ml-4 flex items-center gap-2 text-xs text-slate-500">
            <Activity className="w-3 h-3" />
            <span>{agents.length} Active Agents</span>
          </div>
        </div>

        <button
          onClick={fetchAgents}
          className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
          title="Refresh Swarm"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Main Graph Area */}
      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <SwarmVisualizer agents={agents} onAgentSelect={setSelectedAgent} />
        </div>
      </div>

      {/* Details Panel */}
      {selectedAgent && (
        <AgentDetail agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}
