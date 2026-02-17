/**
 * @file workspace/skills/browser-control/index.ts
 * @description Cross-platform browser automation tools using Playwright sessions.
 */

import { Buffer } from 'node:buffer';
import { z } from 'zod';

const SUPPORTED_BROWSERS = ['chromium', 'chrome', 'msedge', 'firefox', 'webkit', 'safari'] as const;
const EXTRACT_MODES = ['text', 'html', 'links', 'forms'] as const;
const LOAD_STATES = ['load', 'domcontentloaded', 'networkidle'] as const;

type SupportedBrowser = (typeof SUPPORTED_BROWSERS)[number];
type ExtractMode = (typeof EXTRACT_MODES)[number];
type LoadState = (typeof LOAD_STATES)[number];
type EngineName = 'chromium' | 'firefox' | 'webkit';

type SkillLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

type RegisteredTool = {
  name: string;
  description: string;
  parameters: z.ZodTypeAny;
  execute: (args: unknown) => Promise<unknown>;
};

type RegisteredService = {
  id: string;
  start: (_ctx: unknown) => Promise<void> | void;
  stop?: (_ctx: unknown) => Promise<void> | void;
};

type BrowserControlApi = {
  pluginConfig?: unknown;
  logger: SkillLogger;
  registerTool: (tool: RegisteredTool) => void;
  registerService: (service: RegisteredService) => void;
};

type LaunchOptions = {
  headless?: boolean;
  timeout?: number;
  slowMo?: number;
  channel?: string;
};

type BrowserType = {
  launch: (options?: LaunchOptions) => Promise<BrowserInstance>;
};

type BrowserInstance = {
  newContext: (options?: Record<string, unknown>) => Promise<BrowserContextInstance>;
  close: () => Promise<void>;
  isConnected?: () => boolean;
};

type BrowserContextInstance = {
  newPage: () => Promise<PageInstance>;
  setDefaultTimeout?: (timeout: number) => void;
  setDefaultNavigationTimeout?: (timeout: number) => void;
  close: () => Promise<void>;
};

type PageInstance = {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  title: () => Promise<string>;
  url: () => string;
  evaluate: <TResult = unknown, TArg = unknown>(
    pageFunction: (arg: TArg) => TResult | Promise<TResult>,
    arg: TArg,
  ) => Promise<TResult>;
  waitForLoadState?: (state?: LoadState, options?: Record<string, unknown>) => Promise<void>;
};

type PlaywrightModule = {
  chromium: BrowserType;
  firefox: BrowserType;
  webkit: BrowserType;
};

type BrowserTarget = {
  requested: SupportedBrowser;
  engine: EngineName;
  channel?: 'chrome' | 'msedge';
  key: string;
};

type BrowserSession = {
  target: BrowserTarget;
  browser: BrowserInstance;
  context: BrowserContextInstance;
  page: PageInstance;
  createdAt: string;
};

type StructuredPayload = {
  ok: boolean;
  result?: unknown;
  error?: unknown;
};

const PluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultBrowser: z.enum(SUPPORTED_BROWSERS).default('chrome'),
  headless: z.boolean().default(false),
  openInNewTab: z.boolean().default(false),
  launchTimeoutMs: z.number().int().min(1000).max(120000).default(20000),
  actionTimeoutMs: z.number().int().min(500).max(60000).default(10000),
  navigationTimeoutMs: z.number().int().min(1000).max(180000).default(30000),
  defaultWaitMs: z.number().int().min(0).max(15000).default(1200),
  slowMoMs: z.number().int().min(0).max(2000).default(0),
  allowMutations: z.boolean().default(true),
  allowArbitraryEval: z.boolean().default(true),
  maxEvalChars: z.number().int().min(100).max(100000).default(12000),
  maxExtractChars: z.number().int().min(500).max(120000).default(12000),
  maxExtractItems: z.number().int().min(1).max(1000).default(80),
});

const BrowserOpenSchema = z.object({
  url: z.string().describe('Absolute URL to open (http/https).'),
  browser: z.enum(SUPPORTED_BROWSERS).optional(),
  newTab: z.boolean().optional().describe('Open in a new tab within the same browser session.'),
  waitMs: z.number().int().min(0).max(15000).optional().describe('Wait after navigation.'),
  waitUntil: z.enum(LOAD_STATES).default('networkidle').describe('Navigation readiness target.'),
  timeoutMs: z.number().int().min(1000).max(180000).optional().describe('Navigation timeout.'),
});

