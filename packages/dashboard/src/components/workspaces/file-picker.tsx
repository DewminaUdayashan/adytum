'use client';

import { useState, useEffect } from 'react';
import {
  Folder,
  File,
  ChevronRight,
  Home,
  ArrowLeft,
  X,
  Check,
  Loader2,
  Search,
} from 'lucide-react';
import { api } from '@/lib/api';
import { clsx } from 'clsx';

interface FileItem {
  name: string;
  path: string;
  type: 'directory' | 'file';
}

interface BrowseResponse {
  currentPath: string;
  parentPath: string;
  items: FileItem[];
}

interface FilePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  title?: string;
}

export function FilePicker({
  isOpen,
  onClose,
  onSelect,
  title = 'Select Directory',
}: FilePickerProps) {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string>('');
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchPath = async (path?: string) => {
    setLoading(true);
    try {
      const data = await api.get(
        `/api/system/browse${path ? `?p=${encodeURIComponent(path)}` : ''}`,
      );
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setItems(data.items);
    } catch (error) {
      console.error('Failed to browse path:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void fetchPath();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-bg-secondary border border-border-primary rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="px-6 py-5 border-b border-border-primary/50 flex items-center justify-between bg-bg-tertiary/20">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-accent-primary/10 rounded-xl flex items-center justify-center text-accent-primary border border-accent-primary/20">
              <Folder className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary tracking-tight">{title}</h2>
              <p className="text-[10px] text-text-tertiary font-medium uppercase tracking-widest truncate max-w-[300px]">
                {currentPath}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-hover rounded-xl text-text-tertiary transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-4 border-b border-border-primary/30 flex items-center gap-3">
          <button
            onClick={() => fetchPath(parentPath)}
            disabled={currentPath === parentPath || loading}
            className="p-2 hover:bg-bg-hover rounded-lg text-text-secondary disabled:opacity-30 transition-all border border-border-primary/50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => fetchPath()}
            disabled={loading}
            className="p-2 hover:bg-bg-hover rounded-lg text-text-secondary transition-all border border-border-primary/50"
          >
            <Home className="h-4 w-4" />
          </button>

          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" />
            <input
              type="text"
              placeholder="Search folders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-bg-primary border border-border-primary/50 rounded-lg pl-9 pr-4 py-1.5 text-xs text-text-primary focus:border-accent-primary/40 focus:outline-none transition-all placeholder:text-text-tertiary"
            />
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-2 min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center h-full gap-3 opacity-50">
              <Loader2 className="h-5 w-5 animate-spin text-accent-primary" />
              <span className="text-xs font-semibold uppercase tracking-widest text-text-muted">
                Accessing Filesystem...
              </span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20 opacity-30">
              <Folder className="h-10 w-10 mb-2" />
              <p className="text-sm font-medium">No results found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1">
              {filteredItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => (item.type === 'directory' ? fetchPath(item.path) : null)}
                  className={clsx(
                    'group flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-left border border-transparent',
                    item.type === 'directory'
                      ? 'hover:bg-accent-primary/5 hover:border-accent-primary/20'
                      : 'opacity-40 cursor-not-allowed',
                  )}
                >
                  {item.type === 'directory' ? (
                    <Folder className="h-4 w-4 text-accent-primary shrink-0 transition-transform group-hover:scale-110" />
                  ) : (
                    <File className="h-4 w-4 text-text-tertiary shrink-0" />
                  )}
                  <span className="flex-1 text-sm font-medium text-text-secondary truncate group-hover:text-text-primary">
                    {item.name}
                  </span>
                  {item.type === 'directory' && (
                    <ChevronRight className="h-3 w-3 text-text-tertiary opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-5 border-t border-border-primary/50 bg-bg-tertiary/10 flex items-center justify-between">
          <div className="flex-1 truncate mr-4">
            <p className="text-[10px] text-text-tertiary font-bold uppercase tracking-widest mb-1">
              Selected Region
            </p>
            <p className="text-xs text-text-secondary font-medium truncate italic">{currentPath}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2 text-xs font-bold text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onSelect(currentPath)}
              className="flex items-center gap-2 bg-accent-primary text-white rounded-xl px-6 py-2.5 text-xs font-bold shadow-lg shadow-accent-primary/20 hover:scale-105 active:scale-95 transition-all"
            >
              <Check className="h-4 w-4" />
              Confirm Path
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
