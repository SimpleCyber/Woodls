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
    { name: 'red', bg: 'bg-red-100', border: 'border-red-200' },
    { name: 'orange', bg: 'bg-orange-100', border: 'border-orange-200' },
    { name: 'yellow', bg: 'bg-yellow-100', border: 'border-yellow-200' },
    { name: 'green', bg: 'bg-green-100', border: 'border-green-200' },
    { name: 'teal', bg: 'bg-teal-100', border: 'border-teal-200' },
    { name: 'blue', bg: 'bg-blue-100', border: 'border-blue-200' },
    { name: 'darkblue', bg: 'bg-indigo-100', border: 'border-indigo-200' },
    { name: 'purple', bg: 'bg-purple-100', border: 'border-purple-200' },
    { name: 'pink', bg: 'bg-pink-100', border: 'border-pink-200' },
    { name: 'brown', bg: 'bg-stone-100', border: 'border-stone-200' },
    { name: 'gray', bg: 'bg-gray-100', border: 'border-gray-200' }
];

export function getNoteColor(name) {
    return NOTE_COLORS.find(c => c.name === name) || NOTE_COLORS[0];
}
