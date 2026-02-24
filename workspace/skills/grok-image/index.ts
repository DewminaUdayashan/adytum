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
      const apiKey = process.env.XAI_API_KEY || api.secrets?.XAI_API_KEY;
      if (!apiKey) {
        throw new Error(
          'xAI API Key (XAI_API_KEY) missing. Set it in skill secrets or environment.',
        );
      }

      const response = await fetch('https://api.x.ai/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      if (!response.ok) {
        const errorInfo = await response.json().catch(() => ({}));
        throw new Error(
          errorInfo.error?.message || `xAI API responded with status ${response.status}`,
        );
      }

      return await response.json();
    };

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
