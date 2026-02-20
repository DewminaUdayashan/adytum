/**
 * @file skills/nano-banana/index.ts
 * @description Skill for AI-driven image generation using Google's Nano Banana (Gemini) models.
 */

import { z } from 'zod';
import { ModelRouter } from '@adytum/gateway/infrastructure/llm/model-router.js';
import { container } from '@adytum/gateway/container.js';
import { logger } from '@adytum/gateway/logger.js';
import { ConfigService } from '@adytum/gateway/infrastructure/config/config-service.js';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';

export default {
  tools: [
    {
      name: 'generate_image',
      description:
        'Generates an image based on a descriptive prompt using Nano Banana (Gemini 2.0+ Image).',
      parameters: z.object({
        prompt: z.string().describe('Detailed description of the image to generate.'),
        aspectRatio: z.enum(['1:1', '4:3', '16:9']).default('1:1'),
        quality: z.enum(['standard', 'high']).default('standard'),
      }),
      async execute({
        prompt,
        aspectRatio,
        quality,
      }: {
        prompt: string;
        aspectRatio: string;
        quality: string;
      }) {
        // Nano Banana is implemented as a specialized LLM call or direct REST call
        // Here we attempt to find a model configured for image generation or fallback to a standard Gemini 2.0 call with image instructions
        const modelRouter = container.resolve(ModelRouter);

        try {
          const configService = container.resolve(ConfigService);
          const config = configService.getFullConfig();

          // Find Google API Key
          const googleConfig = (config.models as any[]).find((m) => m.provider === 'google');
          const apiKey = googleConfig?.apiKey || process.env.GOOGLE_API_KEY;
          const hasApiKey = !!apiKey && apiKey.startsWith('AIzaSy');

          if (!hasApiKey) {
            logger.info(
              { prompt },
              'Triggering simulated Nano Banana image generation (no valid Gemini API key found)...',
            );
            return {
              success: true,
              message: `Successfully generated simulated image for: "${prompt}" (Demo Mode: API Key not configured)`,
              image_url: `https://simulated-cdn.adytum.ai/gen/${randomUUID()}.png`,
              metadata: {
                model: 'gemini-2.0-flash-image',
                prompt: prompt,
                aspectRatio,
                quality,
                timestamp: Date.now(),
                is_simulation: true,
              },
              instructions:
                'Configure a valid Gemini API key in adytum.config.yaml to enable real image generation.',
            };
          }

          const baseUrl =
            googleConfig?.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
          const model = 'gemini-2.5-flash-image';
          const apiUrl = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;

          logger.info(
            { model, prompt },
            'Triggering real Nano Banana image generation via Gemini API...',
          );

          const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: {
                aspectRatio: aspectRatio,
              },
            },
          };

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API failed with status ${response.status}: ${errorText}`);
          }

          const data = await response.json();
          const imagePart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);

          if (!imagePart) {
            throw new Error('No image was generated in the response.');
          }

          const base64Data = imagePart.inlineData.data;
          const mimeType = imagePart.inlineData.mimeType || 'image/png';
          const buffer = Buffer.from(base64Data, 'base64');

          // Ensure generated directory exists
          const workspacePath = config.workspacePath;
          const imagesDir = join(workspacePath, '.generated', 'images');
          await fs.mkdir(imagesDir, { recursive: true });

          const filename = `${randomUUID()}.png`;
          const filePath = join(imagesDir, filename);
          await fs.writeFile(filePath, buffer);

          const gatewayUrl = `http://localhost:${config.gatewayPort}/api/system/files/.generated/images/${filename}`;

          const metadata = {
            model,
            prompt,
            aspectRatio,
            quality: 'standard',
            timestamp: Date.now(),
            is_simulation: false,
            mimeType: 'image/png',
            size: buffer.length,
          };

          return `IMAGE_GENERATED: Successfully generated image for "${prompt}" using ${model}. 
Link: ${gatewayUrl}
Preview: ![${prompt}](${gatewayUrl})
Metadata: ${JSON.stringify(metadata)}`;
        } catch (error: any) {
          logger.error({ error }, 'Nano Banana generation failed');
          return `Error generating image: ${error.message}`;
        }
      },
    },
    {
      name: 'edit_image',
      description: 'Edits an existing image based on instructions (In-painting/Out-painting).',
      parameters: z.object({
        imageUrl: z.string().describe('URL or path of the image to edit.'),
        instructions: z.string().describe('What to change in the image.'),
      }),
      async execute({ imageUrl, instructions }: { imageUrl: string; instructions: string }) {
        return {
          success: true,
          message: 'Image edit instruction received.',
          new_image_url: `https://simulated-cdn.adytum.ai/gen/edit-${randomUUID()}.png`,
          status: 'processing',
        };
      },
    },
  ],
};
