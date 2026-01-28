import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

// Firebase Configuration via Environment Variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize only if keys are present (prevents crash during build if env missing)
let app, auth, provider;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  provider = new GoogleAuthProvider();
} catch (e) {
  console.error("Firebase Initialization Error:", e);
}

const statusMsg = document.getElementById("status-msg");
const googleBtn = document.getElementById("google-signin-btn");

if (googleBtn) {
  googleBtn.addEventListener("click", async () => {
    try {
      if (!auth) throw new Error("Firebase config missing");

      statusMsg.textContent = "Connecting to Google...";
      googleBtn.disabled = true;
      googleBtn.classList.add("opacity-50", "cursor-not-allowed");

      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const token = await user.getIdToken();

      statusMsg.textContent = "Success! Redirecting to app...";
      statusMsg.classList.add("text-green-600");
      statusMsg.classList.remove("text-slate-400");

      // Redirect to the custom protocol
      setTimeout(() => {
        window.location.href = `woodls://auth?idToken=${token}`;

        // Re-enable button after a few seconds
        setTimeout(() => {
          googleBtn.disabled = false;
          googleBtn.classList.remove("opacity-50", "cursor-not-allowed");
          statusMsg.textContent =
            "If the app didn't open, click sign in again.";
          statusMsg.classList.remove("text-green-600");
          statusMsg.classList.add("text-slate-400");
        }, 3000);
      }, 1000);
    } catch (error) {
      console.error(error);
      statusMsg.textContent = "Error: " + error.message;
      statusMsg.classList.add("text-red-500");
      statusMsg.classList.remove("text-slate-400");
      googleBtn.disabled = false;
      googleBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
  });
}
