'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useGatewaySocket } from '@/hooks/use-gateway-socket';
import { Spinner } from '@/components/ui';
import { Send, Bot, User, Zap, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: string[];
}

export default function ChatPage() {
  const { connected, events, sendMessage, sessionId } = useGatewaySocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [pendingTools, setPendingTools] = useState<string[]>([]);
  const [hasRestored, setHasRestored] = useState(false);
  const pendingToolsRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore chat history from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem('adytum.chat.messages');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed);
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

  // Handle incoming WebSocket events
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];

    if (latest.type === 'message' && latest.sessionId === sessionId) {
      const tools = pendingToolsRef.current.length > 0 ? pendingToolsRef.current : undefined;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: String(latest.content || ''),
          timestamp: Date.now(),
          toolCalls: tools,
        },
      ]);
      pendingToolsRef.current = [];
      setPendingTools([]);
      setIsThinking(false);
    }

    if (latest.type === 'stream' && latest.streamType === 'tool_call' && latest.sessionId === sessionId) {
      const toolName = (latest as any).metadata?.tool
        || String(latest.delta || '').replace(/^Calling tool:\s*/i, '').trim();
      if (toolName) {
        setPendingTools((prev) => {
          const next = [...prev, toolName];
          pendingToolsRef.current = next;
          return next;
        });
      }
    }
  }, [events, sessionId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isThinking]);

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
    setIsThinking(true);
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

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isThinking && <ThinkingIndicator pendingTools={pendingTools} />}
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

function ThinkingIndicator({ pendingTools }: { pendingTools: string[] }) {
  return (
    <div className="flex items-start gap-3 animate-fade-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary">
        <Bot className="h-4 w-4 text-text-tertiary" />
      </div>
      <div className="rounded-xl border border-border-primary bg-bg-secondary/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <Spinner size="sm" />
          <span className="text-sm text-text-secondary">Thinking…</span>
          {pendingTools.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Zap className="h-3 w-3 text-warning" />
              <span className="font-mono">{pendingTools.join(', ')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
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
          <p className="whitespace-pre-wrap">{message.content}</p>
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
        </div>
      </div>
    </div>
  );
}
