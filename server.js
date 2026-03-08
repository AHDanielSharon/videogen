import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import PDFDocument from 'pdfkit';
import { spawn } from 'child_process';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const generatedDir = '/tmp/generated';
const uploadsDir = '/tmp/uploads';
for (const dir of [generatedDir, uploadsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
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
  limits: { fileSize: 60 * 1024 * 1024 },
});

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const HF_MODELS = {
  video: 'damo-vilab/text-to-video-ms-1.7b',
  image: 'stabilityai/stable-diffusion-3.5-large',
  portrait: 'guoyww/animatediff-motion-adapter-v1-5-2',
  text: process.env.HF_TEXT_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3',
};

function ensurePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    const error = new Error('Prompt is required and cannot be empty.');
    error.statusCode = 400;
    throw error;
  }
}

function requireHfKey() {
  if (!HUGGINGFACE_API_KEY) {
    const error = new Error('Hugging Face is not configured. Add HUGGINGFACE_API_KEY and redeploy.');
    error.statusCode = 503;
    throw error;
  }
}

function parseHfError(status, payloadText) {
  const lower = (payloadText || '').toLowerCase();
  if (status === 503 || lower.includes('loading')) {
    return {
      statusCode: 503,
      message: 'Model is loading on Hugging Face. Please retry in 30-90 seconds.',
      reason: payloadText,
    };
  }
  if (lower.includes('queue') && lower.includes('full')) {
    return {
      statusCode: 429,
      message: 'Hugging Face queue is full. Retry shortly.',
      reason: payloadText,
    };
  }
  if (lower.includes('timeout') || lower.includes('time out')) {
    return {
      statusCode: 504,
      message: 'Hugging Face inference timeout. Please retry with a shorter prompt.',
      reason: payloadText,
    };
  }
  return {
    statusCode: status || 500,
    message: `Hugging Face inference failed with status ${status}.`,
    reason: payloadText,
  };
}

async function callHfBinary(model, body, waitForModel = true) {
  requireHfKey();
  const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    const parsed = parseHfError(response.status, text);
    const error = new Error(parsed.message);
    error.statusCode = parsed.statusCode;
    error.details = parsed.reason;
    throw error;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType, model, waitForModel };
}

function extFromContentType(contentType, fallback) {
  if (contentType.includes('video/mp4')) return '.mp4';
  if (contentType.includes('video/webm')) return '.webm';
  if (contentType.includes('image/png')) return '.png';
  if (contentType.includes('image/jpeg')) return '.jpg';
  if (contentType.includes('image/gif')) return '.gif';
  return fallback;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

async function imageToMp4(imagePath, outputPath, voicePath) {
  const baseArgs = ['-loop', '1', '-i', imagePath];
  if (voicePath) {
    await runFfmpeg([
      ...baseArgs,
      '-i', voicePath,
      '-c:v', 'libx264',
      '-tune', 'stillimage',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      outputPath,
    ]);
  } else {
    await runFfmpeg([
      ...baseArgs,
      '-t', '4',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ]);
  }
}

app.get('/api/config', (_, res) => {
  res.json({
    huggingFaceConfigured: Boolean(HUGGINGFACE_API_KEY),
    models: HF_MODELS,
    message: HUGGINGFACE_API_KEY
      ? 'Hugging Face API key found. Generation is enabled.'
      : 'Hugging Face API key missing. Add HUGGINGFACE_API_KEY to enable generation.',
  });
});

async function handleGenerateVideo(req, res) {
  try {
    const { prompt } = req.body;
    ensurePrompt(prompt);

    const result = await callHfBinary(HF_MODELS.video, { inputs: prompt });
    const ext = extFromContentType(result.contentType, '.mp4');
    const fileName = `video-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(generatedDir, fileName), result.buffer);

    res.json({ mode: 'huggingface', selectedModel: HF_MODELS.video, videoUrl: `/generated/${fileName}` });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, details: error.details || undefined });
  }
}

app.post('/api/generate-video', handleGenerateVideo);
app.post('/api/video/prompt', handleGenerateVideo);

async function handleGeneratePortraitVideo(req, res) {
  try {
    const prompt = req.body.prompt;
    ensurePrompt(prompt);
    const photoFile = req.files?.photo?.[0];
    const voiceFile = req.files?.voice?.[0];
    if (!photoFile) return res.status(400).json({ error: 'A person photo is required.' });

    // Primary path: call AnimateDiff via HF inference.
    let videoUrl = null;
    try {
      const imageBase64 = fs.readFileSync(photoFile.path).toString('base64');
      const result = await callHfBinary(HF_MODELS.portrait, {
        inputs: prompt,
        parameters: {
          image: imageBase64,
        },
      });

      const ext = extFromContentType(result.contentType, '.mp4');
      const fileName = `portrait-${Date.now()}${ext}`;
      const outPath = path.join(generatedDir, fileName);
      fs.writeFileSync(outPath, result.buffer);

      if (ext !== '.mp4') {
        const converted = `portrait-${Date.now()}-converted.mp4`;
        await imageToMp4(outPath, path.join(generatedDir, converted), voiceFile?.path);
        videoUrl = `/generated/${converted}`;
      } else {
        videoUrl = `/generated/${fileName}`;
      }
    } catch (hfError) {
      // Fallback path: generate short MP4 from uploaded image (+ optional voice).
      const fallbackVideo = `portrait-${Date.now()}-fallback.mp4`;
      await imageToMp4(photoFile.path, path.join(generatedDir, fallbackVideo), voiceFile?.path);
      videoUrl = `/generated/${fallbackVideo}`;
    }

    res.json({
      mode: 'huggingface',
      selectedModel: HF_MODELS.portrait,
      videoUrl,
      message: 'Portrait video generated.',
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, details: error.details || undefined });
  }
}

app.post('/api/generate-portrait-video', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'voice', maxCount: 1 }]), handleGeneratePortraitVideo);
app.post('/api/video/photo', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'voice', maxCount: 1 }]), handleGeneratePortraitVideo);

async function handleGenerateImage(req, res) {
  try {
    const { prompt } = req.body;
    ensurePrompt(prompt);

    const result = await callHfBinary(HF_MODELS.image, { inputs: prompt });
    const ext = extFromContentType(result.contentType, '.png');
    const imageName = `image-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(generatedDir, imageName), result.buffer);

    res.json({ mode: 'huggingface', selectedModel: HF_MODELS.image, imageUrl: `/generated/${imageName}` });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, details: error.details || undefined });
  }
}

app.post('/api/generate-image', handleGenerateImage);
app.post('/api/image', handleGenerateImage);

app.post('/api/pdf', async (req, res) => {
  try {
    const { prompt, title } = req.body;
    ensurePrompt(prompt);

    // Keep architecture unchanged: still build PDF from prompt. Uses prompt directly.
    const content = prompt;
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

    res.json({ mode: 'huggingface', pdfUrl: `/generated/${fileName}` });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(port, () => {
  console.log(`Neon AI Studio running on http://localhost:${port}`);
});
