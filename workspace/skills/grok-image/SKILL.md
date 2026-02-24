---
name: Grok Image
description: Generate high-quality images using xAI's Grok Imagine model.
---

# Grok Image Skill

This skill allows the Adytum agent to generate images using xAI's **Grok Imagine** model. It provides a powerful tool for visual creation, supporting various aspect ratios and high resolutions.

## Features

- **Text-to-Image**: Generate images from detailed text descriptions.
- **Multiple Aspect Ratios**: Choose from square (1:1), cinematic (16:9), portrait (9:16), and more.
- **High Resolution**: Supports both 1k and 2k output resolutions.
- **xAI Integration**: Native integration with xAI's latest image generation models.

## Tools

- `grok_generate_image`: Create an image based on a prompt.
  - `prompt`: (Required) Detailed description of the image.
  - `aspect_ratio`: (Optional) Choose the dimensions (default: 1:1).
  - `resolution`: (Optional) Choose quality (1k or 2k).

## Setup Instructions

### 1. Obtain xAI API Key

1. Go to the [xAI Console](https://console.x.ai/).
2. Create or find your API Key.

### 2. Configure in Adytum

1. Open the Adytum Dashboard and go to **Skills** > **Grok Image**.
2. Set the **XAI_API_KEY** in the Secrets section or set the environment variable `XAI_API_KEY`.
3. Ensure the skill is **Enabled**.

## Configuration Options

- **Model**: Default is `grok-imagine-image`.
- **Default Aspect Ratio**: Set a global default for all generated images.
- **Default Resolution**: Choose between 1k (standard) or 2k (high quality).

## Example Usage

> "Generate an image of a futuristic cyberpunk cafe in Tokyo, 16:9 aspect ratio, 2k resolution."
