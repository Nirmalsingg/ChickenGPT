const STORAGE_KEY = "chickengpt.conversations.v2";
const LEGACY_STORAGE_KEY = "chickengpt.conversations.v1";
const SETTINGS_KEY = "chickengpt.settings.v1";
const ACTIVE_CHAT_KEY = "chickengpt.activeChat.v1";
const MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"];

const elements = {
  attachmentRow: document.querySelector("#attachmentRow"),
  attachButton: document.querySelector("#attachButton"),
  charCounter: document.querySelector("#charCounter"),
  chatList: document.querySelector("#chatList"),
  chatTitle: document.querySelector("#chatTitle"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  closeSidebarButton: document.querySelector("#closeSidebarButton"),
  composer: document.querySelector("#composer"),
  dropZone: document.querySelector("#dropZone"),
  exportButton: document.querySelector("#exportButton"),
  fileInput: document.querySelector("#fileInput"),
  maxTokensInput: document.querySelector("#maxTokensInput"),
  messages: document.querySelector("#messages"),
  modelSelect: document.querySelector("#modelSelect"),
  newChatButton: document.querySelector("#newChatButton"),
  openSidebarButton: document.querySelector("#openSidebarButton"),
  promptInput: document.querySelector("#promptInput"),
  quickModelSelect: document.querySelector("#quickModelSelect"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  sendButton: document.querySelector("#sendButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsModal: document.querySelector("#settingsModal"),
  shareButton: document.querySelector("#shareButton"),
  sidebar: document.querySelector("#sidebar"),
  statusLabel: document.querySelector("#statusLabel"),
  stopButton: document.querySelector("#stopButton"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  temperatureInput: document.querySelector("#temperatureInput"),
  temperatureValue: document.querySelector("#temperatureValue"),
  themeSelect: document.querySelector("#themeSelect"),
  toast: document.querySelector("#toast"),
  voiceButton: document.querySelector("#voiceButton")
};

let conversations = loadConversations();
let settings = loadSettings();
let activeId = localStorage.getItem(ACTIVE_CHAT_KEY) || conversations[0]?.id || createConversation().id;
let pendingAttachments = [];
let isSending = false;
let abortController = null;
let toastTimer = null;

hydrateSharedConversation();
applySettingsToUi();
render();

elements.newChatButton.addEventListener("click", () => {
  activeId = createConversation().id;
  persist();
  render();
  elements.promptInput.focus();
  elements.sidebar.classList.remove("open");
});

elements.clearHistoryButton.addEventListener("click", () => {
  if (!confirm("Clear all saved ChickenGPT chats?")) return;
  conversations = [createConversation("Untitled chat", false)];
  activeId = conversations[0].id;
  persist();
  render();
  showToast("All chats cleared.");
});

elements.settingsButton.addEventListener("click", openSettings);
elements.closeSettingsButton.addEventListener("click", closeSettings);
elements.saveSettingsButton.addEventListener("click", saveSettingsFromUi);
elements.settingsModal.addEventListener("click", (event) => {
  if (event.target === elements.settingsModal) closeSettings();
});

elements.openSidebarButton.addEventListener("click", () => elements.sidebar.classList.add("open"));
elements.closeSidebarButton.addEventListener("click", () => elements.sidebar.classList.remove("open"));

elements.quickModelSelect.addEventListener("change", () => {
  settings.model = elements.quickModelSelect.value;
  elements.modelSelect.value = settings.model;
  saveSettings();
});

elements.themeSelect.addEventListener("change", () => {
  settings.theme = elements.themeSelect.value;
  document.documentElement.dataset.theme = settings.theme;
  saveSettings();
});

elements.temperatureInput.addEventListener("input", () => {
  elements.temperatureValue.textContent = Number(elements.temperatureInput.value).toFixed(1);
});

elements.exportButton.addEventListener("click", exportActiveConversation);
elements.shareButton.addEventListener("click", shareActiveConversation);
elements.attachButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => handleFiles(elements.fileInput.files));
elements.stopButton.addEventListener("click", stopGeneration);
elements.voiceButton.addEventListener("click", startVoiceInput);

elements.promptInput.addEventListener("input", () => {
  resizePrompt();
  renderCharacterCount();
});

elements.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSending) {
    showToast("ChickenGPT is already thinking.");
    return;
  }

  const rawPrompt = elements.promptInput.value.trim();
  if (!rawPrompt && !pendingAttachments.length) return;

  const prompt = buildPromptWithAttachments(rawPrompt);
  const conversation = getActiveConversation();
  conversation.messages.push(createMessage("user", prompt));
  conversation.title = conversation.title === "Untitled chat" ? makeTitle(rawPrompt || pendingAttachments[0]?.name) : conversation.title;
  conversation.updatedAt = Date.now();

  elements.promptInput.value = "";
  pendingAttachments = [];
  resizePrompt();
  renderCharacterCount();
  persist();
  render();
  await requestAssistantReply();
});

