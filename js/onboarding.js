import { initAuth, login, signup, logout, signInWithGoogle } from './auth.js';
import { addLog, showError } from './utils.js';

let isRecording = false;

export function initOnboarding() {
    setupAuthForms();
    setupGoogleAuth();
    setupTestDrive();
}

function setupGoogleAuth() {
    const googleBtn = document.getElementById("google-signin-btn");
    if (googleBtn) {
        googleBtn.onclick = async () => {
             const originalText = googleBtn.innerHTML;
             googleBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Connecting...';
             const res = await signInWithGoogle();
             if (!res.success) {
                 showError("Google Sign-In Failed", res.error);
                 googleBtn.innerHTML = originalText;
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
    document.getElementById("sign-in-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("login-email").value;
        const pass = document.getElementById("login-password").value;
        
        if(!email || !pass) return alert("Please fill in all fields");

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
    document.getElementById("sign-up-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("signup-name").value;
        const email = document.getElementById("signup-email").value;
        const pass = document.getElementById("signup-password").value;

        if(!email || !pass) return alert("Please fill in all fields");

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

function setupTestDrive() {
    const micBtn = document.getElementById("onboarding-mic-btn");
    const testArea = document.getElementById("onboarding-test-area");
    
    let mediaRecorder = null;
    let chunks = [];

    if (micBtn) {
        micBtn.onmousedown = async () => {
             testArea.innerHTML = '<span class="text-primary-600 animate-pulse">Listening...</span>';
             try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                chunks = [];
                
                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunks.push(e.data);
                };

                mediaRecorder.start();
             } catch (e) {
                console.error(e);
                testArea.innerHTML = '<span class="text-red-500">Mic Error</span>';
             }
        };

        micBtn.onmouseup = async () => {
             if (!mediaRecorder || mediaRecorder.state === "inactive") return;
             
             testArea.innerHTML = '<span class="text-slate-400">Processing...</span>';
             
             mediaRecorder.onstop = async () => {
                 const blob = new Blob(chunks, { type: "audio/webm" });
                 const buffer = await blob.arrayBuffer();
                 
                 // Stop tracks
                 mediaRecorder.stream.getTracks().forEach(track => track.stop());
                 
                 try {
                     const text = await window.api.transcribeAudio(buffer);
                     testArea.innerHTML = `<span class="text-slate-800 font-medium">"${text}"</span>`;
                 } catch (err) {
                     testArea.innerHTML = `<span class="text-red-400">Error: ${err.message}</span>`;
                 }
             };
             
             mediaRecorder.stop();
        };
        
        // Also handle mouse leave if they drag out
        micBtn.onmouseleave = () => {
            if (mediaRecorder && mediaRecorder.state === "recording") {
                mediaRecorder.stop();
                mediaRecorder.stream.getTracks().forEach(track => track.stop());
                testArea.innerHTML = '<span class="text-slate-400">Cancelled</span>';
            }
        };
    }
}
