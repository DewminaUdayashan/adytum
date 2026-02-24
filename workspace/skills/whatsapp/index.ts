/**
 * @file workspace/skills/whatsapp/index.ts
 * @description Native WhatsApp skill for Adytum using @whiskeysockets/baileys.
 */

import type { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket
} from '@whiskeysockets/baileys';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import qrcode from 'qrcode';
import { z } from 'zod';

const WHATSAPP_ACTIONS = [
  'send_message',
  'send_image',
  'send_document',
  'presence',
  'list_chats',
  'get_messages',
  'search_contacts',
  'mark_read',
] as const;
type WhatsAppAction = (typeof WHATSAPP_ACTIONS)[number];

type WhatsAppLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

const WhatsAppActionPermissionsSchema = z.object({
  send_message: z.boolean().default(true),
  send_image: z.boolean().default(true),
  send_document: z.boolean().default(true),
  presence: z.boolean().default(true),
  list_chats: z.boolean().default(true),
  get_messages: z.boolean().default(true),
  search_contacts: z.boolean().default(true),
  mark_read: z.boolean().default(true),
});

const WhatsAppPluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sessionName: z.string().default('adytum-whatsapp'),
  sessionPath: z
    .string()
    .optional()
    .describe('Absolute path to store session data. Defaults to ~/.adytum/data/sessions/whatsapp'),
  listenIncoming: z.boolean().default(true),
  respondToGroups: z.boolean().default(false),
  allowedRemoteJids: z.array(z.string()).default([]),
  actionPermissions: WhatsAppActionPermissionsSchema.default({}),
});

type WhatsAppPluginConfig = z.infer<typeof WhatsAppPluginConfigSchema>;

const WhatsAppSendSchema = z.object({
  text: z.string().min(1).describe('Message text to send'),
  recipientId: z
    .string()
    .describe('Target JID (e.g. "1234567890@s.whatsapp.net" or "group-id@g.us")'),
});

const WhatsAppActionSchema = z.object({
  action: z.enum(WHATSAPP_ACTIONS),
  recipientId: z.string().optional(),
  text: z.string().optional(),
  imageUrl: z.string().optional(),
  documentUrl: z.string().optional(),
  fileName: z.string().optional(),
  presence: z.enum(['unavailable', 'available', 'composing', 'recording', 'paused']).optional(),
  limit: z.number().optional().describe('Limit for list or history actions'),
  cursor: z.string().optional().describe('Pagination cursor'),
  query: z.string().optional().describe('Search query'),
});

/**
 * Minimal In-Memory Store for WhatsApp
 */
class AdytumWhatsAppStore {
  public chats: { all: () => any[] } = {
    all: () => Array.from(this.chatsMap.values()),
  };
  public contacts: { [jid: string]: any } = {};
  public messages: { [jid: string]: any[] } = {};

  private chatsMap = new Map<string, any>();

  constructor(private logger: WhatsAppLogger) {}

  bind(ev: any) {
    ev.on('messaging-history.set', ({ chats, contacts, messages }: any) => {
      for (const chat of chats) this.chatsMap.set(chat.id, chat);
      for (const contact of contacts) this.contacts[contact.id] = contact;
      for (const message of messages) {
        const jid = message.key.remoteJid;
        if (!this.messages[jid]) this.messages[jid] = [];
        this.messages[jid].push(message);
      }
    });

    ev.on('chats.upsert', (chats: any) => {
      for (const chat of chats) this.chatsMap.set(chat.id, chat);
    });

    ev.on('chats.update', (updates: any) => {
      for (const update of updates) {
        const chat = this.chatsMap.get(update.id);
        if (chat) Object.assign(chat, update);
      }
    });

    ev.on('messages.upsert', ({ messages }: any) => {
      for (const message of messages) {
        const jid = message.key.remoteJid;
        if (!jid) continue;
        if (!this.messages[jid]) this.messages[jid] = [];
        this.messages[jid].push(message);
        if (this.messages[jid].length > 20) this.messages[jid].shift();
      }
    });

    ev.on('contacts.upsert', (contacts: any) => {
      for (const contact of contacts) this.contacts[contact.id] = contact;
    });

    ev.on('contacts.update', (updates: any) => {
      for (const update of updates) {
        if (update.id && this.contacts[update.id]) {
          Object.assign(this.contacts[update.id], update);
        }
      }
    });
  }

