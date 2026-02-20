'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Folder,
  FileText,
  Trash2,
  ArrowRight,
  HardDrive,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Workspace } from '@adytum/shared';
import { FilePicker } from '@/components/workspaces/file-picker';

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState<{
    name: string;
    path: string;
    type: 'project' | 'collection';
  }>({
    name: '',
    path: '',
    type: 'project',
  });
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const fetchWorkspaces = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/workspaces');
      setWorkspaces(data.workspaces || []);
    } catch (error) {
      console.error('Failed to fetch workspaces:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchWorkspaces();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkspace.name || !newWorkspace.path) return;

    setCreating(true);
    try {
      await api.post('/api/workspaces', newWorkspace);
      setNewWorkspace({ name: '', path: '', type: 'project' });
      await fetchWorkspaces();
    } catch (error) {
      console.error('Failed to create workspace:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this workspace? This won't delete your local files, but it will remove the knowledge graph.",
      )
    )
      return;

    try {
      await api.delete(`/api/workspaces/${id}`);
      await fetchWorkspaces();
    } catch (error) {
      console.error('Failed to delete workspace:', error);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-10">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">
            Workspaces
          </p>
          <h1 className="text-3xl font-semibold text-text-primary tracking-tight mt-1">
            Manage Your Projects
          </h1>
        </div>
        <button
          onClick={fetchWorkspaces}
          className="p-2 hover:bg-bg-hover rounded-lg text-text-tertiary transition-colors"
          title="Refresh list"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Creation Card */}
        <div className="lg:col-span-1">
          <div className="bg-bg-secondary border border-border-primary rounded-2xl p-6 sticky top-8">
            <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Plus className="h-5 w-5 text-accent-primary" />
              New Workspace
            </h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5 ml-1">
                  Name
                </label>
                <input
                  type="text"
                  value={newWorkspace.name}
                  onChange={(e) => setNewWorkspace((pw) => ({ ...pw, name: e.target.value }))}
                  placeholder="e.g. My Awesome Project"
                  className="w-full bg-bg-primary border border-border-primary rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary/50 focus:outline-none transition-colors"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5 ml-1">
                  Local Path
                </label>
                <div className="relative group">
                  <input
                    type="text"
                    value={newWorkspace.path}
                    onChange={(e) => setNewWorkspace((pw) => ({ ...pw, path: e.target.value }))}
                    placeholder="/Users/name/projects/my-app"
                    className="w-full bg-bg-primary border border-border-primary rounded-xl pl-4 pr-12 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary/50 focus:outline-none transition-colors"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setIsPickerOpen(true)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 hover:bg-bg-hover rounded-lg text-accent-primary transition-all active:scale-95"
                    title="Browse local files"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-text-tertiary px-1 leading-relaxed">
                  Provide the absolute path to a folder or file you want to index.
                </p>
              </div>
              <div className="flex gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => setNewWorkspace((pw) => ({ ...pw, type: 'project' }))}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${newWorkspace.type === 'project' ? 'bg-accent-primary/10 border-accent-primary text-accent-primary' : 'bg-bg-primary border-border-primary text-text-muted hover:border-text-muted'}`}
                >
                  Project
                </button>
                <button
                  type="button"
                  onClick={() => setNewWorkspace((pw) => ({ ...pw, type: 'collection' }))}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${newWorkspace.type === 'collection' ? 'bg-accent-primary/10 border-accent-primary text-accent-primary' : 'bg-bg-primary border-border-primary text-text-muted hover:border-text-muted'}`}
                >
                  Collection
                </button>
              </div>
              <button
                type="submit"
                disabled={creating || !newWorkspace.name || !newWorkspace.path}
                className="w-full bg-accent-primary text-white rounded-xl py-3 text-sm font-semibold mt-4 transition-all hover:bg-accent-primary/90 disabled:opacity-40 shadow-lg shadow-accent-primary/10"
              >
                {creating ? 'Creating...' : 'Register Workspace'}
              </button>
            </form>
          </div>
        </div>

        {/* Workspaces List */}
        <div className="lg:col-span-2">
          {loading && workspaces.length === 0 ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-bg-secondary border border-border-primary rounded-2xl p-6 animate-pulse"
                >
                  <div className="h-4 bg-bg-tertiary rounded w-1/3 mb-4" />
                  <div className="h-3 bg-bg-tertiary rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : workspaces.length === 0 ? (
            <div className="bg-bg-secondary border border-border-primary border-dashed rounded-3xl p-16 flex flex-col items-center justify-center text-center">
              <div className="h-16 w-16 bg-bg-tertiary rounded-2xl flex items-center justify-center mb-6">
                <Folder className="h-8 w-8 text-text-muted" />
              </div>
              <h3 className="text-xl font-semibold text-text-primary mb-2">No workspaces found</h3>
              <p className="text-text-tertiary max-w-sm text-sm">
                Create your first workspace by selecting a project directory or a collection of
                notes to start indexing your knowledge.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {workspaces.map((ws) => (
                <div
                  key={ws.id}
                  className="group bg-bg-secondary border border-border-primary rounded-2xl p-6 transition-all hover:border-accent-primary/30 hover:shadow-xl hover:shadow-black/5 flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-1">
                      {ws.type === 'project' ? (
                        <Folder className="h-4 w-4 text-accent-primary" />
                      ) : (
                        <FileText className="h-4 w-4 text-warning" />
                      )}
                      <h3 className="text-lg font-semibold text-text-primary truncate">
                        {ws.name}
                      </h3>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-tertiary uppercase font-bold tracking-tighter">
                        {ws.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-muted truncate">
                      <HardDrive className="h-3 w-3 shrink-0" />
                      <span className="truncate">{ws.path}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-4">
                      <div className="text-center">
                        <p className="text-[10px] text-text-muted uppercase font-medium">Nodes</p>
                        <p className="text-sm font-semibold text-text-primary">{ws.nodeCount}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-text-muted uppercase font-medium">Edges</p>
                        <p className="text-sm font-semibold text-text-primary">{ws.edgeCount}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] text-text-muted uppercase font-medium">Status</p>
                        <p
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${ws.lastIndexed ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}
                        >
                          {ws.lastIndexed ? 'Indexed' : 'Pending'}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDelete(ws.id)}
                      className="p-3 text-text-tertiary hover:text-error hover:bg-error/10 rounded-xl transition-all"
                      title="Delete workspace"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                    <Link
                      href={`/workspaces/${ws.id}`}
                      className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-tertiary text-text-primary transition-all group-hover:bg-accent-primary group-hover:text-white group-hover:scale-105 active:scale-95 shadow-sm"
                    >
                      <ArrowRight className="h-5 w-5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <FilePicker
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        onSelect={(path) => {
          setNewWorkspace((pw) => ({ ...pw, path }));
          setIsPickerOpen(false);
        }}
      />
    </div>
  );
}