for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("drag-over");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("drag-over");
  });
}

elements.dropZone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));

function loadSettings() {
  const defaults = {
    theme: "dark",
    model: "llama-3.3-70b-versatile",
    temperature: 0.7,
    maxTokens: 1200,
    systemPrompt: "You are ChickenGPT, a capable, practical AI assistant. Be direct, useful, and thoughtful."
  };

  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return defaults;
  }
}

function loadConversations() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "[]";
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeConversation).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeConversation(conversation) {
  if (!conversation || !Array.isArray(conversation.messages)) return null;
  return {
    id: conversation.id || crypto.randomUUID(),
    title: conversation.title || "Untitled chat",
    createdAt: conversation.createdAt || Date.now(),
    updatedAt: conversation.updatedAt || conversation.createdAt || Date.now(),
    messages: conversation.messages.map((message) => ({
      id: message.id || crypto.randomUUID(),
      role: message.role,
      content: String(message.content || ""),
      createdAt: message.createdAt || Date.now(),
      error: Boolean(message.error)
    })).filter((message) => message.role === "user" || message.role === "assistant")
  };
}

function createConversation(title = "Untitled chat", insert = true) {
  const conversation = {
    id: crypto.randomUUID(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
  if (insert) conversations.unshift(conversation);
  return conversation;
}

function createMessage(role, content, extra = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
    ...extra
  };
}

function getActiveConversation() {
  let conversation = conversations.find((item) => item.id === activeId);
  if (!conversation) {
    conversation = conversations[0] || createConversation();
    activeId = conversation.id;
  }
  return conversation;
}

function persist() {
  conversations = conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  localStorage.setItem(ACTIVE_CHAT_KEY, activeId);
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applySettingsToUi() {
  document.documentElement.dataset.theme = settings.theme;
  elements.themeSelect.value = settings.theme;
  elements.modelSelect.value = MODELS.includes(settings.model) ? settings.model : MODELS[0];
  elements.quickModelSelect.value = elements.modelSelect.value;
  elements.temperatureInput.value = settings.temperature;
  elements.temperatureValue.textContent = Number(settings.temperature).toFixed(1);
  elements.maxTokensInput.value = settings.maxTokens;
  elements.systemPromptInput.value = settings.systemPrompt;
}

function saveSettingsFromUi() {
  settings = {
    theme: elements.themeSelect.value,
    model: elements.modelSelect.value,
    temperature: Number(elements.temperatureInput.value),
    maxTokens: Number(elements.maxTokensInput.value),
    systemPrompt: elements.systemPromptInput.value.trim()
  };
  applySettingsToUi();
  saveSettings();
  closeSettings();
  showToast("Settings saved.");
}

function openSettings() {
  applySettingsToUi();
  elements.settingsModal.classList.add("open");
  elements.settingsModal.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  elements.settingsModal.classList.remove("open");
  elements.settingsModal.setAttribute("aria-hidden", "true");
}

function render() {
  renderHistory();
  renderMessages();
  renderAttachments();
  renderCharacterCount();
  elements.quickModelSelect.value = settings.model;
}

function renderHistory() {
  const active = getActiveConversation();
  elements.chatTitle.textContent = active.title;
  elements.chatList.innerHTML = "";

  for (const conversation of conversations) {
    const item = document.createElement("div");
    item.className = `chat-item${conversation.id === activeId ? " active" : ""}`;
    item.innerHTML = `
      <button class="chat-open" type="button">
        <strong>${escapeHtml(conversation.title)}</strong>
        <span class="meta">${conversation.messages.length} messages</span>
      </button>
      <div class="chat-item-actions">
        <button class="mini-button" type="button" data-action="rename" title="Rename">R</button>
        <button class="mini-button" type="button" data-action="delete" title="Delete">D</button>
      </div>
    `;

    item.querySelector(".chat-open").addEventListener("click", () => {
      activeId = conversation.id;
      localStorage.setItem(ACTIVE_CHAT_KEY, activeId);
      render();
      elements.sidebar.classList.remove("open");
    });
    item.querySelector('[data-action="rename"]').addEventListener("click", () => renameConversation(conversation.id));
    item.querySelector('[data-action="delete"]').addEventListener("click", () => deleteConversation(conversation.id));
    elements.chatList.appendChild(item);
  }
}

function renderMessages() {
  const conversation = getActiveConversation();
  elements.messages.innerHTML = "";

  if (!conversation.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h3>What should ChickenGPT help you make clearer today?</h3>
      <div class="prompt-grid">
        ${suggestionButton("Design a study plan for mastering AI web apps")}
        ${suggestionButton("Debug this code and explain the fix")}
        ${suggestionButton("Turn my rough idea into a product spec")}
      </div>
    `;
    elements.messages.appendChild(empty);
    for (const button of empty.querySelectorAll(".suggestion")) {
      button.addEventListener("click", () => {
        elements.promptInput.value = button.textContent.trim();
        resizePrompt();
        renderCharacterCount();
        elements.promptInput.focus();
      });
    }
    return;
  }

  for (const message of conversation.messages) {
    elements.messages.appendChild(createMessageNode(message));
  }

  highlightCodeBlocks();
  scrollToLatest();
}

function suggestionButton(text) {
  return `<button class="suggestion" type="button">${escapeHtml(text)}</button>`;
}

function createMessageNode(message) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  node.dataset.messageId = message.id;

  const avatar = message.role === "assistant" ? "C" : "You";
  const isThinking = message.pending && !message.content;
  const content = isThinking
    ? `ChickenGPT is thinking... <span class="typing-dots"><span></span><span></span><span></span></span>`
    : renderMarkdown(message.content);

  node.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="message-body">
      <div class="bubble ${message.error ? "error" : ""}">${content}</div>
      <div class="message-actions">
        <button class="message-action" type="button" data-action="copy">Copy</button>
        ${message.role === "user" ? '<button class="message-action" type="button" data-action="edit">Edit</button>' : ""}
        ${message.role === "assistant" ? '<button class="message-action" type="button" data-action="regenerate">Regenerate</button>' : ""}
        ${message.error ? '<button class="message-action" type="button" data-action="retry">Retry</button>' : ""}
      </div>
    </div>
  `;

  node.querySelector('[data-action="copy"]').addEventListener("click", () => copyText(message.content));
  const editButton = node.querySelector('[data-action="edit"]');
  if (editButton) editButton.addEventListener("click", () => editUserMessage(message.id));
  const regenerateButton = node.querySelector('[data-action="regenerate"]');
  if (regenerateButton) regenerateButton.addEventListener("click", () => regenerateFromMessage(message.id));
  const retryButton = node.querySelector('[data-action="retry"]');
  if (retryButton) retryButton.addEventListener("click", () => retryFailedMessage(message.id));

  return node;
}

function renderMarkdown(text) {
  if (window.marked && window.DOMPurify) {
    marked.setOptions({
      breaks: true,
      gfm: true,
      highlight(code, language) {
        if (!window.hljs) return escapeHtml(code);
        const validLanguage = language && hljs.getLanguage(language);
        return validLanguage ? hljs.highlight(code, { language }).value : hljs.highlightAuto(code).value;
      }
    });
    return DOMPurify.sanitize(marked.parse(String(text || "")));
  }

  return escapeHtml(text).replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>").replace(/`([^`]+)`/g, "<code>$1</code>");
}

function highlightCodeBlocks() {
  if (!window.hljs) return;
  for (const block of elements.messages.querySelectorAll("pre code")) {
    hljs.highlightElement(block);
  }
}

function renderAttachments() {
  elements.attachmentRow.innerHTML = "";
  for (const attachment of pendingAttachments) {
    const pill = document.createElement("div");
    pill.className = "attachment-pill";
    pill.innerHTML = `<span>${escapeHtml(attachment.name)} (${attachment.kind})</span><button class="mini-button" type="button" title="Remove">x</button>`;
    pill.querySelector("button").addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((item) => item.id !== attachment.id);
      renderAttachments();
    });
    elements.attachmentRow.appendChild(pill);
  }
}

function renderCharacterCount() {
  const count = elements.promptInput.value.length;
  elements.charCounter.textContent = `${count.toLocaleString()} character${count === 1 ? "" : "s"}`;
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  for (const file of files.slice(0, 8)) {
    if (file.type.startsWith("image/")) {
      pendingAttachments.push({
        id: crypto.randomUUID(),
        kind: "image",
        name: file.name,
        content: `[Image attached: ${file.name}. ChickenGPT can discuss the image if you describe what should be inspected.]`
      });
      continue;
    }

    const text = await file.text();
    pendingAttachments.push({
      id: crypto.randomUUID(),
      kind: "file",
      name: file.name,
      content: text.slice(0, 25_000)
    });
  }

  elements.fileInput.value = "";
  renderAttachments();
  showToast(`${files.length} attachment${files.length === 1 ? "" : "s"} ready.`);
}

function buildPromptWithAttachments(rawPrompt) {
  const attachmentText = pendingAttachments.map((attachment) => {
    if (attachment.kind === "image") return attachment.content;
    return `Attached file: ${attachment.name}\n\n${attachment.content}`;
  }).join("\n\n---\n\n");

  return [rawPrompt, attachmentText].filter(Boolean).join("\n\n");
}

async function requestAssistantReply(options = {}) {
  if (isSending) return;

  const conversation = getActiveConversation();
  const assistantMessage = options.message || createMessage("assistant", "", { pending: true });
  if (!options.message) conversation.messages.push(assistantMessage);

  isSending = true;
  abortController = new AbortController();
  setSendingState(true);
  persist();
  render();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      signal: abortController.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: true,
        messages: conversation.messages.filter((message) => message.id !== assistantMessage.id && !message.error),
        settings: readSettings()
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `The AI request failed with status ${response.status}.`);
    }

    await readStreamingResponse(response, assistantMessage);
    assistantMessage.pending = false;
    assistantMessage.error = false;
    elements.statusLabel.textContent = `Groq: ${settings.model}`;
  } catch (error) {
    assistantMessage.pending = false;
    if (error.name === "AbortError") {
      assistantMessage.content = assistantMessage.content || "Generation stopped.";
    } else {
      assistantMessage.content = error.message || "The AI request failed.";
      assistantMessage.error = true;
      elements.statusLabel.textContent = "Error";
    }
  } finally {
    conversation.updatedAt = Date.now();
    setSendingState(false);
    elements.statusLabel.textContent = assistantMessage.error ? "Error" : `Groq: ${settings.model}`;
    persist();
    render();
  }
}

