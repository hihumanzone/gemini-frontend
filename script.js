import 'https://cdn.jsdelivr.net/npm/markdown-it/dist/markdown-it.min.js';

let genAI, model;
let chatHistory = [];
let attachments = [];
const MAX_ATTACHMENTS = 10;
const supportedFileExtensions = [
  'html', 'js', 'css', 'json', 'xml', 'csv', 'py', 'java', 'sql', 'log', 'md', 'txt', 'pdf', 'docx'
];
let stopGenerationFlag = false;

const systemPrompt = "You are Gemini, a helpful assistant with the ability to perform web searches and view websites using the tools provided. When a user asks you a question and you are uncertain or don't know about the topic, or if you simply want to learn more, you can use web search and search different websites to find up-to-date information on that topic. You can retrieve the content of webpages from search result links using the Search Website tool. Use several tool calls consecutively, performing deep searches and trying your best to extract relevant and helpful information before responding to the user. You are a multimodal model, equipped with the ability to read images, videos, and audio files.";

const function_declarations = [
  {
    name: "web_search",
    parameters: {
      type: "object",
      description: "Search the internet to find up-to-date information on a given topic.",
      properties: {
        query: {
          type: "string",
          description: "The query to search for."
        }
      },
      required: ["query"]
    }
  },
  {
    name: "search_webpage",
    parameters: {
      type: "object",
      description: "Returns a string with all the content of a webpage. Some websites block this, so try a few different websites.",
      properties: {
        url: {
          type: "string",
          description: "The URL of the site to search."
        }
      },
      required: ["url"]
    }
  },
  {
    name: "calculate",
    parameters: {
      type: "object",
      description: "Calculates a given mathematical equation and returns the result. Use this for calculations when writing responses. Examples: '12 / (2.3 + 0.7)' -> '4', '12.7 cm to inch' -> '5 inch', 'sin(45 deg) ^ 2' -> '0.5', '9 / 3 + 2i' -> '3 + 2i', 'det([-1, 2; 3, 1])' -> '-7'",
      properties: {
        equation: {
          type: "string",
          description: "The equation to be calculated."
        }
      },
      required: ["equation"]
    }
  }
];

document.addEventListener('DOMContentLoaded', async () => {
  let API_KEY = localStorage.getItem('googleAPIKey');

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
      model: "gemini-1.5-flash",
      tools: { functionDeclarations: function_declarations },
      systemInstruction: systemPrompt
    });
  } catch (error) {
    showErrorMessage('API Initialization failed: ' + error.message);
  }

  window.sendMessage = sendMessage;
  window.handleFileUpload = handleFileUpload;
  window.stopGeneration = stopGeneration;
});

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
  stopGenerationFlag = false; // Reset the flag when a new message is sent
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
    let realResponse = "";
    const md = new markdownit();
    await getResponse(userParts);
    async function getResponse(message) {
      const result = await chat.sendMessageStream(message);
      for await (const chunk of result.stream) {
        if (stopGenerationFlag) return;
        const chunkText = await chunk.text();
        fullResponse += chunkText;
        realResponse += chunkText;
        const renderedHTML = md.render(fullResponse);
        botResponseElement.innerHTML = renderedHTML + '<span class="blinking-circle"></span>';

        const toolCalls = chunk.functionCalls();
        if (toolCalls) {
          function convertArrayFormat(inputArray) {
            return inputArray.map(item => ({
              functionCall: {
                name: item.name,
                args: item.args
              }
            }));
          }
          const modelParts = convertArrayFormat(toolCalls);
          newHistory.push({ role: 'model', content: modelParts });
          fullResponse = fullResponse.trim() + '\n\n' + `- ${processFunctionCallsNames(toolCalls)}` + '\n\n';
          const renderedHTML = md.render(fullResponse);
          botResponseElement.innerHTML = renderedHTML + '<span class="blinking-circle"></span>';
          const toolCallsResults = [];
          for (const toolCall of toolCalls) {
            const result = await manageToolCall(toolCall);
            toolCallsResults.push(result);
          }
          newHistory.push({ role: 'user', content: toolCallsResults });
          if (!stopGenerationFlag) await getResponse(toolCallsResults);
        }
      }
    }

    const blinkingCircle = document.querySelector('.blinking-circle');
    if (blinkingCircle) {
      blinkingCircle.remove();
    }

    newHistory.push({ role: 'assistant', content: [{ text: realResponse }] });
    updateChatHistory(newHistory);
  } catch (error) {
    showErrorMessage(error.message);
    const blinkingCircle = document.querySelector('.blinking-circle');
    if (blinkingCircle) {
      blinkingCircle.remove();
    }
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

async function webSearch(args, name) {
  const query = args.query;
  try {
    const result = await performSearch(query);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            query: query,
            content: result
          }
        }
      }
    ];
    return function_call_result_message;
  } catch (error) {
    const errorMessage = `Error while performing web search: ${error}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            query: query,
            content: errorMessage
          }
        }
      }
    ];
    return function_call_result_message;
  }
}

async function searchWebpage(args, name) {
  const url = args.url;
  try {
    const result = await searchWebpageContent(url);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            url: url,
            content: result
          }
        }
      }
    ];
    return function_call_result_message;
  } catch (error) {
    const errorMessage = `Error while searching the site: ${error}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            url: url,
            content: errorMessage
          }
        }
      }
    ];
    return function_call_result_message;
  }
}

