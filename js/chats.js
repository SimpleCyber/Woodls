// js/chats.js
import { $ } from "./utils.js";

let allSessions = {};

export function initChats() {
  const refreshBtn = document.getElementById("refresh-chats-btn");
  const container = document.getElementById("chat-history-container");
  const sidebarItem = document.querySelector('[data-page="chats"]');
  const detailView = document.getElementById("chat-detail-view");
  const detailBack = document.getElementById("chat-detail-back");
  const detailMessages = document.getElementById("chat-detail-messages");
  const detailTitle = document.getElementById("chat-detail-title");
  const detailMeta = document.getElementById("chat-detail-meta");
  const header = document.querySelector(
    "#chats .flex.justify-between.items-center.mb-8",
  );

  if (refreshBtn) refreshBtn.addEventListener("click", () => loadChats());
  if (sidebarItem) {
    sidebarItem.addEventListener("click", () => {
      backToList();
      loadChats();
    });
  }

  if (detailBack) {
    detailBack.onclick = backToList;
  }

  function backToList() {
    if (detailView) detailView.classList.add("hidden");
    if (container) container.classList.remove("hidden");
    if (header) header.classList.remove("hidden");
  }

  async function loadChats() {
    if (!container) return;
    container.innerHTML =
      '<div class="col-span-full text-center text-slate-400 py-20 italic">Loading chats...</div>';

    try {
      const history = await window.api.getChatHistory();
      if (!history || history.length === 0) {
        container.innerHTML =
          '<div class="col-span-full text-center text-slate-400 py-20 italic">No chats found. Start a conversation in the overlay!</div>';
        return;
      }
      // Group by sessionId
      const sessions = {};
      history.forEach((item) => {
        const sid = item.sessionId || "legacy";
        if (!sessions[sid]) {
          sessions[sid] = {
            id: sid,
            title: item.sessionTitle || item.query,
            timestamp: item.timestamp,
            messages: [],
            screenshot: item.screenshot,
          };
        }
        sessions[sid].messages.push(item);
        if (item.screenshot) sessions[sid].screenshot = item.screenshot;
        if (item.timestamp > sessions[sid].timestamp)
          sessions[sid].timestamp = item.timestamp;
      });

      allSessions = sessions;

      const sessionList = Object.values(sessions).sort(
        (a, b) => b.timestamp - a.timestamp,
      );

      container.innerHTML = sessionList
        .map((session) => {
          const dateStr = new Date(session.timestamp).toLocaleDateString();
          const timeStr = new Date(session.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          const lastResponse =
            session.messages[session.messages.length - 1].response;

          return `
          <div class="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 cursor-pointer transition-all border border-transparent hover:border-slate-100 group" onclick="window.viewChatDetail('${session.id}')">
            <div class="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 group-hover:bg-primary-50 transition-colors">
              ${
                session.screenshot
                  ? `<img src="woodls-screenshot://${session.screenshot}" class="w-full h-full object-cover rounded-lg">`
                  : `<i class="fa-solid fa-comment-dots text-slate-400 group-hover:text-primary-500"></i>`
              }
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-baseline mb-0.5">
                <h4 class="font-semibold text-slate-900 truncate text-sm">${session.title}</h4>
                <span class="text-[10px] text-slate-400 font-medium ml-2">${dateStr} ${timeStr}</span>
              </div>
              <p class="text-xs text-slate-500 truncate leading-relaxed">
                ${lastResponse}
              </p>
            </div>
            <i class="fa-solid fa-chevron-right text-[10px] text-slate-300 group-hover:text-primary-500 translate-x-0 group-hover:translate-x-1 transition-all"></i>
          </div>
        `;
        })
        .join("");
    } catch (e) {
      console.error("Failed to load chats:", e);
      container.innerHTML =
        '<div class="col-span-full text-center text-red-400 py-20 italic">Failed to load chat history.</div>';
    }
  }

  // Exposed globally for onclick
  window.viewChatDetail = (sessionId) => {
    const session = allSessions[sessionId];
    if (!session) return;

    if (container) container.classList.add("hidden");
    if (header) header.classList.add("hidden");
    if (detailView) detailView.classList.remove("hidden");

    if (detailTitle) detailTitle.textContent = session.title;
    if (detailMeta) {
      const dateStr = new Date(session.timestamp).toLocaleDateString();
      const timeStr = new Date(session.timestamp).toLocaleTimeString();
      detailMeta.textContent = `${dateStr} at ${timeStr} ΓÇó ${session.messages.length} messages`;
    }

    if (detailMessages) {
      // Initialize Marked Options (if not already set globally)
      if (window.marked) {
        window.marked.setOptions({
          breaks: true,
          gfm: true,
          highlight: function (code, lang) {
            const language =
              window.hljs && window.hljs.getLanguage(lang) ? lang : "plaintext";
            return window.hljs
              ? window.hljs.highlight(code, { language }).value
              : code;
          },
        });
      }

      detailMessages.innerHTML = session.messages
        .map(
          (msg) => `
        <div class="flex flex-col gap-2">
          <div class="flex flex-col items-end">
            <div class="bg-primary-50 text-slate-800 p-3 rounded-2xl rounded-tr-none max-w-[85%] text-sm shadow-sm border border-primary-100">
              ${msg.query}
            </div>
          </div>
          <div class="flex flex-col items-start">
            <div class="bg-white text-slate-700 p-3 rounded-2xl rounded-tl-none max-w-[90%] text-sm shadow-sm border border-slate-100 leading-relaxed markdown-body">
              ${window.marked ? window.marked.parse(msg.response) : msg.response.replace(/\n/g, "<br>")}
            </div>
          </div>
          ${
            msg.screenshot
              ? `
            <div class="mt-2 rounded-lg overflow-hidden border border-slate-200 max-w-[200px]">
              <img src="woodls-screenshot://${msg.screenshot}" class="w-full h-auto">
            </div>
          `
              : ""
          }
        </div>
      `,
        )
        .join('<div class="h-px bg-slate-100 my-2"></div>');

      // Apply highlighting after render
      if (window.hljs) {
        detailMessages.querySelectorAll("pre code").forEach((block) => {
          window.hljs.highlightElement(block);
        });
      }

      detailMessages.scrollTop = 0;
    }
  };

  // Initial load if visible
  if (
    document.getElementById("chats") &&
    !document.getElementById("chats").classList.contains("hidden")
  ) {
    loadChats();
  }
}
