// js/chats.js
import { $ } from "./utils.js";

export function initChats() {
  const refreshBtn = document.getElementById("refresh-chats-btn");
  const container = document.getElementById("chat-history-container");
  const sidebarItem = document.querySelector('[data-page="chats"]');

  if (refreshBtn) refreshBtn.onclick = () => loadChats();
  if (sidebarItem) sidebarItem.onclick = () => loadChats();

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
        // Keep the latest screenshot
        if (item.screenshot) sessions[sid].screenshot = item.screenshot;
        // Keep the latest timestamp
        if (item.timestamp > sessions[sid].timestamp)
          sessions[sid].timestamp = item.timestamp;
      });

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
          <div class="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-50 cursor-pointer transition-all border border-transparent hover:border-slate-100 group" onclick="window.api.showOverlay(true)">
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

  // Initial load if visible
  if (
    document.getElementById("chats") &&
    !document.getElementById("chats").classList.contains("hidden")
  ) {
    loadChats();
  }
}