  async loadMessages(jid: string, limit: number, _cursor: any) {
    const msgs = this.messages[jid] || [];
    return msgs.slice(-limit);
  }

  writeToFile(path: string) {
    try {
      // Aggressive pruning before write to keep memory/file size low
      // Limit to last 500 contacts
      const contactKeys = Object.keys(this.contacts);
      if (contactKeys.length > 500) {
        const toRemove = contactKeys.slice(0, contactKeys.length - 500);
        for (const k of toRemove) delete this.contacts[k];
      }

      // Limit to last 50 chats in messages map
      const messageKeys = Object.keys(this.messages);
      if (messageKeys.length > 50) {
        const toRemove = messageKeys.slice(0, messageKeys.length - 50);
        for (const k of toRemove) delete this.messages[k];
      }

      const data = {
        chats: Array.from(this.chatsMap.values()).slice(-100), // Only keep last 100 chats
        contacts: this.contacts,
        messages: this.messages,
      };
      writeFileSync(path, JSON.stringify(data));
    } catch (err) {
      this.logger.error('Failed to write store: ' + err);
    }
  }

  readFromFile(path: string) {
    try {
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, 'utf8'));
        if (data.chats) {
          const chats = Array.isArray(data.chats) ? data.chats : [];
          for (const c of chats.slice(-100)) this.chatsMap.set(c.id, c);
        }
        if (data.contacts) {
          const keys = Object.keys(data.contacts);
          const limit = 500;
          for (const k of keys.slice(-limit)) {
            this.contacts[k] = data.contacts[k];
          }
        }
        if (data.messages) {
          const keys = Object.keys(data.messages);
          const limit = 50;
          for (const k of keys.slice(-limit)) {
            const msgs = Array.isArray(data.messages[k]) ? data.messages[k] : [];
            this.messages[k] = msgs.slice(-20); // Keep only 20 msgs per chat on load
          }
        }
      }
    } catch (err) {
      this.logger.error('Failed to read store: ' + err);
    }
  }
}

class WhatsAppService {
  private sock: WASocket | null = null;
  private agent: any = null;
  private config: WhatsAppPluginConfig;
  private isConnecting = false;
  private latestQR: string | null = null;
  private connectionStatus: 'disconnected' | 'connecting' | 'pairing' | 'connected' = 'disconnected';
  private store: AdytumWhatsAppStore | null = null;

  private storeInterval: NodeJS.Timeout | null = null;

  constructor(
    rawConfig: unknown,
    private logger: WhatsAppLogger,
  ) {
    this.config = resolveConfig(rawConfig);
    this.store = new AdytumWhatsAppStore(this.logger);
  }

  public getStatus() {
    return {
      status: this.connectionStatus,
      qr: this.latestQR,
    };
  }

  get id(): string {
    return 'whatsapp-service';
  }

  isReady(): boolean {
    return this.sock !== null && (this.sock?.ws as any)?.readyState === 1; // 1 = OPEN
  }

  isActionEnabled(action: WhatsAppAction): boolean {
    return this.config.actionPermissions[action] !== false;
  }

  assertActionEnabled(action: WhatsAppAction): void {
    if (this.isActionEnabled(action)) return;
    throw new Error(`WhatsApp action "${action}" is disabled in config.`);
  }

