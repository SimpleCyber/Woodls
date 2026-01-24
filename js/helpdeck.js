/**
 * HelpDeck / Crisp Widget Integration
 */

export function initHelpDeck() {
  window.CRISP_WEBSITE_ID = "ws_1769213927654_lx0uml4db";
  window.CRISP_OWNER_ID = "c77uN9hZnAd7NUCxmcspVJxPapm1";

  // Default user state
  window.HELPDECK_USER = {
    name: "Guest",
    email: "guest@woodls.ai",
    userId: "guest",
  };

  (function () {
    if (document.getElementById("helpdeck-loader")) return;

    var s = document.createElement("script");
    s.id = "helpdeck-loader";
    s.src = "https://help-deck-gamma.vercel.app/widget-loader.js";
    s.async = 1;
    document.head.appendChild(s);
  })();
}

/**
 * Synchronize user data with HelpDeck widget
 * @param {Object|null} user Firebase user object
 */
export function syncHelpDeckUser(user) {
  console.log("[HelpDeck] Syncing user:", user ? user.email : "Guest");

  if (user) {
    // Fallback for name if displayName is missing
    const fallbackName = user.email ? user.email.split("@")[0] : "User";
    window.HELPDECK_USER = {
      name: user.displayName || fallbackName,
      email: user.email,
      userId: user.uid,
    };
  } else {
    window.HELPDECK_USER = {
      name: "Guest",
      email: "guest@woodls.ai",
      userId: "guest",
    };
  }

  // Retry mechanism because Crisp might load slowly
  let retries = 0;
  const maxRetries = 20; // 10 seconds total
  const syncInterval = setInterval(() => {
    if (window.$crisp) {
      try {
        window.$crisp.push(["set", "user:email", [window.HELPDECK_USER.email]]);
        window.$crisp.push([
          "set",
          "user:nickname",
          [window.HELPDECK_USER.name],
        ]);
        console.log("[HelpDeck] Applied to Crisp:", window.HELPDECK_USER.email);
        clearInterval(syncInterval);
      } catch (e) {
        console.warn("[HelpDeck] Crisp push failed:", e);
        clearInterval(syncInterval);
      }
    } else {
      retries++;
      if (retries >= maxRetries) {
        console.warn("[HelpDeck] Crisp not found after max retries.");
        clearInterval(syncInterval);
      }
    }
  }, 500);
}