async function searchWebpageContent(url) {
  const CORS_PROXY = "https://cors-anywhere.herokuapp.com/";
  const TIMEOUT = 5000; // 5 seconds

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timed out after 5 seconds')), TIMEOUT)
  );

  try {
    const response = await Promise.race([fetch(CORS_PROXY + url), timeoutPromise]);

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('script').forEach(script => script.remove());
    doc.querySelectorAll('style').forEach(style => style.remove());
    let bodyText = doc.body.textContent || "";
    bodyText = bodyText.trim();

    bodyText = bodyText.replace(/<[^>]*>?/gm, ''); // remove HTML tags
    bodyText = bodyText.replace(/\s{6,}/g, '  '); // replace sequences of 6 or more whitespace characters with 2 spaces
    bodyText = bodyText.replace(/(\r?\n){6,}/g, '\n\n'); // replace sequences of 6 or more line breaks with 2 line breaks

    const trimmedBodyText = bodyText.trim();
    return trimmedBodyText;
  } catch (error) {
    throw new Error(error.message || 'Could not search content from webpage');
  }
}

async function performSearch(query) {
  const CORS_PROXY = "https://cors-anywhere.herokuapp.com/";
  const url = `https://search.neuranet-ai.com/search?query=${encodeURIComponent(query)}&limit=5`;

  try {
    const response = await fetch(CORS_PROXY + url);

    if (!response.ok) {
      throw new Error(`Failed to perform the search request: ${response.statusText}`);
    }

    const entries = await response.json();

    const resultObject = entries.slice(0, 5).map((entry, index) => {
      const title = entry.title;
      const result = entry.snippet;
      const url = entry.link;

      return {
        [`result_${index + 1}`]: { title, result, url }
      };
    });

    const note = {
      "Note": "Search results provide only an overview and do not offer sufficiently detailed information. Please continue by using the Search Website tool and search websites to find relevant information about the topic."
    };

    return JSON.stringify(resultObject.reduce((acc, curr) => Object.assign(acc, curr), note), null, 2);
  } catch (error) {
    throw new Error(`Failed to perform the search request: ${error.message}`);
  }
}

function calculate(args, name) {
  const equation = args.equation;
  try {
    const result = math.evaluate(equation).toString();
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            equation: equation,
            content: result
          }
        }
      }
    ];
    return function_call_result_message;
  } catch (error) {
    const errorMessage = `Error calculating the equation: ${error}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: name,
          response: {
            equation: equation,
            content: errorMessage
          }
        }
      }
    ];
    return function_call_result_message;
  }
}

async function manageToolCall(toolCall) {
  const tool_calls_to_function = {
    "web_search": webSearch,
    "search_webpage": searchWebpage,
    "calculate": calculate
  }
  const functionName = toolCall.name;
  const func = tool_calls_to_function[functionName];
  if (func) {
    const args = toolCall.args;
    const result = await func(args, functionName);
    return result;
  } else {
    const errorMessage = `No function found for ${functionName}`;
    console.error(errorMessage);
    const function_call_result_message = [
      {
        functionResponse: {
          name: functionName,
          response: {
            name: functionName,
            content: errorMessage
          }
        }
      }
    ];
    return function_call_result_message;
  }
}

function processFunctionCallsNames(functionCalls) {
  return functionCalls
    .map(tc => {
      if (!tc.name) return '';

      const formattedName = tc.name.split('_')
        .map(word => {
          if (isNaN(word)) {
            return word.charAt(0).toUpperCase() + word.slice(1);
          }
          return word;
        })
        .join(' ');

      const formattedArgs = tc.args ? Object.entries(tc.args)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ') : '';

      return formattedArgs ? `${formattedName} (${formattedArgs})` : formattedName;
    })
    .filter(name => name)
    .join(', ');
}
