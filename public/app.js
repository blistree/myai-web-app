document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const chatForm = document.getElementById("chat-form");
  const promptInput = document.getElementById("prompt-input");
  const sendBtn = document.getElementById("send-btn");
  const messagesContainer = document.getElementById("messages-container");
  const messagesList = document.getElementById("messages-list");
  const welcomeScreen = document.getElementById("welcome-screen");
  const chatList = document.getElementById("chat-list");
  const newChatBtn = document.getElementById("new-chat-btn");
  const themeToggle = document.getElementById("theme-toggle");
  const menuBtn = document.getElementById("menu-btn");
  const sidebar = document.getElementById("sidebar");
  const sidebarOverlay = document.getElementById("sidebar-overlay");
  const promptCards = document.querySelectorAll(".prompt-card");

  // State
  let activeChatId = null;
  let conversationHistory = [];
  let isGenerating = false;

  // Initialize Markdown configuration
  if (window.marked) {
    marked.setOptions({
      highlight: function (code, lang) {
        if (window.hljs && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return code;
      },
      breaks: true,
      gfm: true
    });
  }

  // Load Theme
  const savedTheme = localStorage.getItem("myai_theme") || "dark";
  if (savedTheme === "light") {
    document.body.classList.remove("dark-theme");
    document.body.classList.add("light-theme");
  }

  themeToggle.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark-theme");
    if (isDark) {
      document.body.classList.remove("dark-theme");
      document.body.classList.add("light-theme");
      localStorage.setItem("myai_theme", "light");
    } else {
      document.body.classList.remove("light-theme");
      document.body.classList.add("dark-theme");
      localStorage.setItem("myai_theme", "dark");
    }
  });

  // Mobile Sidebar Toggle
  menuBtn.addEventListener("click", () => {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("active");
  });

  sidebarOverlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("active");
  });

  // Textarea auto-resize
  promptInput.addEventListener("input", () => {
    promptInput.style.height = "auto";
    promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + "px";
  });

  // Enter to send
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && promptInput.value.trim().length > 0) {
        chatForm.dispatchEvent(new Event("submit"));
      }
    }
  });

  // Prompt Cards quick start
  promptCards.forEach(card => {
    card.addEventListener("click", () => {
      const prompt = card.getAttribute("data-prompt");
      if (prompt) {
        promptInput.value = prompt;
        promptInput.style.height = "auto";
        promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + "px";
        chatForm.dispatchEvent(new Event("submit"));
      }
    });
  });

  // New Chat Click
  newChatBtn.addEventListener("click", () => {
    startNewChat();
  });

  function startNewChat() {
    activeChatId = null;
    conversationHistory = [];
    messagesList.innerHTML = "";
    welcomeScreen.style.display = "flex";
    promptInput.value = "";
    promptInput.style.height = "auto";
    document.querySelectorAll(".chat-list-item").forEach(item => item.classList.remove("active"));
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("active");
  }

  // Load Chats from Backend
  async function loadChats() {
    try {
      const res = await fetch("/api/chats");
      if (!res.ok) return;
      const data = await res.json();
      renderChatList(data.chats || []);
    } catch (err) {
      console.warn("Could not load previous chats:", err);
    }
  }

  function renderChatList(chats) {
    if (chats.length === 0) {
      chatList.innerHTML = `<div class="chat-list-empty">No conversations yet</div>`;
      return;
    }

    chatList.innerHTML = "";
    chats.forEach(chat => {
      const item = document.createElement("div");
      item.className = `chat-list-item ${chat.id === activeChatId ? "active" : ""}`;
      item.innerHTML = `
        <span class="chat-title">${escapeHtml(chat.title || "New Chat")}</span>
        <button class="delete-chat-btn" title="Delete conversation" data-id="${chat.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;

      item.querySelector(".chat-title").addEventListener("click", () => {
        loadChatMessages(chat.id);
        sidebar.classList.remove("open");
        sidebarOverlay.classList.remove("active");
      });

      item.querySelector(".delete-chat-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteChat(chat.id);
      });

      chatList.appendChild(item);
    });
  }

  async function loadChatMessages(chatId) {
    try {
      const res = await fetch(`/api/chats/${chatId}`);
      if (!res.ok) return;
      const data = await res.json();

      activeChatId = chatId;
      conversationHistory = data.messages || [];
      welcomeScreen.style.display = "none";
      messagesList.innerHTML = "";

      conversationHistory.forEach(msg => {
        appendMessage(msg.role, msg.content, false);
      });

      scrollToBottom();
      document.querySelectorAll(".chat-list-item").forEach(item => {
        const delBtn = item.querySelector(".delete-chat-btn");
        if (delBtn && delBtn.getAttribute("data-id") === chatId) {
          item.classList.add("active");
        } else {
          item.classList.remove("active");
        }
      });
    } catch (err) {
      console.error("Failed to load conversation:", err);
    }
  }

  async function deleteChat(chatId) {
    try {
      await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
      if (activeChatId === chatId) {
        startNewChat();
      }
      loadChats();
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  }

  // Handle Form Submission
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = promptInput.value.trim();
    if (!prompt || isGenerating) return;

    // Reset input
    promptInput.value = "";
    promptInput.style.height = "auto";
    sendBtn.disabled = true;
    isGenerating = true;

    // Hide welcome screen
    welcomeScreen.style.display = "none";

    // Append User Message
    appendMessage("user", prompt, true);
    conversationHistory.push({ role: "user", content: prompt });

    // Show Typing Indicator
    const typingIndicatorRow = showTypingIndicator();
    scrollToBottom();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt,
          chatId: activeChatId,
          history: conversationHistory
        })
      });

      typingIndicatorRow.remove();

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Server response failed");
      }

      const data = await response.json();
      const reply = data.reply || "No response received.";

      // Update active Chat ID
      if (!activeChatId && data.chatId) {
        activeChatId = data.chatId;
        loadChats();
      }

      // Append Assistant Message
      appendMessage("assistant", reply, true);
      conversationHistory.push({ role: "assistant", content: reply });
      scrollToBottom();
    } catch (error) {
      typingIndicatorRow.remove();
      appendMessage("assistant", `⚠️ **Error**: ${error.message}\n\nPlease check your Google Cloud connection or try again shortly.`, false);
      scrollToBottom();
    } finally {
      sendBtn.disabled = false;
      isGenerating = false;
      promptInput.focus();
    }
  });

  function appendMessage(role, content, animate = false) {
    const row = document.createElement("div");
    row.className = `message-row ${role === "user" ? "user" : "ai"}`;

    const avatar = document.createElement("div");
    avatar.className = `avatar ${role === "user" ? "user-avatar" : "ai-avatar"}`;
    avatar.textContent = role === "user" ? "U" : "🇮🇳";

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (role === "user") {
      bubble.textContent = content;
    } else {
      bubble.innerHTML = window.marked ? marked.parse(content) : escapeHtml(content);
      if (window.hljs) {
        bubble.querySelectorAll("pre code").forEach(block => {
          hljs.highlightElement(block);
        });
      }
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesList.appendChild(row);
    return row;
  }

  function showTypingIndicator() {
    const row = document.createElement("div");
    row.className = "message-row ai";

    const avatar = document.createElement("div");
    avatar.className = "avatar ai-avatar";
    avatar.textContent = "🇮🇳";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = `
      <div class="typing-indicator">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    `;

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesList.appendChild(row);
    return row;
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async function checkServerStatus() {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return;
      const data = await res.json();
      const pill = document.getElementById("active-model-pill");
      if (pill && data.ethics) {
        pill.textContent = `${data.ethics.badge}`;
      }
      const statusText = document.querySelector(".status-text");
      if (statusText && data.selfHostedVm) {
        const vmState = data.selfHostedVm.status === "CONNECTED_AND_ACTIVE" ? "Mumbai VM Active" : "Standby";
        statusText.textContent = `Server: ${vmState} • Step ${data.ethics?.step ?? 0}`;
      }
    } catch (err) {
      console.warn("Could not check server status:", err);
    }
  }

  // Initial Load
  loadChats();
  checkServerStatus();
});