async function readStreamingResponse(response, assistantMessage) {
  if (!response.body) throw new Error("Streaming is not available in this browser.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() || "";

    for (const eventBlock of events) {
      const line = eventBlock.split(/\r?\n/).find((item) => item.startsWith("data:"));
      if (!line) continue;

      const payload = JSON.parse(line.slice(5).trim());
      if (payload.event === "token") {
        assistantMessage.pending = false;
        assistantMessage.content += payload.token;
        renderMessages();
      }
      if (payload.event === "error") {
        throw new Error(payload.error || "Streaming failed.");
      }
    }
  }
}

function setSendingState(sending) {
  isSending = sending;
  elements.sendButton.hidden = sending;
  elements.stopButton.hidden = !sending;
  elements.sendButton.disabled = sending;
  elements.promptInput.disabled = sending;
  if (sending) elements.statusLabel.textContent = "ChickenGPT is thinking...";
}

function stopGeneration() {
  if (abortController) abortController.abort();
  showToast("Generation stopped.");
}

function readSettings() {
  return {
    model: settings.model,
    temperature: Number(settings.temperature),
    maxTokens: Number(settings.maxTokens),
    systemPrompt: settings.systemPrompt
  };
}

function renameConversation(id) {
  const conversation = conversations.find((item) => item.id === id);
  if (!conversation) return;

  const title = prompt("Rename chat", conversation.title);
  if (!title?.trim()) return;

  conversation.title = title.trim().slice(0, 80);
  conversation.updatedAt = Date.now();
  persist();
  render();
}

