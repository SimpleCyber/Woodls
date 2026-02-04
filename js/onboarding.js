import { initAuth, login, signup, logout, signInWithGoogle } from "./auth.js";
import { addLog, showError } from "./utils.js";

let isRecording = false;
let onboardingStep = 0; // 0=Intro, 1=Hotkey, 2=Test, 3=Review
let userHotkey = null;

// DOM Elements for Onboarding
let modal, contentArea;

export function initOnboarding() {
  setupAuthForms();
  setupGoogleAuth();

  // Check if we need to run onboarding (using localStorage as simple flag)
  const hasCompletedOnboarding = localStorage.getItem(
    "hasCompletedOnboarding_v2",
  );

  // Wait for App to be ready
  setTimeout(() => {
    if (!hasCompletedOnboarding) {
      startOnboarding();
    }
  }, 1000);
}

export function startOnboarding() {
  modal = document.getElementById("onboarding-modal");
  if (!modal) return;

  modal.classList.remove("hidden");
  renderStep(0);
}

function renderStep(step) {
  onboardingStep = step;
  modal.innerHTML = ""; // clear

  let html = "";

  switch (step) {
    case 0: // Intro
      html = `
                <div class="flex-1 flex flex-col items-center justify-center p-10 text-center animate-in zoom-in-95 duration-300">
                    <div class="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center text-white text-3xl mb-6 shadow-xl">
                        <i class="fa-solid fa-hand-sparkles"></i>
                    </div>
                    <h2 class="text-3xl font-bold text-slate-800 mb-4">Welcome to Woodls</h2>
                    <p class="text-slate-500 max-w-md text-lg leading-relaxed mb-10">
                        Let's get you set up in less than a minute. We'll configure your hotkey and test your microphone.
                    </p>
                    <button id="ob-next-btn" class="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg transform active:scale-95">
                        Get Started <i class="fa-solid fa-arrow-right ml-2"></i>
                    </button>
                </div>
            `;
      break;

    case 1: // Hotkey
      html = `
                <div class="flex-1 flex flex-col items-center justify-center p-10 text-center animate-in slide-in-from-right-8 duration-300">
                    <h2 class="text-2xl font-bold text-slate-800 mb-2">Set your Activation Key</h2>
                    <p class="text-slate-500 mb-8">Choose a single key to hold down for dictation.</p>
                    
                    <div id="ob-capture-area" class="w-full max-w-sm h-32 bg-white border-2 border-slate-200 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-primary-500 hover:bg-primary-50/30 transition-all group shadow-sm">
                         <div class="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                            <i class="fa-regular fa-keyboard text-slate-400 group-hover:text-primary-500"></i>
                         </div>
                         <span class="text-slate-600 font-medium group-hover:text-primary-600 transition-colors">Click to Set Hotkey</span>
                         <span id="ob-hotkey-display" class="text-3xl font-bold text-slate-800 mt-2 hidden"></span>
                    </div>
                    
                    <p class="text-xs text-slate-400 mt-4 h-5" id="ob-error-msg"></p>
                    
                    <div class="mt-4">
                        <button id="ob-next-btn" class="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg opacity-50 cursor-not-allowed" disabled>
                            Continue <i class="fa-solid fa-arrow-right ml-2"></i>
                        </button>
                    </div>
                </div>
            `;
      break;

    case 2: // Test Drive
      html = `
                <div class="flex-1 flex flex-col items-center justify-center p-10 text-center animate-in slide-in-from-right-8 duration-300">
                    <h2 class="text-2xl font-bold text-slate-800 mb-2">Let's test it out</h2>
                    <p class="text-slate-500 mb-6">Hold / Doubble press <span class="font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-900 mx-1 border border-slate-200">${
                      userHotkey || "Hotkey"
                    }</span> to dictate.</p>
                    
                    <!-- Recording Status -->
                    <div id="ob-rec-status" class="h-6 mb-4 text-sm font-bold text-red-500 opacity-0 transition-opacity flex items-center justify-center gap-2">
                        <div class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                        Recording...
                    </div>

                    <div class="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden flex flex-col relative">
                        <div class="bg-slate-50 px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                             <div class="w-3 h-3 rounded-full bg-red-400"></div>
                             <div class="w-3 h-3 rounded-full bg-yellow-400"></div>
                             <div class="w-3 h-3 rounded-full bg-green-400"></div>
                             <div class="ml-auto text-xs font-mono text-slate-400">Untitled.txt</div>
                        </div>
                        <div id="ob-test-area" class="h-32 p-5 text-left text-slate-700 font-medium whitespace-pre-wrap outline-none bg-white transition-colors">
                            <span class="text-slate-300 italic">Dictated text will appear here...</span>
                        </div>
                    </div>
                    
                    <div class="mt-8">
                         <button id="ob-next-btn" class="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg">
                            Looks Good <i class="fa-solid fa-check ml-2"></i>
                        </button>
                    </div>
                </div>
            `;
      break;

    case 3: // Review
      // Get current defaults (assuming defaults)
      const isPaste = true;
      const isStartup = true;
      const isHidden = true;
      const isAI = false;

      const toggleItem = (id, label, sub, checked) => `
        <div class="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
            <div>
                <h4 class="font-bold text-slate-700 text-sm">${label}</h4>
                <p class="text-xs text-slate-400">${sub}</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="${id}" class="sr-only peer" ${checked ? "checked" : ""}>
                <div class="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                <span class="ml-2 text-xs font-bold w-6 ${checked ? "text-green-600" : "text-slate-400"}" id="${id}-label">${checked ? "ON" : "OFF"}</span>
            </label>
        </div>`;

      html = `
                <div class="flex-1 flex flex-col items-center justify-center p-10 text-center animate-in slide-in-from-right-8 duration-300">
                     <h2 class="text-2xl font-bold text-slate-800 mb-2">Quick Settings</h2>
                     <p class="text-slate-500 mb-8">Customize your experience.</p>
                     
                     <div class="w-full max-w-md grid grid-cols-1 gap-3 text-left">
                        ${toggleItem("ob-paste", "Paste Automatically", "Insert text immediately", isPaste)}
                        ${toggleItem("ob-startup", "Run on Startup", "Ready when you login", isStartup)}
                        ${toggleItem("ob-hidden", "Start Hidden", "Launch silently in tray", isHidden)}
                        ${toggleItem("ob-ai", "AI Enhancement", "Refine text with AI", isAI)}
                     </div>
                     
                     <div class="mt-8">
                         <button id="ob-finish-btn" class="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/30">
                            Finish Setup <i class="fa-solid fa-rocket ml-2"></i>
                        </button>
                    </div>
                </div>
            `;
      break;
  }

  modal.innerHTML = html;

  // Attach Listeners
  const nextBtn = document.getElementById("ob-next-btn");
  if (nextBtn) nextBtn.onclick = () => renderStep(step + 1);

  const finishBtn = document.getElementById("ob-finish-btn");
  if (finishBtn) finishBtn.onclick = completeOnboarding;

  if (step === 1) setupHotkeyCapture();
  if (step === 2) setupDictationTest();
  if (step === 3) setupSettingsReview();
}