const BrowserClickSchema = z.object({
  selector: z.string().describe('CSS selector for the element to click.'),
  browser: z.enum(SUPPORTED_BROWSERS).optional(),
  waitMs: z.number().int().min(0).max(15000).optional(),
});

const BrowserTypeSchema = z.object({
  selector: z.string().describe('CSS selector for input/textarea/contenteditable element.'),
  text: z.string().describe('Text to type or insert.'),
  clear: z.boolean().default(true),
  submit: z.boolean().default(false),
  browser: z.enum(SUPPORTED_BROWSERS).optional(),
  waitMs: z.number().int().min(0).max(15000).optional(),
});

const BrowserEvalSchema = z.object({
  script: z
    .string()
    .describe(
      'JavaScript for page context. mode=expression evaluates and returns it. mode=function executes as function body.',
    ),
  mode: z.enum(['expression', 'function']).default('expression'),
  browser: z.enum(SUPPORTED_BROWSERS).optional(),
});

const BrowserExtractSchema = z.object({
  mode: z.enum(EXTRACT_MODES).default('text'),
  selector: z.string().optional().describe('Optional CSS selector for scoping extraction.'),
  maxChars: z.number().int().min(100).max(120000).optional(),
  maxItems: z.number().int().min(1).max(1000).optional(),
  browser: z.enum(SUPPORTED_BROWSERS).optional(),
});

const BrowserCloseSchema = z.object({
  browser: z.enum(SUPPORTED_BROWSERS).optional(),
  all: z.boolean().default(false).describe('Close all browser sessions for this skill.'),
});

const BrowserScrollSchema = z.object({
  direction: z.enum(['up', 'down', 'top', 'bottom']).default('down'),
  amount: z.number().int().min(100).max(5000).optional().describe('Pixels to scroll.'),
  browser: z.enum(SUPPORTED_BROWSERS).optional(),
});

const sessions = new Map<string, BrowserSession>();
let activeSessionKey: string | null = null;
let playwrightPromise: Promise<PlaywrightModule> | null = null;

