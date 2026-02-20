'use client';

import React from 'react';
import { AdytumAgent } from '@adytum/shared';
import { X, Activity, MessageSquare, Terminal, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface AgentDetailProps {
  agent: AdytumAgent | null;
  onClose: () => void;
}

export const AgentDetail: React.FC<AgentDetailProps> = ({ agent, onClose }) => {
  if (!agent) return null;

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-slate-900 border-l border-slate-800 shadow-2xl transform transition-transform duration-300 ease-in-out z-50 flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-slate-800 flex justify-between items-start">
        <div className="flex items-center gap-4">
          <img
            src={agent.avatarUrl}
            alt={agent.name}
            className="w-12 h-12 rounded-full border-2 border-slate-700 bg-slate-800"
          />
          <div>
            <h2 className="text-lg font-bold text-slate-100">{agent.name}</h2>
            <p className="text-sm text-slate-400">{agent.role}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Status Bar */}
      <div className="px-6 py-4 bg-slate-800/50 flex justify-between items-center text-xs">
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-slate-400" />
          <span
            className={`px-2 py-0.5 rounded-full uppercase font-bold tracking-wider ${
              agent.status === 'idle'
                ? 'bg-green-900/30 text-green-400 border border-green-900'
                : agent.status === 'working'
                  ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-900'
                  : 'bg-slate-700 text-slate-400'
            }`}
          >
            {agent.status}
          </span>
        </div>
        <div className="flex items-center gap-1 text-slate-500">
          <Clock className="w-3 h-3" />
          <span>Born {formatDistanceToNow(agent.createdAt)} ago</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Mission */}
        <section>
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Current Mission</h3>
          <div className="bg-slate-950 p-3 rounded-md border border-slate-800 text-sm text-slate-300">
            {agent.metadata?.mission || 'No active mission.'}
          </div>
        </section>

        {/* Tools */}
        <section>
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2 flex items-center gap-2">
            <Terminal className="w-3 h-3" /> Available Tools
          </h3>
          <div className="flex flex-wrap gap-2">
            {agent.tools.map((tool: string) => (
              <span
                key={tool}
                className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded border border-slate-700 font-mono"
              >
                {tool}
              </span>
            ))}
          </div>
        </section>

        {/* Logs / Messages (Mock for now) */}
        <section>
          <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2 flex items-center gap-2">
            <MessageSquare className="w-3 h-3" /> Recent Activity
          </h3>
          <div className="space-y-3">
            {/* Mock logs */}
            <div className="text-xs space-y-1">
              <div className="text-slate-500">{new Date().toLocaleTimeString()}</div>
              <div className="text-slate-300 bg-slate-800/50 p-2 rounded">
                Checking inbox for new messages...
              </div>
            </div>
            <div className="text-xs space-y-1 opacity-60">
              <div className="text-slate-500">
                {new Date(Date.now() - 60000).toLocaleTimeString()}
              </div>
              <div className="text-slate-300 bg-slate-800/50 p-2 rounded">
                Agent initialized and ready.
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
