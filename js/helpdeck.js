/**
 * HelpDeck / Crisp Widget Integration
 * simplified as per user request
 */

export function initHelpDeck() {
  // Constants setup can happen here or when syncing
  window.CRISP_WEBSITE_ID = "ws_1769213927654_lx0uml4db";
  window.CRISP_OWNER_ID = "c77uN9hZnAd7NUCxmcspVJxPapm1";
}

/**
 * Synchronize user data with HelpDeck widget
 * @param {Object|null} user Firebase user object
 */
export function syncHelpDeckUser(user) {
  if (!user) {
    // If no data is passed, do not pass it through.
    return;
  }

  // Log the data locally as requested
  console.log("HelpDeck User Data:", {
    name: user.displayName,
    email: user.email,
    userId: user.uid,
  });

  // Pass dynamic information
  window.HELPDECK_USER = {
    name: user.displayName || user.email.split("@")[0],
    email: user.email,
    userId: user.uid,
  };

  // Inject the script only if data is passed and script is not already there
  if (!document.getElementById("helpdeck-loader")) {
    (function () {
      var s = document.createElement("script");
      s.id = "helpdeck-loader";
      s.src = "https://help-deck-gamma.vercel.app/widget-loader.js";
      s.async = 1;
      document.head.appendChild(s);
    })();
  }
}