const browserControlPlugin = {
  id: 'browser-control',
  name: 'Browser Control',
  description:
    'Cross-platform browser automation with persistent sessions: open pages, click/type, run JS, extract data.',

  register(api: BrowserControlApi) {
    const config = resolveConfig(api.pluginConfig);
    const logger = api.logger;

    if (!config.enabled) {
      logger.info('browser-control disabled by plugin config (enabled=false).');
      return;
    }

    api.registerService({
      id: 'browser-control-runtime',
      start: () => undefined,
      stop: async () => {
        await closeAllSessions(logger);
      },
    });

    api.registerTool({
      name: 'browser_open',
      description:
        'Open URL in Chromium/Chrome/Edge/Firefox/WebKit and return a compact page snapshot.',
      parameters: BrowserOpenSchema,
      execute: async (rawArgs: unknown) => {
        const parsedArgs = parseToolArgs(BrowserOpenSchema, rawArgs);
        if (!parsedArgs.success) return parsedArgs.response;

        const args = parsedArgs.data;
        const target = resolveTarget(args.browser || config.defaultBrowser);
        const timeoutMs = args.timeoutMs ?? config.navigationTimeoutMs;
        const waitMs = args.waitMs ?? config.defaultWaitMs;
        const newTab = args.newTab ?? config.openInNewTab;

        let url: string;
        try {
          url = normalizeUrl(args.url);
        } catch (err: unknown) {
          return {
            error: 'Invalid URL',
            details: errorMessage(err),
          };
        }

        try {
          const session = await ensureSession(target, config);
          if (newTab) {
            session.page = await session.context.newPage();
          }

          await session.page.goto(url, {
            waitUntil: args.waitUntil,
            timeout: timeoutMs,
          });
          await settlePage(session.page, waitMs, Math.min(timeoutMs, config.navigationTimeoutMs));

          const snapshot = await readPageSnapshot(session.page);
          activeSessionKey = target.key;

          return {
            ok: true,
            browser: target.requested,
            engine: target.engine,
            channel: target.channel || null,
            sessionKey: target.key,
            urlOpened: url,
            waitUntil: args.waitUntil,
            waitMs,
            snapshot,
          };
        } catch (err: unknown) {
          return normalizeBrowserError(err, target, 'open');
        }
      },
    });

    api.registerTool({
      name: 'browser_click',
      description: 'Click an element on the active page by CSS selector.',
      parameters: BrowserClickSchema,
      execute: async (rawArgs: unknown) => {
        const parsedArgs = parseToolArgs(BrowserClickSchema, rawArgs);
        if (!parsedArgs.success) return parsedArgs.response;

        if (!config.allowMutations) {
          return {
            error: 'Page mutations are disabled',
            guidance:
              'Enable skills.entries.browser-control.config.allowMutations to use browser_click.',
          };
        }

        const args = parsedArgs.data;
        const session = getActionSession(args.browser, config.defaultBrowser);
        if (!session) return noActiveSessionResponse();

        try {
          const result = await runStructuredPageScript(
            session.page,
            [
              `const selector = ${JSON.stringify(args.selector.trim())};`,
              'if (!selector) { return { clicked: false, error: "selector is required" }; }',
              'const element = document.querySelector(selector);',
              'if (!element) { return { clicked: false, selector, error: "Selector not found" }; }',
              'if (typeof element.scrollIntoView === "function") {',
              '  element.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });',
              '}',
              'if (typeof element.focus === "function") { element.focus(); }',
              'element.click();',
              'return {',
              '  clicked: true,',
              '  selector,',
              '  tag: String(element.tagName || "").toLowerCase(),',
              '  text: String(element.textContent || "").trim().slice(0, 160),',
              '};',
            ].join('\n'),
          );
          await settlePage(
            session.page,
            args.waitMs ?? config.defaultWaitMs,
            config.actionTimeoutMs,
          );
          activeSessionKey = session.target.key;
          return {
            ok: true,
            browser: session.target.requested,
            ...asRecord(result),
          };
        } catch (err: unknown) {
          return normalizeBrowserError(err, session.target, 'click');
        }
      },
    });

    api.registerTool({
      name: 'browser_type',
      description: 'Type into field/contenteditable by CSS selector on the active page.',
      parameters: BrowserTypeSchema,
      execute: async (rawArgs: unknown) => {
        const parsedArgs = parseToolArgs(BrowserTypeSchema, rawArgs);
        if (!parsedArgs.success) return parsedArgs.response;

        if (!config.allowMutations) {
          return {
            error: 'Page mutations are disabled',
            guidance:
              'Enable skills.entries.browser-control.config.allowMutations to use browser_type.',
          };
        }

        const args = parsedArgs.data;
        const session = getActionSession(args.browser, config.defaultBrowser);
        if (!session) return noActiveSessionResponse();

        try {
          const result = await runStructuredPageScript(
            session.page,
            [
              `const selector = ${JSON.stringify(args.selector.trim())};`,
              `const value = ${JSON.stringify(args.text)};`,
              `const clear = ${JSON.stringify(args.clear)};`,
              `const submit = ${JSON.stringify(args.submit)};`,
              'if (!selector) { return { typed: false, error: "selector is required" }; }',
              'const element = document.querySelector(selector);',
              'if (!element) { return { typed: false, selector, error: "Selector not found" }; }',
              'if (typeof element.focus === "function") { element.focus(); }',
              'let targetKind = "";',
              'if ("value" in element) {',
              '  if (clear) element.value = "";',
              '  element.value = clear ? value : String(element.value || "") + value;',
              '  element.dispatchEvent(new Event("input", { bubbles: true }));',
              '  element.dispatchEvent(new Event("change", { bubbles: true }));',
              '  targetKind = String(element.tagName || "").toLowerCase();',
              '} else if (element.isContentEditable) {',
              '  if (clear) element.textContent = "";',
              '  element.textContent = clear ? value : String(element.textContent || "") + value;',
              '  element.dispatchEvent(new Event("input", { bubbles: true }));',
              '  targetKind = "contenteditable";',
              '} else {',
              '  return {',
              '    typed: false,',
              '    selector,',
              '    error: "Target is not input/textarea/select/contenteditable",',
              '  };',
              '}',
              'if (submit) {',
              '  if (element.form && typeof element.form.requestSubmit === "function") {',
              '    element.form.requestSubmit();',
              '  } else {',
              '    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));',
              '    element.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));',
              '  }',
              '}',
              'const preview = ("value" in element',
              '  ? String(element.value || "")',
              '  : String(element.textContent || "")).slice(0, 160);',
              'return {',
              '  typed: true,',
              '  selector,',
              '  targetKind,',
              '  submit,',
              '  valuePreview: preview,',
              '};',
            ].join('\n'),
          );
          await settlePage(
            session.page,
            args.waitMs ?? config.defaultWaitMs,
            config.actionTimeoutMs,
          );
          activeSessionKey = session.target.key;
          return {
            ok: true,
            browser: session.target.requested,
            ...asRecord(result),
          };
        } catch (err: unknown) {
          return normalizeBrowserError(err, session.target, 'type');
        }
      },
    });

    api.registerTool({
      name: 'browser_eval',
      description: 'Run custom JavaScript in the active tab and return structured output.',
      parameters: BrowserEvalSchema,
      execute: async (rawArgs: unknown) => {
        const parsedArgs = parseToolArgs(BrowserEvalSchema, rawArgs);
        if (!parsedArgs.success) return parsedArgs.response;

        if (!config.allowArbitraryEval) {
          return {
            error: 'Arbitrary eval is disabled',
            guidance:
              'Enable skills.entries.browser-control.config.allowArbitraryEval to use browser_eval.',
          };
        }

        const args = parsedArgs.data;
        const session = getActionSession(args.browser, config.defaultBrowser);
        if (!session) return noActiveSessionResponse();

        const script = args.script.trim();
        if (!script) {
          return { error: 'script is required' };
        }
        if (script.length > config.maxEvalChars) {
          return {
            error: 'script exceeds max length',
            maxEvalChars: config.maxEvalChars,
            receivedChars: script.length,
          };
        }

        const functionBody = args.mode === 'expression' ? `return (${script});` : script;
        try {
          const result = await runStructuredPageScript(session.page, functionBody);
          activeSessionKey = session.target.key;
          return {
            ok: true,
            browser: session.target.requested,
            mode: args.mode,
            result,
          };
        } catch (err: unknown) {
          return normalizeBrowserError(err, session.target, 'eval');
        }
      },
    });

    api.registerTool({
      name: 'browser_extract',
      description: 'Extract text/html/links/forms from the active page.',
      parameters: BrowserExtractSchema,
      execute: async (rawArgs: unknown) => {
        const parsedArgs = parseToolArgs(BrowserExtractSchema, rawArgs);
        if (!parsedArgs.success) return parsedArgs.response;

        const args = parsedArgs.data;
        const session = getActionSession(args.browser, config.defaultBrowser);
        if (!session) return noActiveSessionResponse();

        const maxChars = clamp(
          args.maxChars ?? config.maxExtractChars,
          100,
          config.maxExtractChars,
        );
        const maxItems = clamp(args.maxItems ?? config.maxExtractItems, 1, config.maxExtractItems);

        try {
          const result = await runStructuredPageScript(
            session.page,
            buildExtractFunctionBody(
              args.mode,
              args.selector?.trim() || undefined,
              maxChars,
              maxItems,
            ),
          );
          activeSessionKey = session.target.key;
          return {
            ok: true,
            browser: session.target.requested,
            mode: args.mode,
            selector: args.selector?.trim() || null,
            ...asRecord(result),
          };
        } catch (err: unknown) {
          return normalizeBrowserError(err, session.target, 'extract');
        }
      },
    });

    api.registerTool({
      name: 'browser_scroll',
      description: 'Scroll the active page up, down, or to top/bottom.',
      parameters: BrowserScrollSchema,
      execute: async (rawArgs: unknown) => {
        const parsedArgs = parseToolArgs(BrowserScrollSchema, rawArgs);
        if (!parsedArgs.success) return parsedArgs.response;

        const args = parsedArgs.data;
        const session = getActionSession(args.browser, config.defaultBrowser);
        if (!session) return noActiveSessionResponse();

        try {
          const result = await runStructuredPageScript(
            session.page,
            [
              `const direction = ${JSON.stringify(args.direction)};`,
              `const amount = ${args.amount ?? 600};`,
              'if (direction === "top") { window.scrollTo(0, 0); }',
              'else if (direction === "bottom") { window.scrollTo(0, document.body.scrollHeight); }',
              'else if (direction === "up") { window.scrollBy(0, -amount); }',
              'else { window.scrollBy(0, amount); }',
              'return { scrolled: true, direction, amount: (direction === "top" || direction === "bottom") ? "max" : amount };',
            ].join('\n'),
          );
          await sleep(400); // Small settle for visual effects
          activeSessionKey = session.target.key;
          return {
            ok: true,
            browser: session.target.requested,
            ...asRecord(result),
          };
        } catch (err: unknown) {
          return normalizeBrowserError(err, session.target, 'scroll');
        }
      },
    });

    api.registerTool({
      name: 'browser_close',
      description: 'Close one browser session or all sessions owned by browser-control skill.',
      parameters: BrowserCloseSchema,
      execute: async (rawArgs: unknown) => {
        const parsedArgs = parseToolArgs(BrowserCloseSchema, rawArgs);
        if (!parsedArgs.success) return parsedArgs.response;

        const args = parsedArgs.data;
        if (args.all) {
          const closedCount = await closeAllSessions(logger);
          return {
            ok: true,
            closed: 'all',
            closedCount,
          };
        }

        const session = getActionSession(args.browser, config.defaultBrowser);
        if (!session) return noActiveSessionResponse();

        await closeSession(session.target.key, logger);
        return {
          ok: true,
          closed: session.target.requested,
          sessionKey: session.target.key,
        };
      },
    });
  },
};

