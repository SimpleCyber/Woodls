export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function addLog(msg, color = "gray") {
    // Optional: Log to a visible area if needed for debugging
    // console.log(`%c${msg}`, `color: ${color}`);
}

// Colors for Notes (Background classes)
// Using Tailwind colors, but mapped nicely.
export const NOTE_COLORS = [
    { name: 'default', bg: 'bg-white', border: 'border-slate-200' },
    { name: 'red', bg: 'bg-red-50', border: 'border-red-100' },
    { name: 'orange', bg: 'bg-orange-50', border: 'border-orange-100' },
    { name: 'amber', bg: 'bg-amber-50', border: 'border-amber-100' },
    { name: 'green', bg: 'bg-green-50', border: 'border-green-100' },
    { name: 'blue', bg: 'bg-blue-50', border: 'border-blue-100' },
    { name: 'purple', bg: 'bg-purple-50', border: 'border-purple-100' },
    { name: 'pink', bg: 'bg-pink-50', border: 'border-pink-100' },
];

export function getNoteColor(name) {
    return NOTE_COLORS.find(c => c.name === name) || NOTE_COLORS[0];
}

// Custom Error Modal
export function showError(title, message) {
    const modal = document.getElementById("error-modal");
    if (!modal) return alert(`${title}: ${message}`);
    
    document.getElementById("error-title").textContent = title || "Error";
    document.getElementById("error-message").textContent = message || "An unknown error occurred.";
    
    const okBtn = document.getElementById("error-ok-btn");
    okBtn.onclick = () => {
        modal.classList.add("hidden");
    };
    
    modal.classList.remove("hidden");
}
