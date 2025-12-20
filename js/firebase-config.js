// js/firebase-config.js
// Deprecated. Auth moved to main process (index.js).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAvKsK4Qot2xLzzuVO4bOaTJEKR6kUDlDE",
  authDomain: "woodlsvoice.firebaseapp.com",
  projectId: "woodlsvoice",
  storageBucket: "woodlsvoice.firebasestorage.app",
  messagingSenderId: "23072437848",
  appId: "1:23072437848:web:4af878d59838d4e4863c2d",
  measurementId: "G-GXX6NC69LL"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export { 
  signInWithPopup, 
  signOut, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  updateProfile, 
  onAuthStateChanged 
};