function deleteConversation(id) {
  const conversation = conversations.find((item) => item.id === id);
  if (!conversation || !confirm(`Delete "${conversation.title}"?`)) return;

  conversations = conversations.filter((item) => item.id !== id);
  if (!conversations.length) conversations = [createConversation("Untitled chat", false)];
  activeId = conversations[0].id;
  persist();
  render();
}

function editUserMessage(id) {
  if (isSending) return;
  const conversation = getActiveConversation();
  const index = conversation.messages.findIndex((message) => message.id === id);
  const message = conversation.messages[index];
  if (!message) return;

  const updated = prompt("Edit message", message.content);
  if (!updated?.trim()) return;

  message.content = updated.trim();
  message.createdAt = Date.now();
  conversation.messages = conversation.messages.slice(0, index + 1);
  conversation.updatedAt = Date.now();
  persist();
  render();
  requestAssistantReply();
}

function regenerateFromMessage(id) {
  if (isSending) return;
  const conversation = getActiveConversation();
  const index = conversation.messages.findIndex((message) => message.id === id);
  if (index === -1) return;

  conversation.messages = conversation.messages.slice(0, index);
  conversation.updatedAt = Date.now();
  persist();
  render();
  requestAssistantReply();
}

function retryFailedMessage(id) {
  if (isSending) return;
  const conversation = getActiveConversation();
  const message = conversation.messages.find((item) => item.id === id);
  if (!message) return;

  message.content = "";
  message.error = false;
  message.pending = true;
  conversation.updatedAt = Date.now();
  persist();
  requestAssistantReply({ message });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied.");
  } catch {
    showToast("Copy failed.");
  }
}

