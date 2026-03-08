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
# add your GEMINI_API_KEY in .env
npm run dev
```

Open: `http://localhost:3000`

## Notes

- If no `GEMINI_API_KEY` is configured, the app runs in demo mode and returns mock/simulated outputs where needed.
- Prompts use textareas and are not length-capped by app code.
