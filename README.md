# Neon Infinity AI Studio (PWA)

Backend now uses **Hugging Face Inference API** for media generation.

## Setup

```bash
npm install
cp .env.example .env
# REQUIRED: set HUGGINGFACE_API_KEY in .env
npm run dev
```

Open: `http://localhost:3000`

## Endpoints

- `POST /api/generate-video` (also available at `/api/video/prompt`)
  - Model: `damo-vilab/text-to-video-ms-1.7b`
- `POST /api/generate-image` (also available at `/api/image`)
  - Model: `stabilityai/stable-diffusion-3.5-large`
- `POST /api/generate-portrait-video` (also available at `/api/video/photo`)
  - Model: `guoyww/animatediff-motion-adapter-v1-5-2`
- `POST /api/pdf`

Generated outputs are stored under `/tmp/generated` and served from `/generated/*`.

## Error handling

The backend returns structured messages for common Hugging Face failures including:
- model loading (`503`)
- queue full (`429`)
- inference timeout (`504`)
