/**
 * @file workspace/skills/facebook-page/index.ts
 * @description Facebook Page management skill for Adytum using Graph API.
 */

import { z } from 'zod';

const FACEBOOK_API_VERSION = 'v21.0';
const FACEBOOK_BASE_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`;

const FacebookPluginConfigSchema = z.object({
  enabled: z.boolean().default(true),
  pageId: z.string(),
  pageAccessToken: z.string(),
});

type FacebookPluginConfig = z.infer<typeof FacebookPluginConfigSchema>;

class FacebookPageService {
  private config: FacebookPluginConfig;
  private logger: any;

  constructor(rawConfig: unknown, logger: any) {
    this.config = resolveConfig(rawConfig);
    this.logger = logger;
  }

  get id(): string {
    return 'facebook-page';
  }

  async start() {
    this.logger.info('Facebook Page service started.');
  }

  async stop() {
    this.logger.info('Facebook Page service stopped.');
  }

  private async request(path: string, options: RequestInit = {}) {
    if (!path || path.includes('undefined')) {
      throw new Error(
        `Invalid Facebook API path: "${path}". Ensure all post/comment IDs are valid.`,
      );
    }

    const url = new URL(`${FACEBOOK_BASE_URL}/${path}`);
    url.searchParams.append('access_token', this.config.pageAccessToken);

    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };

    // Default to JSON if body is a plain object and no Content-Type is set
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
      ...options,
      headers,
    });

    const data = await response.json();
    if (!response.ok) {
      const errorMsg = data.error?.message || response.statusText;
      const errorCode = data.error?.code;

      this.logger.error(`Facebook API error: ${JSON.stringify(data)}`);

      if (errorCode === 200 && errorMsg.includes('publish_actions')) {
        throw new Error(
          `Facebook Permission Error: The token used lacks permission to post. This usually happens when using a **User Access Token** instead of a **Page Access Token**. Please verify your configuration in SKILL.md.`,
        );
      }

      throw new Error(`Facebook API error: ${errorMsg} (Code: ${errorCode})`);
    }
    return data;
  }

  async postMessage(text: string) {
    return this.request(`${this.config.pageId}/feed`, {
      method: 'POST',
      body: JSON.stringify({ message: text }),
    });
  }

  async postPhoto(imageUrl: string, caption?: string) {
    const params = new URLSearchParams();
    params.append('url', imageUrl);
    if (caption) params.append('caption', caption);

    return this.request(`${this.config.pageId}/photos`, {
      method: 'POST',
      body: params.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  async listPosts(limit = 10) {
    const data = await this.request(`${this.config.pageId}/published_posts`, {
      method: 'GET',
    });
    return data.data?.slice(0, limit) || [];
  }

  async listComments(postId: string) {
    const data = await this.request(`${postId}/comments`, {
      method: 'GET',
    });
    return data.data || [];
  }

  async postComment(postId: string, message: string) {
    return this.request(`${postId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }
}

function resolveConfig(rawConfig: unknown): FacebookPluginConfig {
  return FacebookPluginConfigSchema.parse(rawConfig || {});
}

const facebookPagePlugin = {
  id: 'facebook-page',
  name: 'Facebook Page',
  description: 'Manage Facebook Pages: post content, list posts, and handle comments.',

  register(api: any) {
    const service = new FacebookPageService(api.pluginConfig, api.logger);

    api.registerService(service);

    api.registerTool({
      name: 'facebook_post',
      description: 'Post a text update to the Facebook Page feed.',
      parameters: z.object({
        text: z.string().min(1).describe('The content of the post.'),
      }),
      execute: async ({ text }: { text: string }) => {
        const result = await service.postMessage(text);
        return `Successfully posted to Facebook Page. Post ID: ${result.id || result.post_id}`;
      },
    });

    api.registerTool({
      name: 'facebook_post_photo',
      description: 'Upload and post a photo with a caption to the Facebook Page.',
      parameters: z.object({
        imageUrl: z.string().url().describe('The public URL of the image to post.'),
        caption: z.string().optional().describe('An optional caption for the photo.'),
      }),
      execute: async ({ imageUrl, caption }: { imageUrl: string; caption?: string }) => {
        const result = await service.postPhoto(imageUrl, caption);
        return `Successfully posted photo to Facebook Page. ID: ${result.id}`;
      },
    });

    api.registerTool({
      name: 'facebook_list_posts',
      description: 'List recent published posts from the Facebook Page.',
      parameters: z.object({
        limit: z.number().optional().default(10).describe('Number of posts to retrieve.'),
      }),
      execute: async ({ limit }: { limit: number }) => {
        const posts = await service.listPosts(limit);
        return posts.length > 0
          ? posts.map((p: any) => `[${p.id}] ${p.message || p.story || '(No text)'}`).join('\n')
          : 'No posts found.';
      },
    });

    api.registerTool({
      name: 'facebook_list_comments',
      description: 'Get comments for a specific Facebook post.',
      parameters: z.object({
        postId: z.string().describe('The ID of the post to get comments from.'),
      }),
      execute: async ({ postId }: { postId: string }) => {
        const comments = await service.listComments(postId);
        return comments.length > 0
          ? comments
              .map((c: any) => `[Comment ID: ${c.id}] ${c.from?.name || 'User'}: ${c.message}`)
              .join('\n\n')
          : 'No comments found for this post.';
      },
    });

    api.registerTool({
      name: 'facebook_post_comment',
      description: 'Add a comment or reply to a Facebook post.',
      parameters: z.object({
        postId: z.string().describe('The ID of the post or parent comment to reply to.'),
        message: z.string().min(1).describe('The content of the comment.'),
      }),
      execute: async ({ postId, message }: { postId: string; message: string }) => {
        const result = await service.postComment(postId, message);
        return `Successfully added comment. Comment ID: ${result.id}`;
      },
    });
  },
};

export default facebookPagePlugin;
