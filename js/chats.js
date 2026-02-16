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
          const dateStr = new Date(session.timestamp).toLocaleString();
          const lastResponse =
            session.messages[session.messages.length - 1].response;

          return `
          <div class="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all group flex flex-col h-full cursor-pointer" onclick="window.api.showOverlay(true)">
            <div class="aspect-video bg-slate-100 relative overflow-hidden group-hover:opacity-90 transition-opacity">
              ${
                session.screenshot
                  ? `<img src="woodls-screenshot://${session.screenshot}" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/600x400?text=No+Screenshot'">`
                  : `<div class="w-full h-full flex items-center justify-center text-slate-300 italic text-xs">No screenshot</div>`
              }
              <div class="absolute top-3 right-3 bg-black/50 backdrop-blur-md text-white px-2 py-1 rounded-md text-[10px] font-bold">
                ${new Date(session.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <div class="p-5 flex-1 flex flex-col">
              <div class="flex items-center gap-2 mb-3">
                <div class="w-2 h-2 rounded-full bg-primary-500"></div>
                <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${dateStr}</span>
              </div>
              <h4 class="font-bold text-slate-900 mb-2 line-clamp-2 leading-snug">${session.title}</h4>
              <p class="text-sm text-slate-500 line-clamp-4 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 italic">
                ${lastResponse}
              </p>
            </div>
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
