'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useGatewaySocket } from '@/hooks/use-gateway-socket';
import { PageHeader, Badge, Spinner } from '@/components/ui';
import { Send, Bot, User, Circle } from 'lucide-react';
import { clsx } from 'clsx';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: string[];
}

export default function ChatPage() {
  const { connected, events, sendMessage } = useGatewaySocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const sessionIdRef = useRef(crypto.randomUUID());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle incoming WebSocket events and turn them into chat messages
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[events.length - 1];

    if (latest.type === 'message' && latest.sessionId === sessionIdRef.current) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: String(latest.content || ''),
          timestamp: Date.now(),
        },
      ]);
      setIsThinking(false);
    }

    if (latest.type === 'stream' && latest.streamType === 'status') {
      // Could show streaming status
    }
  }, [events]);

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
    sendMessage(text, sessionIdRef.current);
    setInput('');
    setIsThinking(true);
  }, [input, connected, sendMessage]);

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Chat" subtitle="Full chat interface — like the terminal, but in your browser">
        <Badge variant={connected ? 'success' : 'error'}>
          <Circle className={clsx('h-2 w-2 mr-1', connected ? 'fill-adytum-success' : 'fill-adytum-error')} />
          {connected ? 'Connected' : 'Disconnected'}
        </Badge>
      </PageHeader>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-16 w-16 text-adytum-text-muted mb-4" />
            <h2 className="text-lg font-medium text-adytum-text-dim">Start a conversation</h2>
            <p className="text-sm text-adytum-text-muted mt-1 max-w-md">
              Type a message below to chat with your agent. All tool calls and reasoning will be visible in the console.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isThinking && (
          <div className="flex items-start gap-3 animate-fade-in">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-adytum-accent/15">
              <Bot className="h-4 w-4 text-adytum-accent" />
            </div>
            <div className="glass-card px-4 py-3 flex items-center gap-2">
              <Spinner size="sm" />
              <span className="text-sm text-adytum-text-muted">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-adytum-border p-4">
        <div className="flex items-center gap-2 rounded-xl bg-adytum-surface border border-adytum-border px-4 py-2 focus-within:border-adytum-accent transition-colors">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={connected ? 'Type a message...' : 'Connecting to gateway...'}
            disabled={!connected}
            className="flex-1 bg-transparent text-sm text-adytum-text placeholder:text-adytum-text-muted focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || !connected}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-adytum-accent text-white transition-colors hover:bg-adytum-accent-light disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={clsx('flex items-start gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={clsx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-adytum-info/15' : 'bg-adytum-accent/15',
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-adytum-info" />
        ) : (
          <Bot className="h-4 w-4 text-adytum-accent" />
        )}
      </div>
      <div
        className={clsx(
          'max-w-[70%] rounded-2xl px-4 py-3',
          isUser
            ? 'bg-adytum-accent text-white rounded-br-sm'
            : 'glass-card rounded-bl-sm',
        )}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        <span
          className={clsx(
            'mt-1 block text-xs',
            isUser ? 'text-white/60' : 'text-adytum-text-muted',
          )}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