export default browserControlPlugin;

function resolveConfig(raw: unknown): z.infer<typeof PluginConfigSchema> {
  const parsed = PluginConfigSchema.safeParse(raw || {});
  if (!parsed.success) return PluginConfigSchema.parse({});
  return parsed.data;
}

function parseToolArgs<T extends z.ZodTypeAny>(
  schema: T,
  rawArgs: unknown,
):
  | { success: true; data: z.infer<T> }
  | { success: false; response: { error: string; details: string[] } } {
  const parsed = schema.safeParse(rawArgs);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return {
    success: false,
    response: {
      error: 'Invalid tool arguments',
      details: parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `${path}: ${issue.message}`;
      }),
    },
  };
}

function normalizeUrl(input: string): string {
  const url = new URL(input.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported.');
  }
  return url.toString();
}

function resolveTarget(browser: SupportedBrowser): BrowserTarget {
  switch (browser) {
    case 'chrome':
      return { requested: browser, engine: 'chromium', channel: 'chrome', key: 'chromium:chrome' };
    case 'msedge':
      return { requested: browser, engine: 'chromium', channel: 'msedge', key: 'chromium:msedge' };
    case 'chromium':
      return { requested: browser, engine: 'chromium', key: 'chromium' };
    case 'firefox':
      return { requested: browser, engine: 'firefox', key: 'firefox' };
    case 'safari':
      return { requested: browser, engine: 'webkit', key: 'webkit:safari' };
    case 'webkit':
      return { requested: browser, engine: 'webkit', key: 'webkit' };
  }
}

