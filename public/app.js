const installBtn = document.getElementById('installBtn');
const configStatus = document.getElementById('configStatus');
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.hidden = false;
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

async function postJson(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  const result = await response.json();
  if (!response.ok) throw new Error(formatApiError(result));
  return result;
}

function setResult(el, data) {
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function formatApiError(result) {
  if (!result) return 'Request failed';
  const lines = [];
  if (result.error) lines.push(result.error);
  if (Array.isArray(result.recoverySteps) && result.recoverySteps.length) {
    lines.push('');
    lines.push('How to fix:');
    result.recoverySteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  if (result.details) {
    lines.push('');
    lines.push('Raw details:');
    lines.push(typeof result.details === 'string' ? result.details : JSON.stringify(result.details));
  }
  return lines.join('\n');
}

async function loadConfigStatus() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    const configured = Boolean(config.huggingFaceConfigured ?? config.geminiConfigured);
    configStatus.textContent = config.message;
    configStatus.classList.toggle('ok', configured);
    configStatus.classList.toggle('error', !configured);
  } catch {
    configStatus.textContent = 'Could not load Gemini configuration status.';
    configStatus.classList.add('error');
  }
}

document.getElementById('videoPromptBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('videoPromptResult');
  try {
    setResult(resultEl, 'Generating video... this can take up to 2-3 minutes.');
    const prompt = document.getElementById('videoPrompt').value;
    const result = await postJson('/api/video/prompt', { prompt, timeoutSec: 180 });
    setResult(resultEl, result);
  } catch (error) {
    setResult(resultEl, error.message);
  }
});

document.getElementById('photoVideoBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('photoVideoResult');
  try {
    setResult(resultEl, 'Generating portrait video... this can take up to 2-3 minutes.');

    const fd = new FormData();
    fd.append('prompt', document.getElementById('photoVideoPrompt').value);
    fd.append('timeoutSec', '180');

    const photo = document.getElementById('personPhoto').files[0];
    const voice = document.getElementById('personVoice').files[0];
    if (photo) fd.append('photo', photo);
    if (voice) fd.append('voice', voice);

    const response = await fetch('/api/video/photo', { method: 'POST', body: fd });
    const result = await response.json();
    if (!response.ok) throw new Error(formatApiError(result));
    setResult(resultEl, result);
  } catch (error) {
    setResult(resultEl, error.message);
  }
});

document.getElementById('imageBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('imageResult');
  const output = document.getElementById('imageOutput');
  try {
    setResult(resultEl, 'Generating image...');
    output.hidden = true;
    const prompt = document.getElementById('imagePrompt').value;
    const result = await postJson('/api/image', { prompt });
    if (result.imageUrl) {
      output.src = result.imageUrl;
      output.hidden = false;
    }
    setResult(resultEl, result);
  } catch (error) {
    setResult(resultEl, error.message);
  }
});

document.getElementById('pdfBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('pdfResult');
  const link = document.getElementById('pdfLink');
  try {
    setResult(resultEl, 'Generating PDF...');
    link.hidden = true;

    const prompt = document.getElementById('pdfPrompt').value;
    const title = document.getElementById('pdfTitle').value;
    const result = await postJson('/api/pdf', { prompt, title });

    if (result.pdfUrl) {
      link.href = result.pdfUrl;
      link.hidden = false;
      link.textContent = 'Open Generated PDF';
    }

    setResult(resultEl, result);
  } catch (error) {
    setResult(resultEl, error.message);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js');
  });
}

loadConfigStatus();
