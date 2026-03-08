# Neon Infinity AI Studio (PWA)

A colorful neon AI creation app that supports:

- Video generation from text prompt.
- Video generation from a person's photo + prompt + optional voice sample.
- Image generation from text prompt.
- PDF generation from text prompt.
- Progressive Web App install support for mobile and desktop.

## Setup

```bash
npm install
cp .env.example .env
# REQUIRED: set GEMINI_API_KEY in .env
npm run dev
```

Open: `http://localhost:3000`

## Important

- Generation endpoints require `GEMINI_API_KEY` and will return an explicit error if missing.
- Video generation uses Gemini long-running operations and can take 1–3 minutes.
- Prompts use textareas and are not length-capped by app code.

## Render quick check

- Ensure `GEMINI_API_KEY` is set in Render environment variables.
- Verify `/api/config` returns `"geminiConfigured": true` after deploy.