function getActionSession(
  preferredBrowser: SupportedBrowser | undefined,
  defaultBrowser: SupportedBrowser,
): BrowserSession | null {
  if (preferredBrowser) {
    const preferred = sessions.get(resolveTarget(preferredBrowser).key);
    if (preferred && isSessionConnected(preferred)) return preferred;
    return null;
  }

  if (activeSessionKey) {
    const active = sessions.get(activeSessionKey);
    if (active && isSessionConnected(active)) return active;
  }

  const fallback = sessions.get(resolveTarget(defaultBrowser).key);
  if (fallback && isSessionConnected(fallback)) return fallback;
  return null;
}

function noActiveSessionResponse() {
  return {
    error: 'No active browser session',
    guidance:
      'Call browser_open first, then browser_click/browser_type/browser_eval/browser_extract.',
  };
}

async function ensureSession(
  target: BrowserTarget,
  config: z.infer<typeof PluginConfigSchema>,
): Promise<BrowserSession> {
  const existing = sessions.get(target.key);
  if (existing && isSessionConnected(existing)) {
    return existing;
  }
  if (existing) {
    await closeSession(target.key);
  }

  const playwright = await loadPlaywright();
  const browserType = playwright[target.engine];
  if (!browserType || typeof browserType.launch !== 'function') {
    throw new Error(`Playwright engine unavailable: ${target.engine}`);
  }

  const launchOptions: LaunchOptions = {
    headless: config.headless,
    timeout: config.launchTimeoutMs,
  };
  if (config.slowMoMs > 0) {
    launchOptions.slowMo = config.slowMoMs;
  }
  if (target.channel) {
    launchOptions.channel = target.channel;
  }

  const browser = await browserType.launch(launchOptions);
  const context = await browser.newContext({});
  context.setDefaultTimeout?.(config.actionTimeoutMs);
  context.setDefaultNavigationTimeout?.(config.navigationTimeoutMs);
  const page = await context.newPage();

  const session: BrowserSession = {
    target,
    browser,
    context,
    page,
    createdAt: new Date().toISOString(),
  };
  sessions.set(target.key, session);
  return session;
}

