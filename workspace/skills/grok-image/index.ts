/**
 * @file workspace/skills/grok-image/index.ts
 * @description Image generation skill using xAI's Grok Imagine.
 */

import { z } from 'zod';

const GrokImageSchema = z.object({
  prompt: z.string().describe('Detailed description of the image to generate'),
  model: z.string().optional().describe('Override the default model'),
  aspect_ratio: z
    .enum([
      '1:1',
      '16:9',
      '9:16',
      '4:3',
      '3:4',
      '3:2',
      '2:3',
      '2:1',
      '1:2',
      '19.5:9',
      '9:19.5',
      '20:9',
      '9:20',
      'auto',
    ])
    .optional()
    .describe('Aspect ratio of the generated image'),
  resolution: z.enum(['1k', '2k']).optional().describe('Resolution of the output image'),
});

const grokImagePlugin = {
  id: 'grok-image',
  name: 'Grok Image',
  description: 'Generate images using xAI Grok Imagine.',

  async register(api: any) {
    const config = api.pluginConfig || {};

    // API client using native fetch
    const generate = async (params: any) => {
      const apiKey = (process.env.XAI_API_KEY || config.apiKey || '').trim();

      if (!apiKey) {
        api.logger.error('XAI_API_KEY is missing in both environment and config.');
        throw new Error(
          'xAI API Key (XAI_API_KEY) missing. Set it in skill secrets in the dashboard.',
        );
      }

      api.logger.info(
        `Requesting xAI image... (Key: ${apiKey.substring(0, 4)}***${apiKey.substring(apiKey.length - 4)})`,
      );

      const response = await fetch('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Adytum/0.4.0',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        let errorData: any = {};
        try {
          const text = await response.text();
          errorData = JSON.parse(text);
        } catch (e) {
          api.logger.error('xAI returned non-JSON error response.');
        }

        const status = response.status;
        const msg = errorData.error?.message || `xAI API error ${status}`;

        if (status === 403) {
          api.logger.error(
            `403 Forbidden: This usually means your xAI account lacks image generation permissions or has an insufficient balance. Full error: ${JSON.stringify(errorData)}`,
          );
        } else if (status === 401) {
          api.logger.error('401 Unauthorized: Your API key appears to be invalid.');
        } else {
          api.logger.error(`xAI Error (${status}): ${JSON.stringify(errorData)}`);
        }

        throw new Error(msg);
      }

      return await response.json();
    };

    api.registerTool({
      name: 'grok_test_connection',
      description: 'Test the xAI API connection and verify the API key is valid.',
      parameters: z.object({}),
      execute: async () => {
        const apiKey = (process.env.XAI_API_KEY || config.apiKey || '').trim();
        if (!apiKey) return { status: 'error', message: 'No API key provided.' };

        try {
          const res = await fetch('https://api.x.ai/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return {
              status: 'error',
              code: res.status,
              message: err.error?.message || 'Unauthorized',
            };
          }
          const data = await res.json();
          return { status: 'success', message: 'Connection valid', models: data.data?.length };
        } catch (err: any) {
          return { status: 'error', message: err.message };
        }
      },
    });

    api.registerTool({
      name: 'grok_generate_image',
      description: 'Generate an image from a text prompt using Grok Imagine.',
      parameters: GrokImageSchema,
      execute: async (args: z.infer<typeof GrokImageSchema>) => {
        api.logger.info(`Generating Grok image for prompt: "${args.prompt}"`);

        try {
          const result = await generate({
            model: args.model || config.model || 'grok-imagine-image',
            prompt: args.prompt,
            aspect_ratio: args.aspect_ratio || config.aspect_ratio || '1:1',
            resolution: args.resolution || config.resolution || '1k',
          });

          const imageUrl = result.data?.[0]?.url;
          if (!imageUrl) {
            throw new Error('No image URL returned from xAI');
          }

          api.logger.info(`Successfully generated Grok image: ${imageUrl}`);

          return {
            url: imageUrl,
            revised_prompt: result.data?.[0]?.revised_prompt,
            status: 'success',
          };
        } catch (err: any) {
          api.logger.error(`Error generating Grok image: ${err.message}`);
          throw new Error(`Grok Image Generation failed: ${err.message}`);
        }
      },
    });
  },
};

export default grokImagePlugin;
