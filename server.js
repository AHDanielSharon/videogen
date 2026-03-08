import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import PDFDocument from 'pdfkit';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const generatedDir = path.join(__dirname, 'public', 'generated');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
for (const dir of [generatedDir, uploadsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/generated', express.static(generatedDir));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => {
      const unique = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: 40 * 1024 * 1024 },
});

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

const MODELS = {
  video: process.env.GEMINI_VIDEO_MODEL || 'veo-3.0-generate-preview',
  image: process.env.GEMINI_IMAGE_MODEL || 'imagen-3.0-generate-002',
  text: process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash',
};

function ensurePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    const error = new Error('Prompt is required and cannot be empty.');
    error.statusCode = 400;
    throw error;
  }
}

function requireAiOrThrow() {
  if (!ai) {
    const error = new Error('Gemini is not configured. Add GEMINI_API_KEY in environment variables and redeploy.');
    error.statusCode = 503;
    throw error;
  }
}

async function pollVideoOperation(operation, timeoutSec = 180, intervalMs = 10000) {
  requireAiOrThrow();
  let current = operation;
  const deadline = Date.now() + timeoutSec * 1000;

  while (!current.done && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    current = await ai.operations.getVideosOperation({ operation: current });
  }

  return current;
}

function toVideoResponse(operation) {
  const videoUri = operation?.response?.generatedVideos?.[0]?.video?.uri || null;
  return {
    done: Boolean(operation?.done),
    name: operation?.name,
    videoUri,
    error: operation?.error || null,
  };
}

app.get('/api/config', (_, res) => {
  res.json({
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    models: MODELS,
    message: process.env.GEMINI_API_KEY
      ? 'Gemini API key found. Generation is enabled.'
      : 'Gemini API key missing. Add GEMINI_API_KEY to enable generation.',
  });
});

app.post('/api/video/prompt', async (req, res) => {
  try {
    requireAiOrThrow();
    const { prompt, timeoutSec } = req.body;
    ensurePrompt(prompt);

    const operation = await ai.models.generateVideos({
      model: MODELS.video,
      prompt,
      config: { numberOfVideos: 1 },
    });

    const completed = await pollVideoOperation(operation, Number(timeoutSec) || 180);
    const payload = toVideoResponse(completed);

    if (payload.error) {
      return res.status(502).json({ error: 'Video generation failed in Gemini operation.', details: payload.error, operation: payload });
    }

    res.json({ mode: 'gemini', operation: payload, message: payload.videoUri ? 'Video generated successfully.' : 'Operation finished but no video URI returned.' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post('/api/video/photo', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'voice', maxCount: 1 }]), async (req, res) => {
  try {
    requireAiOrThrow();
    const prompt = req.body.prompt;
    const timeoutSec = Number(req.body.timeoutSec) || 180;
    ensurePrompt(prompt);

    const photoFile = req.files?.photo?.[0];
    const voiceFile = req.files?.voice?.[0];
    if (!photoFile) return res.status(400).json({ error: 'A person photo is required.' });

    const conditioning = [
      'Create a cinematic character video based on user instructions.',
      `Primary prompt: ${prompt}`,
      `Reference photo filename: ${photoFile.filename}. Preserve person identity and facial consistency.`,
      voiceFile
        ? `Voice sample filename: ${voiceFile.filename}. Use this sample to guide speech style, tone and pacing.`
        : 'No voice sample provided; use natural voice matching character look and requested language.',
    ].join(' ');

    const operation = await ai.models.generateVideos({
      model: MODELS.video,
      prompt: conditioning,
      config: { numberOfVideos: 1 },
    });

    const completed = await pollVideoOperation(operation, timeoutSec);
    const payload = toVideoResponse(completed);

    if (payload.error) {
      return res.status(502).json({ error: 'Portrait video generation failed in Gemini operation.', details: payload.error, operation: payload });
    }

    res.json({
      mode: 'gemini',
      operation: payload,
      message: payload.videoUri ? 'Portrait video generated successfully.' : 'Operation finished but no video URI returned.',
      note: 'Current API call is prompt-conditioned with uploaded metadata. For strict identity/voice cloning, attach dedicated provider workflow that accepts media conditioning directly.',
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post('/api/image', async (req, res) => {
  try {
    requireAiOrThrow();
    const { prompt } = req.body;
    ensurePrompt(prompt);

    const response = await ai.models.generateImages({
      model: MODELS.image,
      prompt,
      config: { numberOfImages: 1, outputMimeType: 'image/png' },
    });

    const generatedImage = response.generatedImages?.[0]?.image?.imageBytes;
    if (!generatedImage) throw new Error('No image was returned from Gemini.');

    const imageName = `image-${Date.now()}.png`;
    fs.writeFileSync(path.join(generatedDir, imageName), Buffer.from(generatedImage, 'base64'));
    res.json({ mode: 'gemini', imageUrl: `/generated/${imageName}`, message: 'Image generated successfully.' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post('/api/pdf', async (req, res) => {
  try {
    requireAiOrThrow();
    const { prompt, title } = req.body;
    ensurePrompt(prompt);

    const contentResponse = await ai.models.generateContent({
      model: MODELS.text,
      contents: `Create a high-quality, cleanly structured document body based on this request:\n\n${prompt}`,
    });

    const content = contentResponse.text || prompt;
    const fileName = `document-${Date.now()}.pdf`;
    const filePath = path.join(generatedDir, fileName);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);
      doc.fontSize(24).fillColor('#00ffff').text(title || 'AI Generated Document');
      doc.moveDown();
      doc.fontSize(12).fillColor('#111111').text(content, { align: 'left', lineGap: 4 });
      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    res.json({ mode: 'gemini', pdfUrl: `/generated/${fileName}`, message: 'PDF generated successfully.' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, () => {
  console.log(`Neon AI Studio running on http://localhost:${port}`);
});
