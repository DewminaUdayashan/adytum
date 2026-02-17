import { File, Search, ExternalLink, HardDrive } from 'lucide-react';
import { clsx } from 'clsx';

interface SearchResult {
  score: string;
  path: string;
  content: string;
  tags?: string[];
}

interface SearchResultsData {
  query: string;
  count: number;
  results: SearchResult[];
}

export function SearchResults({ data }: { data: SearchResultsData }) {
  if (!data || !data.results) return null;

  return (
    <div className="rounded-xl border border-border-primary bg-bg-secondary/50 overflow-hidden my-2">
      {/* Header */}
      <div className="px-4 py-3 bg-bg-tertiary/30 border-b border-border-primary/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search size={14} className="text-accent-primary" />
          <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Semantic Search
          </span>
        </div>
        <span className="text-[10px] font-medium text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
          {data.count} results
        </span>
      </div>

      {/* Results List */}
      <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto custom-scrollbar">
        {data.results.map((result, idx) => (
          <div
            key={`${result.path}-${idx}`}
            className="group flex flex-col gap-2 p-3 rounded-lg hover:bg-bg-tertiary/40 transition-colors border border-transparent hover:border-border-primary/30"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <File size={14} className="text-text-tertiary shrink-0" />
                <span className="text-xs font-semibold text-text-primary truncate">
                  {result.path.split('/').pop()}
                </span>
                <span className="text-[10px] text-text-muted truncate hidden md:inline">
                  in {result.path}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={clsx(
                    'text-[9px] font-bold px-1.2 py-0.5 rounded uppercase tracking-tighter',
                    Number(result.score) > 0.8
                      ? 'text-success bg-success/10'
                      : Number(result.score) > 0.6
                        ? 'text-warning bg-warning/10'
                        : 'text-text-muted bg-bg-tertiary',
                  )}
                >
                  {Math.round(Number(result.score) * 100)}% match
                </span>
                <button
                  className="p-1 hover:bg-bg-hover rounded text-text-tertiary hover:text-accent-primary transition-colors"
                  title="Open file"
                >
                  <ExternalLink size={12} />
                </button>
              </div>
            </div>

            <p className="text-[11px] text-text-secondary line-clamp-2 leading-relaxed font-mono opacity-80 italic">
              "{result.content.trim().slice(0, 150)}..."
            </p>

            {result.tags && result.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="text-[8px] px-1 bg-accent-primary/5 text-accent-primary/70 rounded uppercase font-bold border border-accent-primary/10"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {data.count === 0 && (
        <div className="py-8 text-center text-text-muted text-xs">
          No results found for your query.
        </div>
      )}
    </div>
  );
}
