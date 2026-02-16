async function loadChats() {
  const sidebarList = document.getElementById("chat-sidebar-list");
  if (!sidebarList) return;

  try {
    const history = await window.api.getChatHistory();
    if (!history || history.length === 0) {
      sidebarList.innerHTML =
        '<div class="text-center text-slate-400 py-10 italic">No chats.</div>';
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
      if (item.screenshot && !sessions[sid].screenshot)
        sessions[sid].screenshot = item.screenshot;
      if (item.timestamp > sessions[sid].timestamp)
        sessions[sid].timestamp = item.timestamp;
    });

    const sortedSessions = Object.values(sessions).sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    sidebarList.innerHTML = sortedSessions
      .map((session) => {
        const dateStr = new Date(session.timestamp).toLocaleDateString();
        return `
          <div class="chat-session-item p-4 rounded-xl border border-slate-100 hover:bg-slate-50 cursor-pointer transition-all mb-2 group relative" 
               onclick="window.displaySession('${session.id}')">
            <div class="flex items-center gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${dateStr}</span>
                  <button class="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-opacity" 
                          onclick="event.stopPropagation(); window.deleteSession('${session.id}')">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                  </button>
                </div>
                <h4 class="font-bold text-slate-900 text-sm truncate">${session.title}</h4>
                <p class="text-xs text-slate-500 line-clamp-1 mt-1">${session.messages[0].response}</p>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  } catch (e) {
    console.error("Failed to load chats:", e);
  }
}

window.displaySession = async (sid) => {
  const detailView = document.getElementById("chats-detail");
  if (!detailView) return;

  // Set active style in sidebar
  document.querySelectorAll(".chat-session-item").forEach((item) => {
    const onClickAttr = item.getAttribute("onclick") || "";
    item.classList.toggle("active", onClickAttr.includes(`'${sid}'`));
  });

  const history = await window.api.getChatHistory();
  const sessionMessages = history.filter(
    (m) => (m.sessionId || "legacy") === sid,
  );

  if (sessionMessages.length === 0) return;

  const session = {
    id: sid,
    title: sessionMessages[0].sessionTitle || sessionMessages[0].query,
    timestamp: sessionMessages[0].timestamp,
    messages: [...sessionMessages].reverse(), // Show chronological
  };

  detailView.innerHTML = `
    <div class="flex flex-col h-full">
      <div class="p-6 border-b border-slate-100 flex items-center justify-between bg-white/50 backdrop-blur-md sticky top-0 z-10">
        <div>
          <h2 class="text-xl font-bold text-slate-900">${session.title}</h2>
          <p class="text-xs text-slate-400 mt-1">${new Date(session.timestamp).toLocaleString()}</p>
        </div>
        <button class="px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors flex items-center gap-2"
                onclick="window.api.showOverlay(true)">
           <i class="fa-solid fa-plus"></i> Continue Chat
        </button>
      </div>
      <div class="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30">
        ${session.messages
          .map(
            (m) => `
          <div class="space-y-4">
            <div class="flex justify-end">
              <div class="message-bubble max-w-[80%] bg-blue-600 text-white p-4 rounded-2xl rounded-tr-sm shadow-sm text-sm">
                ${m.query}
                ${
                  m.screenshot
                    ? `
                  <div class="mt-3 rounded-lg overflow-hidden border border-white/20">
                    <img src="woodls-screenshot://${m.screenshot}" class="w-full max-h-64 object-cover">
                  </div>`
                    : ""
                }
              </div>
            </div>
            <div class="flex justify-start">
              <div class="message-bubble max-w-[80%] bg-white border border-slate-100 p-4 rounded-2xl rounded-tl-sm shadow-sm text-sm text-slate-700 leading-relaxed">
                ${m.response}
              </div>
            </div>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
};

window.deleteSession = async (sid) => {
  if (confirm("Are you sure you want to delete this conversation?")) {
    try {
      const success = await window.api.deleteChatSession(sid);
      if (success) {
        loadChats();
        document.getElementById("chats-detail").innerHTML = `
          <div class="h-full flex flex-col items-center justify-center text-slate-300 p-10 text-center">
            <i class="fa-solid fa-comments text-5xl mb-4 opacity-20"></i>
            <p class="italic">Conversation deleted.</p>
          </div>
        `;
      }
    } catch (e) {
      console.error("Deletion failed:", e);
      alert("Failed to delete conversation.");
    }
  }
};

function initChats() {
  const tabBtn = document.querySelector('[data-page="chats"]');
  if (tabBtn) {
    tabBtn.addEventListener("click", loadChats);
  }
}

// Ensure it loads if the page is already open
initChats();
loadChats();