  private getSessionPath(): string {
    if (this.config.sessionPath) return this.config.sessionPath;
    const home = process.env.HOME || process.env.USERPROFILE || '.';
    const sessionDir = join(home, '.adytum', 'data', 'sessions', 'whatsapp', this.config.sessionName);
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }
    return sessionDir;
  }

  async start(ctx: { agent: any }): Promise<void> {
    this.agent = ctx.agent;

    if (!this.config.enabled) {
      this.logger.info('disabled by plugin config');
      return;
    }

    if (this.isConnecting || (this.sock && this.isReady())) {
      this.logger.info('Already connecting or connected.');
      return;
    }

    // Load store once at start
    const sessionDir = this.getSessionPath();
    const storeFile = join(sessionDir, 'baileys_store_multi.json');
    try {
      this.store!.readFromFile(storeFile);
    } catch (err) {
      this.logger.warn('Initial store read failed (might be first run): ' + err);
    }

    // Start save interval if not already running
    if (!this.storeInterval) {
      this.storeInterval = setInterval(() => {
        try {
          if (this.store) this.store.writeToFile(storeFile);
        } catch (err) {
          // ignore
        }
      }, 30000); // 30s is enough
    }

    await this.connect();
  }

  private async connect() {
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore
      }
      this.sock = null;
    }

    this.isConnecting = true;
    this.connectionStatus = 'connecting';
    const sessionDir = this.getSessionPath();

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    this.logger.info(`Starting WhatsApp connection (Baileys v${version.join('.')})...`);

    const storeFile = join(sessionDir, 'baileys_store_multi.json');
    this.store = new AdytumWhatsAppStore(this.logger);
    try {
      this.store.readFromFile(storeFile);
    } catch (err) {
      this.logger.error('Failed to read WhatsApp store from file: ' + err);
    }

    // Save store every 60 seconds to reduce I/O and memory pressure
    const storeInterval = setInterval(() => {
      try {
        if (this.store) this.store.writeToFile(storeFile);
      } catch (err) {
        // quiet error during exit
      }
    }, 60000);

    const baileysLogger = pino({ level: 'warn' });

    this.sock = makeWASocket({
      version,
      logger: baileysLogger,
      auth: {
        creds: state.creds,
        keys: state.keys,
      },
      printQRInTerminal: true, // Restore terminal QR for backup
    });

    this.store!.bind(this.sock.ev);

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.connectionStatus = 'pairing';
        // Generate data URL for dashboard but don't print to terminal
        try {
          this.latestQR = await qrcode.toDataURL(qr);
        } catch (err) {
          this.logger.error('Failed to generate QR data URL: ' + err);
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        this.logger.warn(
          `WhatsApp connection closed. Status: ${statusCode}. Error: ${lastDisconnect?.error}. Reconnecting: ${shouldReconnect}`,
        );
        
        this.sock = null;
        this.isConnecting = false;
        this.connectionStatus = 'disconnected';

        // Attempt to reconnect if not logged out
        if (shouldReconnect) {
          this.logger.info('Attempting to reconnect in 5s...');
          setTimeout(() => this.connect(), 5000);
        } else {
          this.logger.error('WhatsApp logged out or permanent failure. Clearing session for re-pairing...');
          this.latestQR = null;
          
          // Clear credentials on logout to force a new QR next time
          try {
            const sessionDir = this.getSessionPath();
            const credsFile = join(sessionDir, 'creds.json');
            if (existsSync(credsFile)) {
              require('node:fs').unlinkSync(credsFile);
            }
          } catch (err) {
            this.logger.error('Failed to clear credentials: ' + err);
          }

          this.logger.info('Please trigger a reconnection via the dashboard or wait for next start.');
        }
      } else if (connection === 'open') {
        this.logger.info('WhatsApp connection opened successfully!');
        this.isConnecting = false;
        this.connectionStatus = 'connected';
        this.latestQR = null; // ONLY clear when connected
      }
    });

    this.sock.ev.on('messages.upsert', async (m) => {
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          if (!msg.key.fromMe) {
            await this.handleIncomingMessage(msg);
          }
        }
      }
    });
  }

  async stop(): Promise<void> {
    if (this.storeInterval) {
      clearInterval(this.storeInterval);
      this.storeInterval = null;
    }
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    if (this.store) {
      const sessionDir = this.getSessionPath();
      const storeFile = join(sessionDir, 'baileys_store_multi.json');
      this.store.writeToFile(storeFile);
    }
    this.agent = null;
    this.isConnecting = false;
  }

  private async handleIncomingMessage(msg: any) {
    if (!this.agent || !this.config.listenIncoming) return;

    const jid = msg.key.remoteJid;
    if (!jid) return;

    const isGroup = jid.endsWith('@g.us');
    if (isGroup && !this.config.respondToGroups) return;

    if (this.config.allowedRemoteJids.length > 0 && !this.config.allowedRemoteJids.includes(jid)) {
      return;
    }

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption;

    if (!text) return;

    const senderName = msg.pushName || 'Unknown';
    const contextHeader = [
      '[WhatsApp Context]',
      `From: ${senderName} (${jid})`,
      isGroup ? `Group: true` : `Direct: true`,
      `MessageID: ${msg.key.id}`,
    ].join(' | ');

    const prompt = `${contextHeader}\n\n${text}`;
    const sessionId = `whatsapp:${jid}`;

    const result = await this.agent.run(prompt, sessionId);
    if (result.response?.trim()) {
      await this.sendMessage({
        recipientId: jid,
        text: result.response,
      });
    }
  }

  async sendMessage(params: { recipientId: string; text: string }) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    this.assertActionEnabled('send_message');

    await this.sock.sendMessage(params.recipientId, { text: params.text });
    return { status: 'sent', recipient: params.recipientId };
  }

  async sendImage(params: { recipientId: string; imageUrl: string; caption?: string }) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    this.assertActionEnabled('send_image');

    await this.sock.sendMessage(params.recipientId, {
      image: { url: params.imageUrl },
      caption: params.caption,
    });
    return { status: 'sent', recipient: params.recipientId };
  }

  async sendDocument(params: {
    recipientId: string;
    documentUrl: string;
    fileName?: string;
    caption?: string;
  }) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    this.assertActionEnabled('send_document');

    await this.sock.sendMessage(params.recipientId, {
      document: { url: params.documentUrl },
      fileName: params.fileName,
      caption: params.caption,
      mimetype: 'application/octet-stream', // Generic fallback
    });
    return { status: 'sent', recipient: params.recipientId };
  }

  async updatePresence(jid: string, presence: any) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    this.assertActionEnabled('presence');
    await this.sock.sendPresenceUpdate(presence, jid);
    return { status: 'updated' };
  }

  async listChats(limit = 10) {
    if (!this.store) throw new Error('Store not initialized');
    this.assertActionEnabled('list_chats');

    const chats = this.store.chats.all().slice(0, limit);
    return chats.map((c: any) => ({
      id: c.id,
      name: c.name || 'Unknown',
      unreadCount: c.unreadCount,
      lastMessage: c.conversationTimestamp,
    }));
  }

  async getMessages(jid: string, limit = 20) {
    if (!this.store) throw new Error('Store not initialized');
    this.assertActionEnabled('get_messages');

    const messages = await this.store.loadMessages(jid, limit, undefined);
    return messages.map((m: any) => {
      const text =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        '';
      return {
        id: m.key.id,
        fromMe: m.key.fromMe,
        pushName: m.pushName,
        text,
        timestamp: m.messageTimestamp,
      };
    });
  }

  async searchContacts(query: string) {
    if (!this.store) throw new Error('Store not initialized');
    this.assertActionEnabled('search_contacts');

    const needle = query.toLowerCase();
    const contacts = Object.values(this.store.contacts).filter(
      (c: any) =>
        c.name?.toLowerCase().includes(needle) ||
        c.notify?.toLowerCase().includes(needle) ||
        c.id.toLowerCase().includes(needle),
    );

    return contacts.slice(0, 10).map((c: any) => ({
      id: c.id,
      name: c.name || c.notify || 'Unknown',
    }));
  }

  async markRead(jid: string) {
    if (!this.sock) throw new Error('WhatsApp not connected');
    this.assertActionEnabled('mark_read');

    // This is a bit tricky in pure Baileys if we don't have the full message key
    // but usually we want to mark the whole chat as read
    await this.sock.readMessages([
      {
        remoteJid: jid,
        id: undefined as any, // Baileys might need last message id
        fromMe: false,
      },
    ]);
    return { status: 'marked_read', jid };
  }
}

