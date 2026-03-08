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
  limits: {
    fileSize: 40 * 1024 * 1024,
  },
});

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

function ensurePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    const error = new Error('Prompt is required and cannot be empty.');
    error.statusCode = 400;
    throw error;
  }
}

function cleanText(input) {
  return (input || '').replace(/\s+/g, ' ').trim();
}

async function generateVideoFromPrompt(prompt) {
  if (!ai) {
    return {
      mode: 'demo',
      message: 'Set GEMINI_API_KEY to enable Veo generation. This is a simulation response.',
      previewText: cleanText(prompt).slice(0, 160),
    };
  }

  const response = await ai.models.generateVideos({
    model: 'veo-3.0-generate-preview',
    prompt,
  });

  return {
    mode: 'gemini',
    operation: response,
    message: 'Video generation started. Poll operation status in production flow.',
  };
}

async function generateVideoFromPhotoAndVoice(prompt, imagePath, voicePath) {
  if (!ai) {
    return {
      mode: 'demo',
      message: 'Set GEMINI_API_KEY to enable image-conditioned and voice-conditioned video generation.',
      details: {
        promptPreview: cleanText(prompt).slice(0, 200),
        imageUploaded: Boolean(imagePath),
        voiceUploaded: Boolean(voicePath),
      },
    };
  }

  const imageBytes = fs.readFileSync(imagePath);
  const voiceBytes = voicePath ? fs.readFileSync(voicePath) : null;

  const parts = [
    { text: `Create a cinematic, realistic video from the supplied portrait while strictly following prompt: ${prompt}` },
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBytes.toString('base64'),
      },
    },
  ];

  if (voiceBytes) {
    parts.push({
      inlineData: {
        mimeType: 'audio/mpeg',
        data: voiceBytes.toString('base64'),
      },
    });
    parts.push({ text: 'Use the uploaded voice sample for speech style and timbre.' });
  }

  const response = await ai.models.generateVideos({
    model: 'veo-3.0-generate-preview',
    prompt: parts.map((part) => part.text).filter(Boolean).join(' '),
  });

  return {
    mode: 'gemini',
    operation: response,
    message: 'Photo + voice video generation started.',
  };
}

async function generateImageFromPrompt(prompt) {
  if (!ai) {
    return {
      mode: 'demo',
      imageUrl: `https://placehold.co/1024x1024/08031b/7dffd6/png?text=${encodeURIComponent('Demo Image: ' + cleanText(prompt).slice(0, 48))}`,
      message: 'Set GEMINI_API_KEY to enable Gemini Imagen generation.',
    };
  }

  const response = await ai.models.generateImages({
    model: 'imagen-3.0-generate-002',
    prompt,
    config: {
      numberOfImages: 1,
      outputMimeType: 'image/png',
    },
  });

  const generatedImage = response.generatedImages?.[0]?.image?.imageBytes;
  if (!generatedImage) {
    throw new Error('No image was returned from Gemini.');
  }

  const imageName = `image-${Date.now()}.png`;
  const imagePath = path.join(generatedDir, imageName);
  fs.writeFileSync(imagePath, Buffer.from(generatedImage, 'base64'));

  return {
    mode: 'gemini',
    imageUrl: `/generated/${imageName}`,
  };
}

async function generatePdfFromPrompt(prompt, title) {
  let content = cleanText(prompt);

  if (ai) {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Create a detailed, cleanly structured document body based on this request: ${prompt}`,
    });
    content = response.text || content;
  }

  const fileName = `document-${Date.now()}.pdf`;
  const filePath = path.join(generatedDir, fileName);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(24).fillColor('#00ffff').text(title || 'AI Generated Document');
    doc.moveDown();
    doc.fontSize(12).fillColor('#111111').text(content, {
      align: 'left',
      lineGap: 4,
    });
    doc.end();

    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return {
    mode: ai ? 'gemini' : 'demo',
    pdfUrl: `/generated/${fileName}`,
  };
}

app.post('/api/video/prompt', async (req, res) => {
  try {
    const { prompt } = req.body;
    ensurePrompt(prompt);
    const result = await generateVideoFromPrompt(prompt);
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post('/api/video/photo', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'voice', maxCount: 1 }]), async (req, res) => {
  try {
    const prompt = req.body.prompt;
    ensurePrompt(prompt);

    const photoFile = req.files?.photo?.[0];
    const voiceFile = req.files?.voice?.[0];

    if (!photoFile) {
      return res.status(400).json({ error: 'A person photo is required.' });
    }

    const result = await generateVideoFromPhotoAndVoice(prompt, photoFile.path, voiceFile?.path);
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post('/api/image', async (req, res) => {
  try {
    const { prompt } = req.body;
    ensurePrompt(prompt);
    const result = await generateImageFromPrompt(prompt);
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post('/api/pdf', async (req, res) => {
  try {
    const { prompt, title } = req.body;
    ensurePrompt(prompt);
    const result = await generatePdfFromPrompt(prompt, title);
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Neon AI Studio running on http://localhost:${port}`);
});