function setupHotkeyCapture() {
  const area = document.getElementById("ob-capture-area");
  const display = document.getElementById("ob-hotkey-display");
  const errorMsg = document.getElementById("ob-error-msg");
  const nextBtn = document.getElementById("ob-next-btn");
  const span = area.querySelector("span");

  let listening = false;

  area.onclick = () => {
    listening = true;
    area.classList.add("border-blue-500", "bg-blue-50");
    area.classList.remove("border-slate-200");
    span.textContent = "Listening... Press a key";
    display.classList.add("hidden");
  };

  // Listen for keydown globally on window when listening
  const handler = (e) => {
    if (!listening) return;
    e.preventDefault();

    // Basic validation
    // Enhanced Key Capture
    const rawKey = e.key.toUpperCase();
    let displayKey = rawKey;
    let backendKey = rawKey;

    // Handle Numpad
    if (e.location === 3) {
      displayKey = `Numpad ${e.key}`; // e.g., "Numpad 5"
      backendKey = `NUMPAD${e.key.toUpperCase()}`; // e.g., "NUMPAD5" (standardized for listener)
    }

    // Handle Special Cases
    if (e.code === "Space") {
      displayKey = "Space";
      backendKey = "SPACE";
    }

    userHotkey = backendKey;

    // Show success
    display.textContent = displayKey;
    display.classList.remove("hidden");
    span.textContent = "Active Hotkey";

    area.classList.remove("border-blue-500", "bg-blue-50");
    area.classList.add("border-green-500", "bg-green-50");

    // Enable Next
    nextBtn.disabled = false;
    nextBtn.classList.remove("opacity-50", "cursor-not-allowed");
    nextBtn.classList.add("bg-slate-900", "hover:bg-slate-800");

    // Actually save it to the app
    // We'll simulate the "Save" button click from the main UI seamlessly
    // OR direct IPC if possible. Direct IPC is cleaner.
    if (window.api && window.api.saveHotkey) {
      window.api.saveHotkey([userHotkey]);
    }

    listening = false;
    window.removeEventListener("keydown", handler);
  };

  window.addEventListener("keydown", handler);

  function resetUI() {
    area.classList.remove("border-blue-500", "bg-blue-50");
    area.classList.add("border-slate-200");
    span.textContent = "Click here & Press any key";
  }
}

