'use client';

/**
 * @file packages/dashboard/src/app/knowledge/page.tsx
 * @description Knowledge Graph visualization page using reusable GraphView.
 */

import { useState, useEffect } from 'react';
import { GraphView } from '@/components/knowledge/graph-view';
import { Brain, RefreshCw, Layers } from 'lucide-react';
import { api } from '@/lib/api';
import type { Workspace } from '@adytum/shared';

export default function KnowledgePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWorkspaces = async () => {
      try {
        const data = await api.get('/api/workspaces');
        setWorkspaces(data.workspaces || []);
        if (data.workspaces?.length > 0) {
          setSelectedWorkspaceId(data.workspaces[0].id);
        }
      } catch (error) {
        console.error('Failed to fetch workspaces:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchWorkspaces();
  }, []);

  return (
    <div className="flex flex-col h-full bg-bg-primary overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-border-primary/50 bg-bg-secondary/30 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">Global Knowledge</h1>
            <p className="text-xs text-text-tertiary">Explore the neural network of all connected projects</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
           {workspaces.length > 0 && (
             <div className="flex items-center gap-2 bg-bg-secondary/50 border border-border-primary/50 rounded-xl px-3 py-1.5 shadow-sm">
                <Layers className="h-4 w-4 text-text-muted" />
                <select 
                  value={selectedWorkspaceId}
                  onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-text-secondary focus:outline-none cursor-pointer"
                >
                  {workspaces.map(ws => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </select>
             </div>
           )}
           
           <button 
            onClick={() => window.location.reload()} 
            className="flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-bg-hover text-text-tertiary transition-all"
           >
              <RefreshCw className="h-4 w-4" />
              <span className="text-xs font-medium">Reset View</span>
           </button>
        </div>
      </div>

      <div className="flex-1 relative">
        {loading ? (
             <div className="flex items-center justify-center h-full opacity-50">
                <RefreshCw className="h-8 w-8 text-accent-primary animate-spin" />
             </div>
        ) : (
            <GraphView workspaceId={selectedWorkspaceId} />
        )}
      </div>
    </div>
  );
}
