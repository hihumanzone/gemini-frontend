import 'https://cdn.jsdelivr.net/npm/markdown-it/dist/markdown-it.min.js';

let genAI, model;
let chatHistory = [];
let attachments = [];
const MAX_ATTACHMENTS = 10;
const supportedFileExtensions = [
  'html', 'js', 'css', 'json', 'xml', 'csv', 'py', 'java', 'sql', 'log', 'md', 'txt', 'pdf', 'docx'
];
let stopGenerationFlag = false;

const systemPrompt = "You are Gemini, a helpful assistant.";

document.addEventListener('DOMContentLoaded', async () => {
  let API_KEY = localStorage.getItem('googleAPIKey');
  let toolConfig = localStorage.getItem('toolConfig');

  if (!API_KEY) {
    API_KEY = prompt("Please enter your Google API Key");
    if (API_KEY) {
      localStorage.setItem('googleAPIKey', API_KEY);
    } else {
      showErrorMessage('API Key is required to use this application.');
      return;
    }
  }

  const { GoogleGenerativeAI } = await import("https://esm.run/@google/generative-ai");

  const textarea = document.querySelector('.input-bar');
  textarea.addEventListener('input', autoResize);

  try {
    genAI = new GoogleGenerativeAI(API_KEY);
    model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-exp",
      tools: getToolConfig(),
      systemInstruction: systemPrompt
    });
  } catch (error) {
    showErrorMessage('API Initialization failed: ' + error.message);
  }

  window.sendMessage = sendMessage;
  window.handleFileUpload = handleFileUpload;
  window.stopGeneration = stopGeneration;
  window.toggleSettingsMenu = toggleSettingsMenu;
  window.updateToolConfig = updateToolConfig;

  if (toolConfig) {
    document.querySelector(`input[name="tool-option"][value="${toolConfig}"]`).checked = true;
  }
});

function getToolConfig() {
  let toolConfig = localStorage.getItem('toolConfig');
  switch (toolConfig) {
    case 'googleSearch':
      return [{ googleSearch: {} }];
    case 'codeExecution':
      return [{ codeExecution: {} }];
    case 'none':
    default:
      return [];
  }
}

function updateToolConfig(value) {
  localStorage.setItem('toolConfig', value);
  model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    tools: getToolConfig(),
    systemInstruction: systemPrompt
  });
}

