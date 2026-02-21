'use client';

import React from 'react';
import { AdytumAgent } from '@adytum/shared';
import { Skull, Ghost, Clock, Info, Calendar } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface GraveyardListProps {
  agents: AdytumAgent[];
  onAgentSelect: (agent: AdytumAgent) => void;
}

export const GraveyardList: React.FC<GraveyardListProps> = ({ agents, onAgentSelect }) => {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-4 opacity-50">
        <Ghost className="w-16 h-16 stroke-[1px]" />
        <p className="text-sm font-medium">The graveyard is currently empty.</p>
        <p className="text-xs">No agents have been deactivated yet.</p>
      </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-y-auto custom-scrollbar">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents
          .sort((a, b) => (b.terminatedAt || 0) - (a.terminatedAt || 0))
          .map((agent) => (
            <div
              key={agent.id}
              onClick={() => onAgentSelect(agent)}
              className="group relative bg-slate-900/40 border border-slate-800 hover:border-red-900/50 rounded-xl p-4 transition-all hover:bg-slate-900 cursor-pointer overflow-hidden"
            >
              {/* Decay Effect Overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

              <div className="flex gap-4 relative z-10">
                {/* Desaturated Avatar */}
                <div className="relative">
                  <img
                    src={agent.avatarUrl}
                    alt={agent.name}
                    className="w-12 h-12 rounded-full grayscale opacity-60 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500"
                  />
                  <div className="absolute -bottom-1 -right-1 bg-slate-950 rounded-full p-1 border border-slate-800">
                    <Skull className="w-3 h-3 text-red-500/70" />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-slate-300 group-hover:text-slate-100 truncate flex items-center gap-2">
                    {agent.name}
                    <span className="text-[10px] text-slate-500 font-normal">
                      T{agent.metadata?.tier || '?'}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{agent.role}</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-800/50">
                      <Calendar className="w-3 h-3" />
                      <span>
                        {agent.terminatedAt
                          ? formatDistanceToNow(agent.terminatedAt, { addSuffix: true })
                          : 'Unknown Death'}
                      </span>
                    </div>
                    {agent.metadata?.terminationReason && (
                      <div className="flex items-center gap-1 text-[10px] text-red-400/70 bg-red-950/10 px-1.5 py-0.5 rounded border border-red-900/20 max-w-full">
                        <Info className="w-3 h-3 shrink-0" />
                        <span className="truncate">{agent.metadata.terminationReason}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats Footer */}
              <div className="mt-4 pt-3 border-t border-slate-800/50 flex items-center justify-between text-[10px] text-slate-600">
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>
                    Life:{' '}
                    {Math.floor(((agent.terminatedAt || Date.now()) - agent.createdAt) / 60000)}m
                  </span>
                </div>
                <span className="uppercase tracking-widest opacity-50 font-bold">
                  {agent.status}
                </span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};