function setupDictationTest() {
  const testArea = document.getElementById("ob-test-area");
  const recStatus = document.getElementById("ob-rec-status");

  // Show "Recording..." state
  window.api.onRecordStart(() => {
    if (onboardingStep === 2 && recStatus) {
      recStatus.classList.remove("opacity-0");
      recStatus.innerHTML =
        '<div class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div> Recording...';
      recStatus.className =
        "h-6 mb-4 text-sm font-bold text-red-500 transition-opacity flex items-center justify-center gap-2";
    }
  });

  // Show "Processing..." state
  window.api.onRecordStop(() => {
    if (onboardingStep === 2 && recStatus) {
      recStatus.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
      recStatus.className =
        "h-6 mb-4 text-sm font-bold text-blue-500 transition-opacity flex items-center justify-center gap-2";
    }
  });

  // Handle Result from custom event in app.js
  document.addEventListener(
    "woodls-transcription",
    (e) => {
      if (onboardingStep === 2 && testArea) {
        const text = e.detail.text;
        testArea.innerHTML = text;
        testArea.classList.add("text-slate-800");
        testArea.classList.remove("text-slate-300", "italic");

        // Hide status
        if (recStatus) recStatus.classList.add("opacity-0");
      }
    },
    { once: true },
  ); // Only need one successful test? Or generic listener?
  // Let's make it generic but check step.
}

function setupSettingsReview() {
  const checkboxes = ["ob-paste", "ob-startup", "ob-hidden", "ob-ai"];

  checkboxes.forEach((id) => {
    const el = document.getElementById(id);
    const label = document.getElementById(id + "-label");
    if (!el) return;

    el.onchange = () => {
      const isChecked = el.checked;
      label.textContent = isChecked ? "ON" : "OFF";
      label.className =
        "ml-2 text-xs font-bold w-6 " +
        (isChecked ? "text-green-600" : "text-slate-400");

      // Handle Saving
      if (id === "ob-paste") window.api.saveSetting("instantPaste", isChecked);
      if (id === "ob-ai") window.api.saveSetting("aiEnhanced", isChecked);

      // Startup settings need special handling
      if (id === "ob-startup" || id === "ob-hidden") {
        const runOnStartup = document.getElementById("ob-startup").checked;
        const startHidden = document.getElementById("ob-hidden").checked;
        window.api.setStartupSettings({
          openAtLogin: runOnStartup,
          startHidden: startHidden,
        });
      }
    };
  });
}

function completeOnboarding() {
  localStorage.setItem("hasCompletedOnboarding_v2", "true");

  // Animate out
  modal.classList.add("animate-out", "fade-out", "duration-500");
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 500);
}

function setupGoogleAuth() {
  const googleBtn = document.getElementById("google-signin-btn");
  if (googleBtn) {
    googleBtn.onclick = async () => {
      const originalText = googleBtn.innerHTML;
      try {
        googleBtn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';
        googleBtn.disabled = true;
        const res = await signInWithGoogle();
        if (!res.success) {
          showError("Google Sign-In Failed", res.error);
          googleBtn.innerHTML = originalText;
          googleBtn.disabled = false;
        }
        // Success is handled by onAuthStateChanged which hides the whole page
      } catch (err) {
        showError("Google Sign-In Error", err.message);
        googleBtn.innerHTML = originalText;
        googleBtn.disabled = false;
      }
    };
  }
}

function setupAuthForms() {
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const toSignupBtn = document.getElementById("to-signup-btn");
  const toLoginBtn = document.getElementById("to-login-btn");

  if (toSignupBtn) {
    toSignupBtn.onclick = (e) => {
      e.preventDefault();
      loginForm.classList.add("hidden");
      signupForm.classList.remove("hidden");
    };
  }

  if (toLoginBtn) {
    toLoginBtn.onclick = (e) => {
      e.preventDefault();
      signupForm.classList.add("hidden");
      loginForm.classList.remove("hidden");
    };
  }

  // Handle Login
  document
    .getElementById("sign-in-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("login-email").value;
      const pass = document.getElementById("login-password").value;

      if (!email || !pass) return alert("Please fill in all fields");

      const btn = e.target.querySelector("button[type='submit']");
      const originalText = btn.textContent;
      btn.textContent = "Signing in...";
      btn.disabled = true;

      const res = await login(email, pass);

      if (!res.success) {
        alert(res.error);
        btn.textContent = originalText;
        btn.disabled = false;
      } else {
        // Success handled by onAuthStateChanged in app.js
      }
    });

  // Handle Signup
  document
    .getElementById("sign-up-form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = document.getElementById("signup-name").value;
      const email = document.getElementById("signup-email").value;
      const pass = document.getElementById("signup-password").value;

      if (!email || !pass) return alert("Please fill in all fields");

      const btn = e.target.querySelector("button[type='submit']");
      const originalText = btn.textContent;
      btn.textContent = "Creating Account...";
      btn.disabled = true;

      const res = await signup(email, pass, name);

      if (!res.success) {
        alert(res.error);
        btn.textContent = originalText;
        btn.disabled = false;
      } else {
        // Success handled by onAuthStateChanged in app.js
      }
    });
}