function resolveConfig(rawConfig: unknown): WhatsAppPluginConfig {
  return WhatsAppPluginConfigSchema.parse(rawConfig || {});
}

const whatsappPlugin = {
  id: 'whatsapp',
  name: 'WhatsApp',
  description: 'Native WhatsApp skill using Baileys. Requires scanning QR code in terminal.',

  register(api: any) {
    const service = new WhatsAppService(api.pluginConfig, api.logger);

    api.registerService(service);

    api.registerTool({
      name: 'whatsapp_send',
      description: 'Send a text message to a WhatsApp JID.',
      parameters: WhatsAppSendSchema,
      execute: async (args: z.infer<typeof WhatsAppSendSchema>) => {
        return await service.sendMessage(args);
      },
    });

    api.registerTool({
      name: 'whatsapp_action',
      description: 'Perform advanced WhatsApp actions: send images, documents, or update presence.',
      parameters: WhatsAppActionSchema,
      execute: async (args: z.infer<typeof WhatsAppActionSchema>) => {
        service.assertActionEnabled(args.action);

        switch (args.action) {
          case 'send_message':
            if (!args.recipientId || !args.text) throw new Error('recipientId and text required');
            return await service.sendMessage({ recipientId: args.recipientId, text: args.text });

          case 'send_image':
            if (!args.recipientId || !args.imageUrl)
              throw new Error('recipientId and imageUrl required');
            return await service.sendImage({
              recipientId: args.recipientId,
              imageUrl: args.imageUrl,
              caption: args.text,
            });

          case 'send_document':
            if (!args.recipientId || !args.documentUrl)
              throw new Error('recipientId and documentUrl required');
            return await service.sendDocument({
              recipientId: args.recipientId,
              documentUrl: args.documentUrl,
              fileName: args.fileName,
              caption: args.text,
            });

          case 'presence':
            if (!args.recipientId || !args.presence)
              throw new Error('recipientId and presence required');
            return await service.updatePresence(args.recipientId, args.presence);

          case 'list_chats':
            return await service.listChats(args.limit);

          case 'get_messages':
            if (!args.recipientId) throw new Error('recipientId required');
            return await service.getMessages(args.recipientId, args.limit);

          case 'search_contacts':
            if (!args.query) throw new Error('query required');
            return await service.searchContacts(args.query);

          case 'mark_read':
            if (!args.recipientId) throw new Error('recipientId required');
            return await service.markRead(args.recipientId);

          default:
            throw new Error(`Unsupported action: ${args.action}`);
        }
      },
    });

    api.registerTool({
      name: 'whatsapp_list_chats',
      description: 'List recent WhatsApp conversations and unread counts.',
      parameters: z.object({
        limit: z.number().optional().default(10).describe('Number of chats to list'),
      }),
      execute: async (args: { limit: number }) => {
        return await service.listChats(args.limit);
      },
    });

    api.registerTool({
      name: 'whatsapp_get_messages',
      description: 'Fetch message history for a specific WhatsApp contact (JID).',
      parameters: z.object({
        recipientId: z.string().describe('Target JID'),
        limit: z.number().optional().default(20).describe('Number of messages to fetch'),
      }),
      execute: async (args: { recipientId: string; limit: number }) => {
        return await service.getMessages(args.recipientId, args.limit);
      },
    });

    api.registerTool({
      name: 'whatsapp_search_contacts',
      description: 'Search for WhatsApp contacts or groups by name or JID.',
      parameters: z.object({
        query: z.string().describe('Search term'),
      }),
      execute: async (args: { query: string }) => {
        return await service.searchContacts(args.query);
      },
    });

    api.registerTool({
      name: 'whatsapp_mark_read',
      description: 'Mark all messages in a chat as read.',
      parameters: z.object({
        recipientId: z.string().describe('Target JID'),
      }),
      execute: async (args: { recipientId: string }) => {
        return await service.markRead(args.recipientId);
      },
    });

    api.registerTool({
      name: 'whatsapp_connect',
      description: 'Trigger a WhatsApp connection or re-pairing attempt.',
      parameters: z.object({}),
      execute: async () => {
        if (service.isReady()) return 'Already connected.';
        await service.start({ agent: null });
        return 'Connection attempt started. Check terminal or dashboard for QR code.';
      },
    });
  },
};

export default whatsappPlugin;
