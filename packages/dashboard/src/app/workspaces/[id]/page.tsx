'use client';

import { useState, useEffect, use } from 'react';
import { api, gatewayFetch } from '@/lib/api';
import { WorkspaceChat } from '@/components/workspaces/workspace-chat';
import { GraphView } from '@/components/knowledge/graph-view';
import { ChevronLeft, RefreshCw, Layers, Compass, ExternalLink, HardDrive } from 'lucide-react';
import { clsx } from 'clsx';
import Link from 'next/link';
import type { Workspace } from '@adytum/shared';

export default function WorkspaceDetailIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);

  const fetchWorkspace = async () => {
    try {
      const data = await api.get('/api/workspaces');
      const ws = data.workspaces.find((w: Workspace) => w.id === id);
      if (ws) setWorkspace(ws);
    } catch (error) {
      console.error('Failed to fetch workspace details:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspace();
  }, [id]);

  const [indexingMode, setIndexingMode] = useState<'fast' | 'deep'>('fast');

  const handleReindex = async () => {
    setReindexing(true);
    try {
      await gatewayFetch('/api/knowledge/reindex', { 
        method: 'POST',
        body: JSON.stringify({ 
            workspaceId: id,
            mode: indexingMode
        })
      });
      fetchWorkspace();
    } catch (err: any) {
      alert(`Re-index failed: ${err.message}`);
    } finally {
      setReindexing(false);
    }
  };

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-bg-primary">
         <RefreshCw className="h-8 w-8 text-accent-primary animate-spin" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-bg-primary gap-4">
         <p className="text-text-muted">Workspace not found</p>
         <Link href="/workspaces" className="text-accent-primary text-sm hover:underline">Back to Workspaces</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary overflow-hidden animate-fade-in relative">
      {/* Workspace Header */}
      <div className="px-8 py-3 border-b border-border-primary/50 bg-bg-secondary/30 backdrop-blur-md flex items-center justify-between z-20">
        <div className="flex items-center gap-4">
          <Link href="/workspaces" className="p-2 hover:bg-bg-hover rounded-lg text-text-tertiary transition-colors">
             <ChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
               <h1 className="text-sm font-bold text-text-primary">{workspace.name}</h1>
               <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted uppercase font-bold tracking-tighter">
                  {workspace.type}
               </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
               <HardDrive className="h-2.5 w-2.5" />
               <span className="truncate max-w-[300px]">{workspace.path}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
           {/* Indexing Mode Toggle */}
           <div className="flex items-center bg-bg-tertiary p-1 rounded-lg border border-border-primary/50">
              <button 
                onClick={() => setIndexingMode('fast')}
                className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${indexingMode === 'fast' ? 'bg-bg-primary text-accent-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
              >
                FAST
              </button>
              <button 
                onClick={() => setIndexingMode('deep')}
                className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${indexingMode === 'deep' ? 'bg-bg-primary text-accent-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
              >
                DEEP
              </button>
           </div>

           <div className="flex items-center gap-4 px-4 border-r border-border-primary/50">
              <div className="text-center">
                 <p className="text-[9px] text-text-muted uppercase font-bold tracking-widest">Knowledge Nodes</p>
                 <p className="text-xs font-bold text-text-primary">{workspace.nodeCount}</p>
              </div>
              <div className="text-center">
                 <p className="text-[9px] text-text-muted uppercase font-bold tracking-widest">Last Index</p>
                 <p className="text-xs font-bold text-text-primary">
                   {workspace.lastIndexed ? new Date(workspace.lastIndexed).toLocaleDateString() : 'Never'}
                 </p>
              </div>
           </div>
           
           <button 
              onClick={handleReindex}
              disabled={reindexing}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-xs font-semibold hover:bg-accent-primary/20 transition-all disabled:opacity-40"
           >
              <RefreshCw className={`h-3 w-3 ${reindexing ? 'animate-spin' : ''}`} />
              {reindexing ? 'Indexing...' : 'Refresh Knowledge'}
           </button>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Knowledge Map */}
        <div className="flex-1 relative bg-bg-primary">
           <GraphView workspaceId={id} />
           
           <div className="absolute top-4 left-4 z-10 pointer-events-none">
              <div className="bg-bg-secondary/80 backdrop-blur-sm border border-border-primary rounded-xl p-3 flex items-center gap-3">
                 <Compass className="h-4 w-4 text-accent-primary" />
                 <span className="text-xs font-semibold text-text-secondary tracking-tight">Interactive Map Scoped to Context</span>
              </div>
           </div>

           {/* Toggle Sidebar Button (Floating) */}
           {!isSidebarOpen && (
             <button 
                onClick={() => setIsSidebarOpen(true)}
                className="absolute top-4 right-4 z-30 p-2.5 bg-bg-secondary border border-border-primary rounded-xl text-text-muted hover:text-accent-primary transition-all shadow-xl hover:scale-105 active:scale-95"
                title="Open Chat"
             >
                <Layers className="h-5 w-5" />
             </button>
           )}
        </div>

        {/* Right: Integrated Chat Sidebar */}
        <div className={clsx(
          "shrink-0 border-l border-border-primary transition-all duration-300 ease-in-out bg-bg-primary overflow-hidden",
          isSidebarOpen ? "w-[450px]" : "w-0"
        )}>
           <div className="h-full w-[450px] relative">
              <WorkspaceChat 
                workspaceId={id} 
                workspaceName={workspace.name} 
                onClose={() => setIsSidebarOpen(false)}
              />
           </div>
        </div>
      </div>
    </div>
  );
}