async function runStructuredPageScript(page: PageInstance, functionBody: string): Promise<unknown> {
  const encodedBody = Buffer.from(functionBody, 'utf8').toString('base64');
  const payload = await page.evaluate((encoded: string) => {
    try {
      const body = atob(encoded);
      const result = new Function(body)();
      return { ok: true, result: result === undefined ? null : result };
    } catch (error: unknown) {
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message)
          : String(error);
      return { ok: false, error: message };
    }
  }, encodedBody);

  if (!isStructuredPayload(payload)) {
    throw new Error('Malformed page execution payload');
  }
  if (!payload.ok) {
    throw new Error(payload.error !== undefined ? String(payload.error) : 'Page execution failed');
  }
  return payload.result ?? null;
}

async function readPageSnapshot(page: PageInstance): Promise<{
  title: string;
  url: string;
  readyState: string;
  textPreview: string;
}> {
  const snapshot = await page.evaluate(() => {
    const text = String(document.body?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 320);
    return {
      readyState: String(document.readyState || ''),
      textPreview: text,
    };
  }, undefined);

  const structured: any = isRecord(snapshot) ? snapshot : {};
  return {
    title: await page.title(),
    url: page.url(),
    readyState: String(structured.readyState || ''),
    textPreview: String(structured.textPreview || ''),
  };
}

async function settlePage(page: PageInstance, waitMs: number, timeoutMs: number): Promise<void> {
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  if (typeof page.waitForLoadState === 'function') {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
    } catch {
      // Ignore settle timeout after non-navigation actions.
    }
  }
}

async function closeSession(key: string, logger?: SkillLogger): Promise<void> {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  if (activeSessionKey === key) {
    activeSessionKey = null;
  }

  try {
    await session.context.close();
  } catch (err: unknown) {
    logger?.warn(`browser-control context close warning (${key}): ${errorMessage(err)}`);
  }
  try {
    await session.browser.close();
  } catch (err: unknown) {
    logger?.warn(`browser-control browser close warning (${key}): ${errorMessage(err)}`);
  }
}

async function closeAllSessions(logger?: SkillLogger): Promise<number> {
  const keys = Array.from(sessions.keys());
  for (const key of keys) {
    await closeSession(key, logger);
  }
  return keys.length;
}

function isSessionConnected(session: BrowserSession): boolean {
  if (typeof session.browser.isConnected === 'function') {
    return session.browser.isConnected();
  }
  return true;
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  if (!playwrightPromise) {
    playwrightPromise = import('playwright')
      .then((module: unknown) => normalizePlaywrightModule(module))
      .catch((err: unknown) => {
        playwrightPromise = null;
        throw err;
      });
  }
  return playwrightPromise;
}

function normalizePlaywrightModule(moduleValue: unknown): PlaywrightModule {
  const root = getImportRoot(moduleValue);
  const chromium = root.chromium;
  const firefox = root.firefox;
  const webkit = root.webkit;

  if (!isBrowserType(chromium) || !isBrowserType(firefox) || !isBrowserType(webkit)) {
    throw new Error('playwright module is present but has unexpected exports');
  }

  return { chromium, firefox, webkit };
}

function getImportRoot(value: unknown): Record<string, unknown> {
  if (isRecord(value) && isRecord(value.default)) {
    return value.default;
  }
  if (isRecord(value)) {
    return value;
  }
  return {};
}

function isBrowserType(value: unknown): value is BrowserType {
  return isRecord(value) && typeof value.launch === 'function';
}

