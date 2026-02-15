/**
 * @file packages/dashboard/src/app/layout.tsx
 * @description Defines route-level UI composition and page behavior.
 */

import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';

export const metadata: Metadata = {
  title: 'Adytum — Agentic Control',
  description: 'Real-time observability and control for your AI agent.',
  themeColor: '#06080f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        suppressHydrationWarning
        className="flex h-full w-full overflow-hidden bg-bg-primary text-text-primary antialiased selection:bg-accent-primary/30 selection:text-white"
      >
        <Sidebar />
        <main className="relative flex flex-1 flex-col min-w-0 overflow-hidden bg-gradient-to-br from-bg-primary to-bg-secondary">
          {/* Ambient background effects */}
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <div className="absolute top-[-20%] left-[-10%] h-[600px] w-[600px] rounded-full bg-accent-primary/[0.03] blur-[120px]" />
            <div className="absolute bottom-[-20%] right-[-10%] h-[500px] w-[500px] rounded-full bg-accent-secondary/[0.03] blur-[120px]" />
          </div>

          {/* Content */}
          <div className="relative z-10 flex h-full flex-col">{children}</div>
        </main>
      </body>
    </html>
  );
}