function exportActiveConversation() {
  const conversation = getActiveConversation();
  const format = (prompt("Export format: txt, md, or json", "md") || "md").toLowerCase();
  const safeTitle = (conversation.title || "chickengpt-chat").replace(/[\\/:*?"<>|]/g, "-");

  if (format === "json") {
    downloadText(`${safeTitle}.json`, JSON.stringify(conversation, null, 2), "application/json");
    return;
  }

  if (format === "txt") {
    const text = conversation.messages.map((message) => `${message.role.toUpperCase()}\n${message.content}`).join("\n\n---\n\n");
    downloadText(`${safeTitle}.txt`, text || "Empty ChickenGPT chat", "text/plain");
    return;
  }

  const markdown = [
    `# ${conversation.title}`,
    "",
    ...conversation.messages.map((message) => `## ${message.role === "user" ? "You" : "ChickenGPT"}\n\n${message.content}`)
  ].join("\n\n");
  downloadText(`${safeTitle}.md`, markdown, "text/markdown");
}

async function shareActiveConversation() {
  const conversation = getActiveConversation();
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(conversation))));
  const url = `${location.origin}${location.pathname}#share=${encoded}`;

  try {
    await navigator.clipboard.writeText(url);
    showToast("Share link copied.");
  } catch {
    prompt("Share conversation link", url);
  }
}

function hydrateSharedConversation() {
  if (!location.hash.startsWith("#share=")) return;

  try {
    const decoded = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(7)))));
    const conversation = normalizeConversation(decoded);
    if (!conversation) return;
    conversation.id = crypto.randomUUID();
    conversation.title = `${conversation.title} (shared)`;
    conversation.createdAt = Date.now();
    conversation.updatedAt = Date.now();
    conversations.unshift(conversation);
    activeId = conversation.id;
    history.replaceState(null, "", location.pathname);
    persist();
  } catch {
    showToast("Could not load shared conversation.");
  }
}

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast("Voice input is not supported in this browser.");
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.onstart = () => showToast("Listening...");
  recognition.onerror = () => showToast("Voice input failed.");
  recognition.onresult = (event) => {
    const transcript = event.results[0]?.[0]?.transcript || "";
    elements.promptInput.value = `${elements.promptInput.value} ${transcript}`.trim();
    resizePrompt();
    renderCharacterCount();
  };
  recognition.start();
}

function makeTitle(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return cleaned.length > 44 ? `${cleaned.slice(0, 44)}...` : cleaned || "Attached file chat";
}

function resizePrompt() {
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 190)}px`;
}

function scrollToLatest() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
