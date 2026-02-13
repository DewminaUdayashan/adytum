'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useGatewaySocket, type StreamEvent } from '@/hooks/use-gateway-socket';
import { Send, Bot, User, Zap, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { MarkdownRenderer } from '@/components/chat/markdown-renderer';
import { LinkPreviewList } from '@/components/chat/link-previews';
import {
  ThinkingIndicator,
  type ThinkingActivityEntry,
} from '@/components/chat/thinking-indicator';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: string[];
  approvals?: Array<{
    id: string;
    description: string;
    kind: string;
    status?: 'pending' | 'approved' | 'denied';
  }>;
}

export default function ChatPage() {
  const { connected, events, sendMessage, sendFrame, sessionId } = useGatewaySocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [pendingTools, setPendingTools] = useState<string[]>([]);
  const [activeApprovals, setActiveApprovals] = useState<ChatMessage['approvals']>([]);
  const [activityFeed, setActivityFeed] = useState<ThinkingActivityEntry[]>([]);
  const [thinkingStartedAt, setThinkingStartedAt] = useState<number | null>(null);
  const [hasRestored, setHasRestored] = useState(false);
  const pendingToolsRef = useRef<string[]>([]);
  const eventCursorRef = useRef(0);
  const eventCursorInitializedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const processedApprovalsRef = useRef<Set<string>>(new Set());

  // Restore chat history from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem('adytum.chat.messages');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) {
          setMessages(parsed);
          // Populate processed approvals
          parsed.forEach(msg => {
            msg.approvals?.forEach(a => processedApprovalsRef.current.add(a.id));
          });
        }
      } catch {
        // ignore corrupt data
      }
    }
    setHasRestored(true);
  }, []);

  // Persist chat history
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hasRestored) return;
    window.localStorage.setItem('adytum.chat.messages', JSON.stringify(messages));
  }, [messages, hasRestored]);

  const pushActivity = useCallback(
    (type: ThinkingActivityEntry['type'], text: string) => {
      const compact = compactActivityText(text);
      if (!compact) return;

      setActivityFeed((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.type === type && last.text === compact) {
          return prev;
        }

        const next: ThinkingActivityEntry = {
          id: crypto.randomUUID(),
          type,
          text: compact,
          timestamp: Date.now(),
        };
        return [...prev.slice(-29), next];
      });
    },
    [],
  );

  // Handle incoming WebSocket events
  useEffect(() => {
    if (!eventCursorInitializedRef.current) {
      eventCursorInitializedRef.current = true;
      eventCursorRef.current = events.length;
      return;
    }

    if (events.length < eventCursorRef.current) {
      eventCursorRef.current = 0;
    }

    if (eventCursorRef.current >= events.length) return;

    for (let index = eventCursorRef.current; index < events.length; index += 1) {
      const event = events[index];

      if (event.type === 'message' && event.sessionId === sessionId) {
        const content = String(event.content || '').trim();
        if (!content) continue;

        const tools = pendingToolsRef.current.length > 0 ? [...pendingToolsRef.current] : undefined;
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          // If previous message was assistant (e.g. held the approval request), merge content
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
        setActiveApprovals([]); // Clear active approvals when response is finalized
        setIsThinking(false);
        setThinkingStartedAt(null);
        pushActivity('response', 'Response received.');
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

        // Add to active approvals for current ThinkingIndicator
        setActiveApprovals(prev => [...(prev || []), approval]);

        // Also add to message history
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            const updatedMsg = {
              ...lastMsg,
              approvals: [...(lastMsg.approvals || []), approval]
            };
            return [...prev.slice(0, -1), updatedMsg];
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

      if (event.type !== 'stream' || event.sessionId !== sessionId) {
        continue;
      }

      const streamType = String(event.streamType || '').toLowerCase();
      const detail = compactActivityText(String(event.delta || ''));

      if (streamType === 'tool_call') {
        const toolName = extractToolName(event, detail);
        if (toolName) {
          setPendingTools((prev) => {
            if (prev.includes(toolName)) return prev;
            const next = [...prev, toolName];
            pendingToolsRef.current = next;
            return next;
          });
          pushActivity('tool_call', `Running ${toolName}`);
        } else if (detail) {
          pushActivity('tool_call', detail);
        }
        continue;
      }

      if (streamType === 'tool_result') {
        const toolName = extractToolName(event, detail);
        if (toolName) {
          setPendingTools((prev) => {
            const next = prev.filter((tool) => tool !== toolName);
            pendingToolsRef.current = next;
            return next;
          });
          pushActivity('tool_result', `${toolName} completed`);
        } else if (detail) {
          pushActivity('tool_result', detail);
        }
        continue;
      }

      if (streamType === 'thinking') {
        if (detail) pushActivity('thinking', detail);
        continue;
      }

      if (streamType === 'response') {
        if (detail) pushActivity('response', detail);
        continue;
      }

      if (streamType === 'error') {
        pushActivity('error', detail || 'Error while generating response.');
        setIsThinking(false);
        setThinkingStartedAt(null);
        setActiveApprovals([]); // Clear on error
        continue;
      }

      if (streamType === 'status' && detail) {
        pushActivity('status', detail);
      }
    }

    eventCursorRef.current = events.length;
  }, [events, pushActivity, sessionId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isThinking, activityFeed.length, pendingTools.length, activeApprovals?.length]);

  const handleApproval = useCallback(
    (id: string, approved: boolean) => {
      sendFrame({ type: 'approval_response', id, approved });

      // Update active approvals
      setActiveApprovals(prev => prev?.map(a => a.id === id ? { ...a, status: approved ? 'approved' : 'denied' } : a));

      // Update message history
      setMessages((prev) => {
        return prev.map((msg) => {
          if (msg.approvals?.some((a) => a.id === id)) {
            return {
              ...msg,
              approvals: msg.approvals.map((a) =>
                a.id === id ? { ...a, status: approved ? 'approved' : 'denied' } : a
              ),
            };
          }
          return msg;
        });
      });
    },
    [sendFrame],
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !connected) return;

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, msg]);
    sendMessage(text, sessionId);
    setInput('');
    pendingToolsRef.current = [];
    setPendingTools([]);
    setActivityFeed([
      {
        id: crypto.randomUUID(),
        type: 'status',
        text: 'Request sent. Waiting for model…',
        timestamp: Date.now(),
      },
    ]);
    setThinkingStartedAt(Date.now());
    setIsThinking(true);
    setActiveApprovals([]); // Reset for new turn
  }, [input, connected, sendMessage, sessionId]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="px-8 pt-8 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted font-medium">Conversation</p>
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight mt-1">Chat</h1>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full ${connected ? 'bg-success animate-ping' : 'bg-text-muted'} opacity-75`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? 'bg-success' : 'bg-text-muted'}`} />
            </span>
            <span className={connected ? 'text-success' : 'text-text-muted'}>{connected ? 'Connected' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-8 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-tertiary mb-5">
              <Sparkles className="h-7 w-7 text-text-muted" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary mb-1">Start a conversation</h2>
            <p className="text-sm text-text-tertiary max-w-sm">
              Type a message to interact with your agent.
            </p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble 
            key={msg.id} 
            message={msg} 
            onApproval={handleApproval} 
            hidePending={isThinking && idx === messages.length - 1}
            disabled={!connected}
          />
        ))}

        {isThinking && (
          <ThinkingIndicator
            pendingTools={pendingTools}
            activities={activityFeed}
            startedAt={thinkingStartedAt}
            approvals={activeApprovals}
            onApproval={handleApproval}
          />
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border-primary px-8 py-5">
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center rounded-xl bg-bg-secondary border border-border-primary px-4 py-2.5 focus-within:border-accent-primary/50 transition-colors duration-150">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={connected ? 'Message your agent…' : 'Connecting…'}
              disabled={!connected}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:opacity-40"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || !connected}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary text-white transition-all hover:bg-accent-primary/80 disabled:opacity-30 disabled:pointer-events-none"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onApproval,
  hidePending,
  disabled,
}: {
  message: ChatMessage;
  onApproval: (id: string, approved: boolean) => void;
  hidePending?: boolean;
  disabled?: boolean;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={clsx('flex items-end gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={clsx(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold',
          isUser
            ? 'bg-accent-primary text-white'
            : 'bg-bg-tertiary text-text-tertiary',
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={clsx('flex flex-col gap-1', isUser && 'items-end')}>
        <div
          className={clsx(
            'max-w-xl rounded-xl px-4 py-3 text-sm leading-relaxed',
            isUser
              ? 'bg-accent-primary text-white rounded-br-sm'
              : 'bg-bg-secondary border border-border-primary text-text-primary rounded-bl-sm',
          )}
        >
          {message.content && (
            <MarkdownRenderer
              content={message.content}
              variant={isUser ? 'user' : 'assistant'}
            />
          )}

          {!isUser && <LinkPreviewList content={message.content} />}

          {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5 pt-2.5 border-t border-border-primary/30">
              {message.toolCalls.map((tool) => (
                <span
                  key={tool}
                  className="inline-flex items-center gap-1 rounded-md bg-bg-tertiary px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                >
                  <Zap className="h-2.5 w-2.5 text-warning" />
                  {tool}
                </span>
              ))}
            </div>
          )}

          {/* Inline Approvals */}
          {!isUser && message.approvals && message.approvals.length > 0 && (
            <div className="mt-3 space-y-2 pt-3 border-t border-border-primary/30">
              {message.approvals.map((req) => (
                <div
                  key={req.id}
                  className="rounded-lg border border-border-primary bg-bg-primary/40 px-3 py-2.5 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-bold text-text-primary uppercase tracking-wider">Approval Required</p>
                      <p className="text-xs text-text-muted mt-0.5 leading-tight">{req.description || req.kind}</p>
                    </div>
                    {req.status !== 'pending' && (
                      <span className={clsx(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter",
                        req.status === 'approved' ? "bg-success/20 text-success" : "bg-error/20 text-error"
                      )}>
                        {req.status}
                      </span>
                    )}
                  </div>

                  {req.status === 'pending' && !hidePending && (
                    <div className="flex gap-2 mt-1">
                      <button
                        className="flex-1 rounded-md bg-success/20 text-success px-2.5 py-1.5 text-xs font-semibold border border-success/40 transition-colors hover:bg-success/30 disabled:opacity-30"
                        onClick={() => onApproval(req.id, true)}
                        disabled={disabled}
                      >
                        Approve
                      </button>
                      <button
                        className="flex-1 rounded-md bg-error/15 text-error px-2.5 py-1.5 text-xs font-semibold border border-error/30 transition-colors hover:bg-error/25 disabled:opacity-30"
                        onClick={() => onApproval(req.id, false)}
                        disabled={disabled}
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
    </div>
  );
}

function compactActivityText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function extractToolName(event: StreamEvent, fallbackText: string): string {
  const metadata = (event.metadata || {}) as Record<string, unknown>;
  if (typeof metadata.tool === 'string' && metadata.tool.trim()) {
    return metadata.tool.trim();
  }

  const text = fallbackText
    .replace(/^calling tool:\s*/i, '')
    .replace(/^tool result:\s*/i, '')
    .trim();

  if (!text) return '';
  const token = text.split(/\s+/)[0] || '';
  return token.replace(/[^a-zA-Z0-9_.:-]/g, '');
}
