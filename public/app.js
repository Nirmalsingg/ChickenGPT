const STORAGE_KEY = "chickengpt.conversations.v1";

const elements = {
  chatList: document.querySelector("#chatList"),
  chatTitle: document.querySelector("#chatTitle"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  composer: document.querySelector("#composer"),
  exportButton: document.querySelector("#exportButton"),
  fileInput: document.querySelector("#fileInput"),
  attachButton: document.querySelector("#attachButton"),
  attachmentRow: document.querySelector("#attachmentRow"),
  maxTokensInput: document.querySelector("#maxTokensInput"),
  messages: document.querySelector("#messages"),
  modeSelect: document.querySelector("#modeSelect"),
  modelInput: document.querySelector("#modelInput"),
  newChatButton: document.querySelector("#newChatButton"),
  promptInput: document.querySelector("#promptInput"),
  sendButton: document.querySelector("#sendButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  statusLabel: document.querySelector("#statusLabel"),
  systemPromptInput: document.querySelector("#systemPromptInput"),
  temperatureInput: document.querySelector("#temperatureInput")
};

let conversations = loadConversations();
let activeId = conversations[0]?.id || createConversation().id;
let pendingAttachment = null;
let isSending = false;

render();

elements.newChatButton.addEventListener("click", () => {
  activeId = createConversation().id;
  saveConversations();
  render();
  elements.promptInput.focus();
});

elements.clearHistoryButton.addEventListener("click", () => {
  if (!confirm("Clear all saved ChickenGPT chats?")) return;
  conversations = [createConversation("Untitled chat", false)];
  activeId = conversations[0].id;
  saveConversations();
  render();
});

elements.settingsButton.addEventListener("click", () => {
  elements.settingsPanel.classList.toggle("open");
});

elements.exportButton.addEventListener("click", () => {
  const conversation = getActiveConversation();
  const content = conversation.messages
    .map((message) => `${message.role.toUpperCase()}\n${message.content}`)
    .join("\n\n---\n\n");
  downloadText(`${conversation.title || "chickengpt-chat"}.md`, content || "# Empty ChickenGPT chat");
});

elements.attachButton.addEventListener("click", () => {
  elements.fileInput.click();
});

elements.fileInput.addEventListener("change", async () => {
  const file = elements.fileInput.files[0];
  if (!file) return;
  const text = await file.text();
  pendingAttachment = {
    name: file.name,
    text: text.slice(0, 25000)
  };
  elements.fileInput.value = "";
  renderAttachment();
});

elements.promptInput.addEventListener("input", () => {
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 180)}px`;
});

elements.promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isSending) return;

  const rawPrompt = elements.promptInput.value.trim();
  if (!rawPrompt && !pendingAttachment) return;

  const attachmentText = pendingAttachment
    ? `\n\nAttached file: ${pendingAttachment.name}\n\n${pendingAttachment.text}`
    : "";
  const prompt = `${rawPrompt}${attachmentText}`.trim();
  const conversation = getActiveConversation();
  conversation.messages.push({ role: "user", content: prompt, createdAt: Date.now() });
  conversation.title = conversation.title === "Untitled chat" ? makeTitle(rawPrompt || pendingAttachment.name) : conversation.title;
  conversation.updatedAt = Date.now();

  elements.promptInput.value = "";
  elements.promptInput.style.height = "auto";
  pendingAttachment = null;
  saveConversations();
  render();
  await requestAssistantReply();
});

function createConversation(title = "Untitled chat", insert = true) {
  const conversation = {
    id: crypto.randomUUID(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };
  if (insert) {
    conversations.unshift(conversation);
  }
  return conversation;
}

function getActiveConversation() {
  return conversations.find((conversation) => conversation.id === activeId) || conversations[0];
}

function loadConversations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveConversations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

function render() {
  renderHistory();
  renderMessages();
  renderAttachment();
}

function renderHistory() {
  const active = getActiveConversation();
  elements.chatTitle.textContent = active.title;
  elements.chatList.innerHTML = "";

  for (const conversation of conversations) {
    const button = document.createElement("button");
    button.className = `chat-item${conversation.id === activeId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <strong>${escapeHtml(conversation.title)}</strong>
      <span class="meta">${conversation.messages.length} messages</span>
    `;
    button.addEventListener("click", () => {
      activeId = conversation.id;
      render();
    });
    elements.chatList.appendChild(button);
  }
}

function renderMessages() {
  const conversation = getActiveConversation();
  elements.messages.innerHTML = "";

  if (!conversation.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <h3>What should ChickenGPT help you build today?</h3>
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
        elements.promptInput.focus();
      });
    }
    return;
  }

  for (const message of conversation.messages) {
    elements.messages.appendChild(createMessageNode(message));
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function suggestionButton(text) {
  return `<button class="suggestion" type="button">${escapeHtml(text)}</button>`;
}

function createMessageNode(message) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;
  const avatar = message.role === "assistant" ? "C" : "You";
  node.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="bubble ${message.error ? "error" : ""}">${formatMessage(message.content)}</div>
  `;
  return node;
}

function renderAttachment() {
  elements.attachmentRow.innerHTML = "";
  if (!pendingAttachment) return;

  const pill = document.createElement("div");
  pill.className = "attachment-pill";
  pill.innerHTML = `<span>${escapeHtml(pendingAttachment.name)}</span><button class="icon-button" type="button" title="Remove attachment">x</button>`;
  pill.querySelector("button").addEventListener("click", () => {
    pendingAttachment = null;
    renderAttachment();
  });
  elements.attachmentRow.appendChild(pill);
}

async function requestAssistantReply() {
  const conversation = getActiveConversation();
  isSending = true;
  elements.sendButton.disabled = true;
  elements.statusLabel.textContent = "Thinking";

  const typingMessage = { role: "assistant", content: "Thinking...", createdAt: Date.now() };
  conversation.messages.push(typingMessage);
  renderMessages();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversation.messages.filter((message) => message !== typingMessage && !message.error),
        settings: readSettings()
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "The AI request failed.");
    }
    typingMessage.content = payload.text;
    elements.statusLabel.textContent = payload.mode === "live" ? `Groq: ${payload.model}` : "Groq offline";
  } catch (error) {
    typingMessage.content = error.message;
    typingMessage.error = true;
    elements.statusLabel.textContent = "Error";
  } finally {
    conversation.updatedAt = Date.now();
    conversations = conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    isSending = false;
    elements.sendButton.disabled = false;
    saveConversations();
    render();
  }
}

function readSettings() {
  const modePrompts = {
    balanced: "Be direct, useful, and thoughtful.",
    builder: "Prioritize implementation details, tradeoffs, and concrete next steps.",
    research: "Be careful with uncertainty, separate facts from assumptions, and cite sources when available.",
    creative: "Offer vivid ideas while keeping the answer practical."
  };

  return {
    mode: elements.modeSelect.value,
    model: elements.modelInput.value.trim() || "llama-3.3-70b-versatile",
    temperature: Number(elements.temperatureInput.value),
    maxTokens: Number(elements.maxTokensInput.value),
    systemPrompt: `${elements.systemPromptInput.value.trim()}\n\nMode guidance: ${modePrompts[elements.modeSelect.value]}`
  };
}

function makeTitle(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 44 ? `${cleaned.slice(0, 44)}...` : cleaned || "Attached file chat";
}

function formatMessage(text) {
  return escapeHtml(text)
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\\/:*?"<>|]/g, "-");
  link.click();
  URL.revokeObjectURL(url);
}
