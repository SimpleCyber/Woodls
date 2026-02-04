// js/auth.js
// Auth is managed in the main process. This file bridges it to the renderer via IPC.

export function initAuth(onUserChanged) {
  // Listen for Auth state changes from the Main Process
  window.api.onAuthStateChanged((event, user) => {
    // The first argument is the IPC event object, the second is our user data
    if (user) {
      onUserChanged(user);
    } else {
      onUserChanged(null);
    }
  });

  // Initial check (since we might have missed the event or page reloaded)
  window.api.getCurrentUser().then((user) => {
    if (user) {
      onUserChanged(user);
    } else {
      onUserChanged(null);
    }
  });
}

export async function login(email, password) {
  return await window.api.login({ email, password });
}

export async function signup(email, password, displayName) {
  return await window.api.signup({ email, password, name: displayName });
}

export async function logout() {
  return await window.api.logout();
}

// Google Auth
export async function signInWithGoogle() {
  try {
    // Browser Login Flow
    // Open the Next.js auth page in default browser
    const AUTH_URL = "http://localhost:3000/auth-desktop";

    await window.api.openExternal(AUTH_URL);

    // We don't return a user here immediately.
    // The app will wait for the deep link callback which triggers onAuthStateChanged
    return { success: true, pending: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getCurrentUser() {
  return await window.api.getCurrentUser();
}
