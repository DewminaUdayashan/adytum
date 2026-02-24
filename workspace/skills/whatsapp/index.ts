/**
 * @file workspace/skills/whatsapp/index.ts
 * @description WhatsApp integration wrapping wacli CLI.
 */

import { execSync } from 'node:child_process';
import { z } from 'zod';

const WhatsAppPluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  wacliPath: z.string().default('wacli'),
  storeDir: z.string().optional(),
});

type WhatsAppPluginConfig = z.infer<typeof WhatsAppPluginConfigSchema>;

class WhatsAppService {
  private config: WhatsAppPluginConfig;
  private logger: any;

  constructor(rawConfig: unknown, logger: any) {
    this.config = WhatsAppPluginConfigSchema.parse(rawConfig || {});
    this.logger = logger;
  }

  private runWacli(args: string[]): string {
    const cmdArgs = [this.config.wacliPath, ...args, '--json'];
    if (this.config.storeDir) {
      cmdArgs.push('--store', this.config.storeDir);
    }

    try {
      const output = execSync(cmdArgs.join(' ')).toString();
      return output;
    } catch (err: any) {
      this.logger.error(`wacli error: ${err.stderr?.toString() || err.message}`);
      throw err;
    }
  }

  async sendMessage(to: string, message: string) {
    const output = this.runWacli(['send', 'text', '--to', `"${to}"`, '--message', `"${message}"`]);
    return JSON.parse(output);
  }

  async listChats(limit: number = 20, query?: string) {
    const args = ['chats', 'list', '--limit', String(limit)];
    if (query) {
      args.push('--query', `"${query}"`);
    }
    const output = this.runWacli(args);
    return JSON.parse(output);
  }

  async searchMessages(query: string, limit: number = 20, chatId?: string) {
    const args = ['messages', 'search', `"${query}"`, '--limit', String(limit)];
    if (chatId) {
      args.push('--chat', chatId);
    }
    const output = this.runWacli(args);
    return JSON.parse(output);
  }
}

export default {
  id: 'whatsapp',
  name: 'WhatsApp',
  register(api: any) {
    const service = new WhatsAppService(api.pluginConfig, api.logger);

    api.registerTool({
      name: 'whatsapp_send_message',
      description: 'Send a WhatsApp message via wacli',
      parameters: z.object({
        to: z.string().describe('Target JID or phone number (e.g. +123456789 or 12345-6789@g.us)'),
        message: z.string().describe('The message text'),
      }),
      execute: async (params: any) => {
        return await service.sendMessage(params.to, params.message);
      },
    });

    api.registerTool({
      name: 'whatsapp_list_chats',
      description: 'List recent WhatsApp chats',
      parameters: z.object({
        limit: z.number().optional().default(20),
        query: z.string().optional().describe('Filter chats by name or ID'),
      }),
      execute: async (params: any) => {
        return await service.listChats(params.limit, params.query);
      },
    });

    api.registerTool({
      name: 'whatsapp_search_messages',
      description: 'Search WhatsApp message history',
      parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().optional().default(20),
        chatId: z.string().optional().describe('Limit search to a specific chat'),
      }),
      execute: async (params: any) => {
        return await service.searchMessages(params.query, params.limit, params.chatId);
      },
    });
  },
};