function toggleSettingsMenu() {
  const menu = document.querySelector('.settings-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function autoResize() {
  const textarea = this;
  textarea.style.height = '28px';
  textarea.style.height = Math.min(textarea.scrollHeight - 28, 200) + 'px';
}

function handleFileUpload(event) {
  const files = Array.from(event.target.files);
  const unsupportedFiles = [];

  if (attachments.length + files.length > MAX_ATTACHMENTS) {
    showErrorMessage(`You can upload a maximum of ${MAX_ATTACHMENTS} attachments.`);
    return;
  }

  files.forEach(file => {
    const extension = file.name.split('.').pop().toLowerCase();
    const contentType = file.type.toLowerCase();

    if (
      (contentType.startsWith('image/') && contentType !== 'image/gif') ||
      contentType.startsWith('audio/') ||
      contentType.startsWith('video/') ||
      supportedFileExtensions.includes(extension)
    ) {
      const reader = new FileReader();
      reader.onload = (e) => {
        attachments.push({ file, url: e.target.result });
        renderAttachmentsPreview();
      };
      reader.readAsDataURL(file);
    } else {
      unsupportedFiles.push(file.name);
    }
  });

  if (unsupportedFiles.length > 0) {
    showErrorMessage(`The following files are unsupported: ${unsupportedFiles.join(", ")}`);
  }
}

function renderAttachmentsPreview() {
  const container = document.getElementById('attachments-container');
  container.innerHTML = '';

  attachments.forEach((attachment, index) => {
    const previewElement = document.createElement('div');
    previewElement.classList.add('attachment-preview');

    if (attachment.file.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = attachment.url;
      img.onerror = () => createFallbackPreview(previewElement, attachment.file.name);
      previewElement.appendChild(img);
    } else if (attachment.file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = attachment.url;
      video.controls = true;
      video.onerror = () => createFallbackPreview(previewElement, attachment.file.name);
      previewElement.appendChild(video);
    } else {
      createFallbackPreview(previewElement, attachment.file.name);
    }

    const removeBtn = document.createElement('button');
    removeBtn.classList.add('remove-btn');
    removeBtn.innerHTML = '×';
    removeBtn.onclick = () => removeAttachment(index);
    previewElement.appendChild(removeBtn);

    container.appendChild(previewElement);
  });
}

function createFallbackPreview(previewElement, filename) {
  const fallback = document.createElement('div');
  fallback.classList.add('fallback-preview');
  fallback.innerText = filename;
  previewElement.innerHTML = '';
  previewElement.appendChild(fallback);
}

function removeAttachment(index) {
  attachments.splice(index, 1);
  renderAttachmentsPreview();
}

async function fileToGenerativePart(file) {
  const base64EncodedDataPromise = new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
}

async function sendMessage() {
  const stopButton = document.querySelector('.stop-button');
  stopButton.style.display = 'flex';
  stopGenerationFlag = false;
  const chat = model.startChat({ history: getHistory() });
  const newHistory = [];
  const input = document.querySelector('.input-bar');
  const message = input.value.trim();
  if (!message && attachments.length === 0) return;

  const attachmentParts = await Promise.all(
    attachments.map(async (attachment) => await fileToGenerativePart(attachment.file))
  );
  const userParts = [{ text: message }, ...attachmentParts];

  newHistory.push({ role: 'user', content: userParts });

  attachments = [];
  document.getElementById('file-input').value = '';
  renderAttachmentsPreview();

  input.value = '';
  input.style.height = '20px';

  const responseContainer = document.getElementById('response-container');
  responseContainer.innerHTML = '<div id="bot-response"></div>';
  const botResponseElement = document.getElementById('bot-response');

  try {
    let fullResponse = "";
    const md = new markdownit();
    botResponseElement.innerHTML = '<span class="blinking-circle"></span>';
    await getResponse(userParts);
    async function getResponse(message) {
      const result = await chat.sendMessageStream(message);
      for await (const chunk of result.stream) {
        if (stopGenerationFlag) {
          stopButton.style.display = 'none';
          return;
        }
        const chunkText = await chunk.text();
        fullResponse += chunkText;
        const renderedHTML = md.render(fullResponse);
        botResponseElement.innerHTML = renderedHTML + '<span class="blinking-circle"></span>';
      }
    }

    const blinkingCircle = document.querySelector('.blinking-circle');
    if (blinkingCircle) {
      blinkingCircle.remove();
    }

    stopButton.style.display = 'none';
    newHistory.push({ role: 'assistant', content: [{ text: fullResponse }] });
    updateChatHistory(newHistory);
  } catch (error) {
    showErrorMessage(error.message);
    const blinkingCircle = document.querySelector('.blinking-circle');
    if (blinkingCircle) {
      blinkingCircle.remove();
    }
    stopButton.style.display = 'none';
  }
}

function stopGeneration() {
  stopGenerationFlag = true;
  const blinkingCircle = document.querySelector('.blinking-circle');
  if (blinkingCircle) {
    blinkingCircle.remove();
  }
}

function updateChatHistory(newHistory) {
  chatHistory = [...chatHistory, ...newHistory];
}

function getHistory() {
  return chatHistory.map(entry => {
    return {
      role: entry.role === 'assistant' ? 'model' : entry.role,
      parts: entry.content
    };
  });
}

function showErrorMessage(message) {
  const errorMessagesContainer = document.getElementById('error-messages');
  errorMessagesContainer.textContent = message;
  errorMessagesContainer.classList.add('show');
  setTimeout(() => {
    errorMessagesContainer.classList.remove('show');
  }, 5000);
}