function normalizeBrowserError(
  err: unknown,
  target: BrowserTarget,
  action: 'open' | 'click' | 'type' | 'eval' | 'extract' | 'scroll',
) {
  const message = errorMessage(err);
  if (looksLikeMissingPlaywright(message)) {
    return {
      error: 'Playwright dependency is missing',
      browser: target.requested,
      action,
      details: message,
      guidance:
        'Install dependency with `npm install playwright` then download engines with `npx playwright install chromium firefox webkit`.',
    };
  }

  if (looksLikeSandboxPermissionError(message)) {
    return {
      error: `Browser ${action} blocked by environment permissions`,
      browser: target.requested,
      engine: target.engine,
      action,
      details: message,
      guidance:
        'This runtime appears sandboxed from launching browser processes. Run gateway/agent outside the restricted sandbox or grant process-launch permissions.',
    };
  }

  return {
    error: `Browser ${action} failed`,
    browser: target.requested,
    engine: target.engine,
    action,
    details: message,
    guidance:
      'Ensure the selected browser engine is installed and, for headed mode on Linux, run with a display/Xvfb or switch headless=true.',
  };
}

function looksLikeMissingPlaywright(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("cannot find package 'playwright'") ||
    lower.includes("cannot find module 'playwright'") ||
    lower.includes('playwright dependency is missing')
  );
}

function looksLikeSandboxPermissionError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('bootstrap_check_in') ||
    lower.includes('machportrendezvous') ||
    lower.includes('permission denied (1100)') ||
    (lower.includes('target page, context or browser has been closed') &&
      lower.includes('kill eperm'))
  );
}

function buildExtractFunctionBody(
  mode: ExtractMode,
  selector: string | undefined,
  maxChars: number,
  maxItems: number,
): string {
  const options = JSON.stringify({
    mode,
    selector: selector || null,
    maxChars,
    maxItems,
  });

  return [
    `const options = ${options};`,
    'const scoped = options.selector ? document.querySelector(options.selector) : null;',
    'if (options.selector && !scoped) {',
    '  return { mode: options.mode, selector: options.selector, error: "Selector not found" };',
    '}',
    'const scope = scoped || document;',
    'if (options.mode === "text") {',
    '  const textSource = scoped || document.body || document.documentElement;',
    '  const rawText = String(textSource?.innerText || "").replace(/\\s+/g, " ").trim();',
    '  return {',
    '    mode: "text",',
    '    selector: options.selector,',
    '    content: rawText.slice(0, options.maxChars),',
    '    truncated: rawText.length > options.maxChars,',
    '    totalChars: rawText.length,',
    '  };',
    '}',
    'if (options.mode === "html") {',
    '  const html = scoped',
    '    ? String(scoped.outerHTML || "")',
    '    : String(document.documentElement?.outerHTML || "");',
    '  return {',
    '    mode: "html",',
    '    selector: options.selector,',
    '    content: html.slice(0, options.maxChars),',
    '    truncated: html.length > options.maxChars,',
    '    totalChars: html.length,',
    '  };',
    '}',
    'if (options.mode === "links") {',
    '  const links = Array.from(scope.querySelectorAll("a[href]"))',
    '    .slice(0, options.maxItems)',
    '    .map((el) => ({',
    '      text: String(el.textContent || "").trim().slice(0, 180),',
    '      href: String(el.href || ""),',
    '      title: String(el.title || "").trim().slice(0, 180),',
    '    }));',
    '  return {',
    '    mode: "links",',
    '    selector: options.selector,',
    '    count: links.length,',
    '    links,',
    '  };',
    '}',
    'if (options.mode === "forms") {',
    '  const fields = Array.from(scope.querySelectorAll("input, textarea, select, button"))',
    '    .slice(0, options.maxItems)',
    '    .map((el, index) => ({',
    '      index,',
    '      tag: String(el.tagName || "").toLowerCase(),',
    '      type: String(el.getAttribute("type") || "").toLowerCase(),',
    '      name: String(el.getAttribute("name") || ""),',
    '      id: String(el.id || ""),',
    '      placeholder: String(el.getAttribute("placeholder") || ""),',
    '      required: el.hasAttribute("required"),',
    '      disabled: el.hasAttribute("disabled"),',
    '      valuePreview: ("value" in el',
    '        ? String(el.value || "")',
    '        : String(el.textContent || "")).slice(0, 120),',
    '    }));',
    '  return {',
    '    mode: "forms",',
    '    selector: options.selector,',
    '    count: fields.length,',
    '    fields,',
    '  };',
    '}',
    'return { mode: options.mode, error: "Unsupported extract mode" };',
  ].join('\n');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  return { result: value };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStructuredPayload(value: unknown): value is StructuredPayload {
  return isRecord(value) && typeof value.ok === 'boolean';
}
