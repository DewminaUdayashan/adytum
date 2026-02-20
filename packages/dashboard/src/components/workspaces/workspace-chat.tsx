'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useGatewaySocket } from '@/hooks/use-gateway-socket';
import {
  Send,
  Bot,
  User,
  Zap,
  Sparkles,
  Paperclip,
  File,
  X,
  Loader2,
  ExternalLink,
  HardDrive,
} from 'lucide-react';
import { clsx } from 'clsx';
import { MarkdownRenderer } from '@/components/chat/markdown-renderer';
import { LinkPreviewList } from '@/components/chat/link-previews';
import {
  ThinkingIndicator,
  type ThinkingActivityEntry,
} from '@/components/chat/thinking-indicator';
import { ChatModelSelector } from '@/components/chat/model-selector';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: string[];
  attachments?: Array<{
    type: 'image' | 'file' | 'audio' | 'video';
    data: string;
    name?: string;
  }>;
  approvals?: Array<{
    id: string;
    description: string;
    kind: string;
    status?: 'pending' | 'approved' | 'denied';
  }>;
}

interface WorkspaceChatProps {
  workspaceId: string;
  workspaceName?: string;
  onClose?: () => void;
}

export function WorkspaceChat({ workspaceId, workspaceName, onClose }: WorkspaceChatProps) {
  const { connected, events, sendMessage, sendFrame, sessionId } = useGatewaySocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [pendingTools, setPendingTools] = useState<string[]>([]);
  const [activeApprovals, setActiveApprovals] = useState<ChatMessage['approvals']>([]);
  const [activityFeed, setActivityFeed] = useState<ThinkingActivityEntry[]>([]);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);

  const [selectedRole, setSelectedRole] = useState('thinking');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [attachments, setAttachments] = useState<
    Array<{ type: 'image' | 'file' | 'audio' | 'video'; data: string; name: string; file: File }>
  >([]);

  const pendingToolsRef = useRef<string[]>([]);
  const eventCursorRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processedApprovalsRef = useRef<Set<string>>(new Set());

  // Handle incoming WebSocket events
  useEffect(() => {
    if (eventCursorRef.current >= events.length) return;

    for (let index = eventCursorRef.current; index < events.length; index += 1) {
      const event = events[index];

      // Filter events by sessionId and workspaceId
      // Note: Some global broadcasts might not have workspaceId, but if they have sessionId
      // and we are the active session, we might want to show them if they are relevant.
      if (event.sessionId && event.sessionId !== sessionId) continue;

      // If event has workspaceId, it MUST match ours
      if (event.workspaceId && event.workspaceId !== workspaceId) continue;

      // If it's an approval request without workspaceId but matches our session, we take it
      // as it likely originated from our tool calls.

      if (event.type === 'message') {
        const content = String(event.content || '').trim();
        if (!content) continue;

        const tools = pendingToolsRef.current.length > 0 ? [...pendingToolsRef.current] : undefined;
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              {
                ...lastMsg,
                content,
                toolCalls: tools || lastMsg.toolCalls,
              },
            ];
          }
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content,
              timestamp: Date.now(),
              toolCalls: tools,
            },
          ];
        });
        pendingToolsRef.current = [];
        setPendingTools([]);
        setActiveApprovals([]);
        setIsThinking(false);
        setThinkingStartedAt(null);
        continue;
      }

      if (event.type === 'approval_request') {
        const id = String(event.id);
        if (processedApprovalsRef.current.has(id)) continue;
        processedApprovalsRef.current.add(id);

        const approval = {
          id,
          description: String(event.description || ''),
          kind: String(event.kind || ''),
          status: 'pending' as const,
        };

        setActiveApprovals((prev) => [...(prev || []), approval]);
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              { ...lastMsg, approvals: [...(lastMsg.approvals || []), approval] },
            ];
          } else {
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                approvals: [approval],
              },
            ];
          }
        });
        continue;
      }

      if (event.type === 'stream') {
        const streamType = String(event.streamType || '').toLowerCase();
        const delta = String(event.delta || '');

        if (streamType === 'tool_call') {
          const toolName = delta.replace(/^calling tool:\s*/i, '').split(/\s+/)[0] || 'tool';
          setPendingTools((prev) => (prev.includes(toolName) ? prev : [...prev, toolName]));
          setActivityFeed((prev) => [
            ...prev.slice(-19),
            {
              id: crypto.randomUUID(),
              type: 'tool_call',
              text: `Running ${toolName}`,
              timestamp: Date.now(),
            },
          ]);
        } else if (streamType === 'tool_result') {
          setActivityFeed((prev) => [
            ...prev.slice(-19),
            {
              id: crypto.randomUUID(),
              type: 'tool_result',
              text: `Tool completed`,
              timestamp: Date.now(),
            },
          ]);
        } else if (streamType === 'status' && delta) {
          setActivityFeed((prev) => [
            ...prev.slice(-19),
            {
              id: crypto.randomUUID(),
              type: 'status',
              text: delta.slice(0, 100),
              timestamp: Date.now(),
            },
          ]);
        }
      }
    }

    eventCursorRef.current = events.length;
  }, [events, sessionId, workspaceId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isThinking, activityFeed.length]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !connected) return;

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments: attachments.map((a) => ({ type: a.type, data: a.data, name: a.name })),
    };

    setMessages((prev) => [...prev, msg]);
    sendMessage(text, sessionId, {
      modelRole: selectedRole,
      modelId: selectedModelId || undefined,
      workspaceId,
      attachments: attachments.map((a) => ({ type: a.type, data: a.data, name: a.name })),
    });

    setInput('');
    setAttachments([]);
    setPendingTools([]);
    pendingToolsRef.current = [];
    setIsThinking(true);
    setThinkingStartedAt(Date.now());
    setActivityFeed([
      { id: crypto.randomUUID(), type: 'status', text: 'Thinking...', timestamp: Date.now() },
    ]);
  };

  const handleApproval = (id: string, approved: boolean) => {
    sendFrame({ type: 'approval_response', id, approved });
    setActiveApprovals((prev) =>
      prev?.map((a) => (a.id === id ? { ...a, status: approved ? 'approved' : 'denied' } : a)),
    );
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        approvals: m.approvals?.map((a) =>
          a.id === id ? { ...a, status: approved ? 'approved' : 'denied' } : a,
        ),
      })),
    );
  };

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-l border-border-primary overflow-hidden">
      {/* Mini Header */}
      <div className="px-6 py-4 border-b border-border-primary/50 bg-bg-tertiary/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-accent-primary/10 rounded-lg">
            <Sparkles className="h-4 w-4 text-accent-primary" />
          </div>
          <h2 className="text-xs font-bold text-text-primary uppercase tracking-widest">
            Workspace Agent
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-medium px-2 py-1 bg-bg-primary/40 rounded-full border border-border-primary/50">
            <div
              className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-text-muted'}`}
            />
            <span className="text-[10px] text-text-muted">{connected ? 'Live' : 'Offline'}</span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-bg-hover rounded-lg text-text-tertiary hover:text-text-primary transition-colors"
              title="Collapse Chat"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-6 scroll-smooth">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
            <div className="p-4 bg-bg-tertiary/20 rounded-full mb-4">
              <Bot className="h-10 w-10 text-text-muted" />
            </div>
            <p className="text-sm font-medium text-text-secondary">
              Ask anything about {workspaceName || 'this workspace'}
            </p>
            <p className="text-xs text-text-tertiary mt-2 max-w-[200px]">
              I can browse files, run commands, and help you understand the architecture.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={msg.id}
            className={clsx(
              'flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300',
              msg.role === 'user' ? 'items-end' : 'items-start',
            )}
          >
            {msg.role === 'assistant' && idx > 0 && messages[idx - 1].role !== 'assistant' && (
              <div className="flex items-center gap-2 mb-1 px-1">
                <div className="h-5 w-5 rounded-md bg-accent-primary/10 flex items-center justify-center">
                  <Bot className="h-3 w-3 text-accent-primary" />
                </div>
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-tighter">
                  Adytum Agent
                </span>
              </div>
            )}

            <div
              className={clsx(
                'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm transition-all hover:shadow-md',
                msg.role === 'user'
                  ? 'bg-accent-primary text-white rounded-tr-none'
                  : 'bg-bg-primary border border-border-primary text-text-primary rounded-tl-none',
              )}
            >
              {msg.content ? (
                <MarkdownRenderer
                  content={msg.content}
                  variant={msg.role === 'user' ? 'user' : 'assistant'}
                />
              ) : (
                msg.approvals &&
                msg.approvals.length > 0 && (
                  <p className="text-xs text-text-muted italic">
                    Awaiting approval for tool execution...
                  </p>
                )
              )}

              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {msg.attachments.map((at, i) => (
                    <div key={i} className="group relative">
                      {at.type === 'image' ? (
                        <div className="relative rounded-lg overflow-hidden border border-white/20 shadow-lg">
                          <img
                            src={at.data}
                            alt={at.name || 'attachment'}
                            className="max-w-[200px] max-h-[200px] object-cover transition-transform group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button className="p-2 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/30">
                              <ExternalLink className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 bg-white/10 hover:bg-white/20 p-3 rounded-xl border border-white/10 transition-colors">
                          <File className="h-5 w-5 text-white/70" />
                          <div className="flex flex-col">
                            <span className="text-[11px] font-bold text-white truncate max-w-[120px]">
                              {at.name || 'File'}
                            </span>
                            <span className="text-[9px] text-white/50 uppercase font-black tracking-widest">
                              {at.type}
                            </span>
                          </div>
                          <button className="ml-2 p-1.5 hover:bg-white/10 rounded-lg text-white/70">
                            <HardDrive className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {msg.approvals && msg.approvals.length > 0 && (
                <div className="mt-3 space-y-2">
                  {msg.approvals.map((a) => (
                    <div
                      key={a.id}
                      className={clsx(
                        'rounded-xl p-3 border shadow-sm transition-all',
                        a.status === 'pending'
                          ? 'bg-bg-tertiary/50 border-border-primary/50'
                          : a.status === 'approved'
                            ? 'bg-success/5 border-success/20'
                            : 'bg-error/5 border-error/20',
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] uppercase font-bold text-text-muted tracking-widest">
                          {a.status === 'pending' ? 'Approval Required' : `Action ${a.status}`}
                        </span>
                        {a.status !== 'pending' && (
                          <div
                            className={clsx(
                              'h-1.5 w-1.5 rounded-full',
                              a.status === 'approved' ? 'bg-success' : 'bg-error',
                            )}
                          />
                        )}
                      </div>
                      <p className="text-xs text-text-secondary leading-tight mb-3">
                        {a.description}
                      </p>

                      {a.status === 'pending' && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApproval(a.id, true)}
                            className="flex-1 bg-success/20 hover:bg-success/30 text-success text-[10px] font-bold py-1.5 rounded-lg transition-all border border-success/30 active:scale-95 shadow-sm"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleApproval(a.id, false)}
                            className="flex-1 bg-error/10 hover:bg-error/20 text-error text-[10px] font-bold py-1.5 rounded-lg transition-all border border-error/20 active:scale-95 shadow-sm"
                          >
                            Deny
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {isThinking && (
          <ThinkingIndicator
            activities={activityFeed}
            pendingTools={pendingTools}
            startedAt={thinkingStartedAt}
            approvals={activeApprovals}
            onApproval={handleApproval}
          />
        )}
      </div>

      {/* Input area */}
      <div className="p-4 bg-bg-tertiary/10 border-t border-border-primary">
        <div className="flex flex-col gap-3">
          <ChatModelSelector
            selectedRole={selectedRole}
            selectedModelId={selectedModelId}
            onRoleChange={setSelectedRole}
            onModelChange={setSelectedModelId}
          />

          <div className="flex items-center gap-2 bg-bg-primary border border-border-primary rounded-xl px-3 py-2 focus-within:border-accent-primary/40 transition-colors">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask a question..."
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !connected}
              className="p-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 disabled:opacity-40 transition-all shadow-md shadow-accent-primary/20"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
