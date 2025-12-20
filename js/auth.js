// js/auth.js
import { 
    auth, 
    googleProvider, 
    signInWithPopup, 
    signOut as fbSignOut,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    onAuthStateChanged as fbOnAuthStateChanged
} from './firebase-config.js';

export function initAuth(onUserChanged) {
    // Listen for Firebase Auth state changes (Persistent)
    fbOnAuthStateChanged(auth, async (user) => {
        if (user) {
            const userData = {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL
            };
            // Sync to Main Process for file paths/backend logic
            await window.api.authSync(userData);
            onUserChanged(userData);
        } else {
            await window.api.authSync(null);
            onUserChanged(null);
        }
    });
}

export async function login(email, password) {
    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, user: cred.user };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function signup(email, password, displayName) {
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName) {
            await updateProfile(cred.user, { displayName });
        }
        return { success: true, user: cred.user };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

export async function logout() {
    try {
        await fbSignOut(auth);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// Google Auth 
export async function signInWithGoogle() {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        // State change listener will handle the sync
        return { success: true, user: result.user };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function getCurrentUser() {
    // Return promise that resolves with current user
    return new Promise((resolve) => {
        const unsubscribe = fbOnAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        });
    });
}
