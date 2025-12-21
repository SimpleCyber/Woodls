// js/notes.js
import { addLog, $, $$, NOTE_COLORS, getNoteColor } from './utils.js';

let allNotes = [];
let isExp = false;
let isListMode = false;
let selectedColor = 'default';
let attachedImages = []; // Array of Base64 strings

// DOM Elements
const notesTabBtn = document.querySelector('[data-page="notes"]');
const notesGrid = $("#notes-grid");
const notesEmptyState = $("#notes-empty-state");
const refreshNotesBtn = $("#refreshNotes");
const noteSearch = $("#note-search");

// Input Area
const takeNoteWrapper = $("#take-note-wrapper");
const noteTitleContainer = $("#note-title-container");
const noteTitleInput = $("#note-title-input");
const noteContentInput = $("#note-content-input"); // Text input
const noteListContainer = $("#note-list-container"); // List inputs container
const noteFooterContainer = $("#note-footer-container");
const closeNoteBtn = $("#close-note-btn");
const voiceNoteBtn = $("#voice-note-btn");
const newListBtn = $("#new-list-btn"); 

// New UI Elements
const colorBtn = $("#note-color-btn");
const colorPalette = $("#color-palette");
const addImageBtn = $("#add-image-btn");
const addImageExpandedBtn = $("#add-image-expanded-btn");
const imageInput = $("#image-input");
const noteImagePreviewContainer = $("#note-image-preview-container");

// Modals
const deleteModal = $("#delete-modal");
const editModal = $("#edit-modal");
const editTitleInput = $("#edit-note-title");
const editContentContent = $("#edit-note-content"); // Textarea
const editListContainer = $("#edit-note-list-container"); // List container
const editImagePreview = $("#edit-note-images");
const saveEditBtn = $("#save-edit-btn");
const cancelEditBtn = $("#cancel-edit-btn");
const confirmDeleteBtn = $("#confirm-delete-btn");
const cancelDeleteBtn = $("#cancel-delete-btn");
const editColorBtn = $("#edit-color-btn");
const editColorPalette = $("#edit-color-palette");
const editAddImageBtn = $("#edit-add-image-btn");


// State for modals
let noteToDeleteId = null;
let noteToEditId = null;
let editValues = { 
    type: 'text', 
    content: '', 
    title: '', 
    color: 'default',
    images: []
};

export function initNotes() {
    setupColorPalettes();
    setupEventListeners();
    if (notesTabBtn && notesTabBtn.classList.contains('active')) {
        loadNotes();
    }
}

function setupColorPalettes() {
    // Main Input Palette
    if (colorPalette) {
        colorPalette.innerHTML = NOTE_COLORS.map(c => `
            <div class="w-6 h-6 rounded-full cursor-pointer border ${c.border} ${c.bg} hover:scale-110 transition-transform" 
                 title="${c.name}" onclick="selectColor('${c.name}')"></div>
        `).join('');
    }
    // Edit Modal Palette
    if (editColorPalette) {
        editColorPalette.innerHTML = NOTE_COLORS.map(c => `
            <div class="w-6 h-6 rounded-full cursor-pointer border ${c.border} ${c.bg} hover:scale-110 transition-transform" 
                 title="${c.name}" onclick="changeEditColor('${c.name}')"></div>
        `).join('');
    }
}

// Global scope for HTML onClick
window.selectColor = (name) => {
    selectedColor = name;
    applyInputColor(name);
    if(colorPalette) colorPalette.classList.add("hidden");
};

window.changeEditColor = (name) => {
    editValues.color = name;
    if(editModal) {
        const modalContent = $("#edit-modal-content");
        const colorObj = getNoteColor(name);
        if(modalContent) modalContent.className = `bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh] scale-100 animate-in zoom-in-95 duration-200 overflow-hidden transition-colors ${colorObj.bg}`;
    }
    if(editColorPalette) editColorPalette.classList.add("hidden");
}


function applyInputColor(name) {
    const colorObj = getNoteColor(name);
    // Apply to wrapper
    if(takeNoteWrapper) {
         // remove all bg classes
         takeNoteWrapper.className = `border border-slate-200 shadow-sm rounded-lg overflow-hidden transition-shadow hover:shadow-md ${colorObj.bg}`;
    }
}


function setupEventListeners() {
    if (notesTabBtn) notesTabBtn.addEventListener("click", loadNotes);
    if (refreshNotesBtn) refreshNotesBtn.addEventListener("click", loadNotes);

    // Search
    if (noteSearch) {
        noteSearch.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = allNotes.filter(n => {
                const titleMatch = n.title && n.title.toLowerCase().includes(query);
                let contentMatch = false;
                if (Array.isArray(n.content)) {
                    contentMatch = n.content.some(item => item.text.toLowerCase().includes(query));
                } else {
                    contentMatch = n.content && n.content.toLowerCase().includes(query);
                }
                return titleMatch || contentMatch;
            });
            renderNotes(filtered);
        });
    }

    // Input Focus
    if (noteContentInput) {
        noteContentInput.addEventListener("focus", () => {
             if (!isListMode) expandNoteInput();
        });
    }

    // New List Button
    if (newListBtn) {
        newListBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            isListMode = true;
            expandNoteInput(); 
            updateInputModeUI();
            addListItem();
        });
    }
    
    // Close & Voice
    if (closeNoteBtn) closeNoteBtn.addEventListener("click", (e) => { e.stopPropagation(); collapseNoteInput(); });
    if (voiceNoteBtn) voiceNoteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            addLog("Use your hotkey!", "blue");
    });
    
    // Color Palette Toggle
    if (colorBtn) {
        colorBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            colorPalette.classList.toggle("hidden");
        });
    }

    // Image Input
    if (addImageBtn) addImageBtn.addEventListener("click", (e) => { e.stopPropagation(); imageInput.click(); });
    if (addImageExpandedBtn) addImageExpandedBtn.addEventListener("click", (e) => { e.stopPropagation(); imageInput.click(); });
    
    if (imageInput) {
        imageInput.addEventListener("change", (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                 handleImageFiles(files);
                 imageInput.value = ""; // reset
            }
        });
    }

    // Edit Modal Buttons
    if (editColorBtn) editColorBtn.onclick = (e) => { e.stopPropagation(); editColorPalette.classList.toggle("hidden"); }
    if (editAddImageBtn) editAddImageBtn.onclick = (e) => { e.stopPropagation(); /* Reuse imageInput? or new one? reusing for simplicity but careful about context */ 
         // Strategy: Use same input, but set a flag for where it goes? 
         // Simpler: Just Trigger Input, check logic?
         // Let's create a separate logic or reuse. Reusing is fine if we check modal visibility.
         window.isEditingImage = true;
         imageInput.click();
    };


    // Click Outside
    document.addEventListener("click", (e) => {
        if (!isExp) return;
        if (takeNoteWrapper.contains(e.target)) return;
        if (editModal && !editModal.classList.contains("hidden") && editModal.contains(e.target)) return;
        if (deleteModal && !deleteModal.classList.contains("hidden") && deleteModal.contains(e.target)) return;
        
        // Hide palettes if clicking outside them
        if(!colorPalette.classList.contains("hidden") && !colorBtn.contains(e.target)) colorPalette.classList.add("hidden");

        collapseNoteInput();
    });

    // Modal Actions
    if (cancelDeleteBtn) cancelDeleteBtn.onclick = closeDeleteModal;
    if (confirmDeleteBtn) confirmDeleteBtn.onclick = async () => {
        if (noteToDeleteId) {
            await window.api.deleteNote(noteToDeleteId);
            closeDeleteModal();
            loadNotes();
        }
    };

    if (cancelEditBtn) cancelEditBtn.onclick = closeEditModal;
    if (saveEditBtn) saveEditBtn.onclick = async () => {
        saveEditNote();
    };
}

async function handleImageFiles(files) {
    // Detect where to add images: Input or Edit Modal
    const isEdit = (editModal && !editModal.classList.contains("hidden"));
    
    for (const file of files) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result;
            if (isEdit) {
                editValues.images.push(base64);
                renderEditImages();
            } else {
                attachedImages.push(base64);
                renderInputImages();
                expandNoteInput();
            }
        };
        reader.readAsDataURL(file);
    }
    // Cleanup flag if used logic
    window.isEditingImage = false;
}

function renderInputImages() {
    if (!noteImagePreviewContainer) return;
    noteImagePreviewContainer.innerHTML = "";
    if (attachedImages.length > 0) {
        noteImagePreviewContainer.classList.remove("hidden");
        attachedImages.forEach((src, idx) => {
            const div = document.createElement("div");
            div.className = "relative group rounded-lg overflow-hidden border border-slate-200";
            div.innerHTML = `
                <img src="${src}" class="w-full h-32 object-cover">
                <button class="absolute top-1 right-1 bg-black/50 text-white w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                 onclick="removeInputImage(${idx})"><i class="fa-solid fa-xmark"></i></button>
            `;
            noteImagePreviewContainer.appendChild(div);
        });
    } else {
        noteImagePreviewContainer.classList.add("hidden");
    }
}

window.removeInputImage = (idx) => {
    attachedImages.splice(idx, 1);
    renderInputImages();
}

function renderEditImages() {
    if(!editImagePreview) return;
    editImagePreview.innerHTML = "";
    if (editValues.images && editValues.images.length > 0) {
        editImagePreview.classList.remove("hidden");
        const grid = document.createElement("div");
        grid.className = "grid grid-cols-2 gap-2"; 
        
        editValues.images.forEach((src, idx) => {
             const div = document.createElement("div");
             div.className = "relative group rounded-none overflow-hidden h-40 w-full";
             div.innerHTML = `
                <img src="${src}" class="w-full h-full object-cover">
                 <button class="absolute top-2 right-2 bg-black/50 text-white w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                 onclick="removeEditImage(${idx})"><i class="fa-solid fa-xmark"></i></button>
             `;
             grid.appendChild(div);
        });
        editImagePreview.appendChild(grid);
    } else {
        editImagePreview.classList.add("hidden");
    }
}
window.removeEditImage = (idx) => {
    editValues.images.splice(idx, 1);
    renderEditImages();
}

export async function loadNotes() {
    if (!notesGrid) return;
    try {
        allNotes = await window.api.getNotes();
        // search filter check...
        renderNotes(allNotes); 
    } catch (e) { console.error(e); }
}

function renderNotes(notes) {
    if (!notes || notes.length === 0) {
        notesGrid.innerHTML = "";
        notesEmptyState.classList.remove("hidden");
        return;
    }
    notesEmptyState.classList.add("hidden");
    notesGrid.innerHTML = "";
    
    // Sort: Pinned first, then by order (or timestamp)
    const sortedNotes = [...notes].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        // Within same pin status, sort by order
        const orderA = a.order !== undefined ? a.order : a.timestamp || 0;
        const orderB = b.order !== undefined ? b.order : b.timestamp || 0;
        return orderA - orderB;
    });
    
    sortedNotes.forEach((note, index) => {
        const colorObj = getNoteColor(note.color || 'default');
        
        const el = document.createElement("div");
        el.className = `break-inside-avoid ${colorObj.bg} border ${colorObj.border} rounded-xl shadow-sm hover:shadow-md mb-4 relative group transition-all duration-200 overflow-hidden cursor-move`;
        el.draggable = true;
        el.dataset.noteId = note.id;
        el.dataset.noteIndex = index;
        el.style.pageBreakInside = "avoid";

        // Render Images
        let imagesHtml = "";
        if (note.images && note.images.length > 0) {
            imagesHtml = `<div class="w-full h-40 overflow-hidden"><img src="${note.images[0]}" class="w-full h-full object-cover"></div>`;
            if(note.images.length > 1) {
                 // Indicator for more images?
            }
        }

        // Determine content HTML
        let contentHtml = "";
        if (Array.isArray(note.content)) {
            // List
            const maxItems = 5;
            const items = note.content;
            const visibleItems = items.slice(0, maxItems);
            const remaining = items.length - maxItems;

            contentHtml = `<div class="space-y-1 p-4 pt-2">`;
            visibleItems.forEach((item, idx) => {
                const checkedClass = item.checked ? "line-through text-slate-400" : "text-slate-700";
                const iconClass = item.checked ? "fa-solid fa-square-check text-slate-500" : "fa-regular fa-square text-slate-400";
                
                contentHtml += `
                    <div class="flex items-start gap-2 cursor-pointer checklist-item-render" data-idx="${idx}">
                        <i class="${iconClass} mt-1"></i>
                        <span class="text-sm ${checkedClass} leading-relaxed">${item.text}</span>
                    </div>
                `;
            });
            contentHtml += `</div>`;
            if (remaining > 0) contentHtml += `<div class="px-4 pb-2 text-xs text-slate-400 font-medium">+ ${remaining} more items</div>`;
        } else {
            // Text
            contentHtml = `<div class="p-4 pt-2"><p class="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">${note.content || ""}</p></div>`;
        }
        
        // Title padding logic
        const titlePadding = (note.images && note.images.length > 0) ? "pt-4 px-4" : "pt-4 px-4";

        el.innerHTML = `
            ${imagesHtml}
            ${note.pinned ? '<div class="absolute top-2 left-2 z-10"><i class="fa-solid fa-thumbtack text-amber-500 text-sm drop-shadow"></i></div>' : ''}
            <div class="note-actions absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                 <button class="pin-btn w-6 h-6 rounded-full bg-white/50 hover:bg-white ${note.pinned ? 'text-amber-500' : 'text-slate-500'} hover:text-amber-600 flex items-center justify-center transition-colors shadow-sm" title="${note.pinned ? 'Unpin' : 'Pin'}">
                    <i class="fa-solid fa-thumbtack text-xs"></i>
                </button>
                 <button class="edit-btn w-6 h-6 rounded-full bg-white/50 hover:bg-white text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors shadow-sm">
                    <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button class="del-btn w-6 h-6 rounded-full bg-white/50 hover:bg-white text-slate-500 hover:text-red-500 flex items-center justify-center transition-colors shadow-sm">
                    <i class="fa-solid fa-trash text-xs"></i>
                </button>
            </div>
            ${note.title ? `<h3 class="font-semibold text-slate-800 mb-1 ${titlePadding}">${note.title}</h3>` : `<div class="${imagesHtml ? 'mt-2' : ''}"></div>`}
            ${contentHtml}
        `;

        // Checkbox Logic
        if (Array.isArray(note.content)) {
            const checks = el.querySelectorAll('.checklist-item-render');
            checks.forEach(c => {
                c.onclick = async (ev) => {
                    ev.stopPropagation();
                    const idx = parseInt(c.dataset.idx);
                    note.content[idx].checked = !note.content[idx].checked;
                    await window.api.saveNote(note);
                    loadNotes();
                }
            });
        }

        el.onclick = (e) => {
            if (e.target.closest('button') || e.target.closest('.checklist-item-render')) return;
            openEditModal(note);
        };
        
        // Button handlers
        el.querySelector(".pin-btn").onclick = (e) => { e.stopPropagation(); togglePin(note.id); };
        el.querySelector(".del-btn").onclick = (e) => { e.stopPropagation(); openDeleteModal(note.id); };
        el.querySelector(".edit-btn").onclick = (e) => { e.stopPropagation(); openEditModal(note); };
        
        // Drag and Drop handlers
        el.addEventListener('dragstart', handleDragStart);
        el.addEventListener('dragover', handleDragOver);
        el.addEventListener('drop', handleDrop);
        el.addEventListener('dragend', handleDragEnd);

        notesGrid.appendChild(el);
    });
}

function updateInputModeUI() {
    if (isListMode) {
        if(noteContentInput) noteContentInput.classList.add("hidden");
        if(noteListContainer) noteListContainer.classList.remove("hidden");
    } else {
        if(noteContentInput) noteContentInput.classList.remove("hidden");
        if(noteListContainer) noteListContainer.classList.add("hidden");
    }
}

function addListItem(initialText = "") {
    if (!noteListContainer) return;
    const div = document.createElement("div");
    div.className = "flex items-center gap-2 group";
    div.innerHTML = `
        <i class="fa-regular fa-square text-slate-300"></i>
        <input type="text" class="list-item-input flex-1 bg-transparent border-b border-transparent focus:border-slate-300 outline-none text-sm text-slate-700 placeholder:text-slate-300" placeholder="List item" value="${initialText}">
        <button class="text-slate-300 hover:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity remove-item-btn"><i class="fa-solid fa-xmark"></i></button>
    `;
    div.querySelector("input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); addListItem().focus(); }
        if (e.key === "Backspace" && e.target.value === "") {
             if (noteListContainer.children.length > 1) {
                 e.preventDefault(); div.remove();
                 const inputs = noteListContainer.querySelectorAll("input");
                 if (inputs.length > 0) inputs[inputs.length - 1].focus();
             }
        }
    });
    div.querySelector(".remove-item-btn").onclick = () => div.remove();
    noteListContainer.appendChild(div);
    return div.querySelector("input");
}


function expandNoteInput() {
    if (isExp) return;
    isExp = true;
    if (noteTitleContainer) noteTitleContainer.classList.remove("hidden");
    if (noteFooterContainer) noteFooterContainer.classList.remove("hidden");
    if (takeNoteWrapper) {
        takeNoteWrapper.classList.add("shadow-md", "ring-1", "ring-slate-200");
        // Remove overflow-hidden so the color palette (absolute) can be seen outside if needed, 
        // or just so it doesn't get clipped if it interacts with rounded corners weirdly.
        takeNoteWrapper.classList.remove("overflow-hidden");
    }
}

async function collapseNoteInput() {
    const title = noteTitleInput ? noteTitleInput.value.trim() : "";
    let content = null;
    let type = (isListMode && noteListContainer) ? 'list' : 'text'; // re-verify type source

    if (isListMode) {
        if (noteListContainer) {
            const inputs = noteListContainer.querySelectorAll(".list-item-input");
            const items = [];
            inputs.forEach(inp => {
                if (inp.value.trim()) items.push({ text: inp.value.trim(), checked: false });
            });
            if (items.length > 0) content = items;
        }
    } else {
        const txt = noteContentInput ? noteContentInput.value.trim() : "";
        if (txt) content = txt;
    }

    try {
        if (title || content || attachedImages.length > 0) {
            await window.api.saveNote({ 
                title, 
                content: content || (isListMode ? [] : ""),
                type,
                color: selectedColor,
                images: attachedImages
            });
            await loadNotes();
        }
    } catch (err) {
        console.error("Failed to save note:", err);
        addLog("Error saving note", "red");
    } finally {
        resetInputState();
    }
}

function resetInputState() {
    isExp = false;
    isListMode = false;
    selectedColor = 'default';
    attachedImages = [];
    
    // UI Reset
    applyInputColor('default');
    if (noteTitleContainer) noteTitleContainer.classList.add("hidden");
    if (noteFooterContainer) noteFooterContainer.classList.add("hidden");
    if (takeNoteWrapper) {
        takeNoteWrapper.classList.remove("shadow-md", "ring-1", "ring-slate-200");
        // restore overflow hidden for nice rounded corners when collapsed
        takeNoteWrapper.classList.add("overflow-hidden");
    }
    
    if (noteTitleInput) noteTitleInput.value = "";
    if (noteContentInput) {
        noteContentInput.value = "";
        noteContentInput.classList.remove("hidden");
    }
    if (noteListContainer) {
        noteListContainer.innerHTML = "";
        noteListContainer.classList.add("hidden");
    }
    if(colorPalette) colorPalette.classList.add("hidden");
    renderInputImages(); 
}


// --- Modal Editing Logic ---

function openEditModal(note) {
    noteToEditId = note.id;
    editValues = {
        title: note.title,
        content: note.content,
        color: note.color || 'default',
        images: note.images ? [...note.images] : [],
        type: Array.isArray(note.content) ? 'list' : 'text'
    };
    
    const modalContent = $("#edit-modal-content");
    const colorObj = getNoteColor(editValues.color);
    // Apply BG
    if(modalContent) modalContent.className = `bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh] scale-100 animate-in zoom-in-95 duration-200 overflow-hidden transition-colors ${colorObj.bg}`;
    
    // Title
    editTitleInput.value = editValues.title || "";
    
    // Images
    renderEditImages();

    // Content Switch
    if (editValues.type === 'list') {
        editContentContent.classList.add("hidden");
        editListContainer.classList.remove("hidden");
        renderEditListItems();
    } else {
        editContentContent.classList.remove("hidden");
        editListContainer.classList.add("hidden");
        editContentContent.value = editValues.content || "";
    }
    
    if (editModal) {
        editModal.classList.remove("hidden");
        editModal.classList.add("flex");
    }
}

function renderEditListItems() {
    editListContainer.innerHTML = "";
    // Existing Items
    if(Array.isArray(editValues.content)) {
        editValues.content.forEach(item => addEditListItem(item));
    }
    // Plus one empty at end
    addEditListItem(); 
}

function addEditListItem(item = null) {
    const div = document.createElement("div");
    div.className = "flex items-center gap-2 group";
    const isChecked = item ? item.checked : false;
    const text = item ? item.text : "";
    
    div.innerHTML = `
        <i class="cursor-pointer ${isChecked ? 'fa-solid fa-square-check text-slate-500' : 'fa-regular fa-square text-slate-400'}" data-check></i>
        <input type="text" class="edit-list-input flex-1 bg-transparent border-b border-transparent focus:border-slate-300 outline-none text-slate-700 placeholder:text-slate-400" placeholder="List item" value="${text}">
        <button class="text-slate-400 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity remove-item-btn"><i class="fa-solid fa-xmark"></i></button>
    `;
    
    // Check toggle logic in UI only (state updated on save)
    const icon = div.querySelector('[data-check]');
    icon.onclick = () => {
       icon.className = icon.className.includes('fa-regular') ? 'cursor-pointer fa-solid fa-square-check text-slate-500' : 'cursor-pointer fa-regular fa-square text-slate-400';
       div.dataset.checked = icon.className.includes('fa-solid'); // store state in dom for simple saving
    };
    if(isChecked) div.dataset.checked = "true";

    const input = div.querySelector("input");
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); addEditListItem().querySelector('input').focus(); }
        if (e.key === "Backspace" && input.value === "") { 
             if(editListContainer.children.length > 1) {
                 div.remove(); 
                 // focus prev...
             }
        }
    });
    
    div.querySelector(".remove-item-btn").onclick = () => div.remove();
    editListContainer.appendChild(div);
    return div;
}


async function saveEditNote() {
    if(!noteToEditId) return;
    
    const newTitle = editTitleInput.value.trim();
    let newContent = null;
    
    if (editValues.type === 'list') {
        const divs = editListContainer.querySelectorAll("div.flex"); // rows
        const items = [];
        divs.forEach(div => {
             const input = div.querySelector("input");
             if(input && input.value.trim()) {
                 const checked = div.dataset.checked === "true";
                 items.push({ text: input.value.trim(), checked });
             }
        });
        newContent = items;
    } else {
        newContent = editContentContent.value.trim();
    }
    
    await window.api.saveNote({ 
        id: noteToEditId,
        title: newTitle,
        content: newContent,
        color: editValues.color,
        images: editValues.images,
        type: editValues.type
    });
    
    closeEditModal();
    loadNotes();
}

function closeEditModal() {
    noteToEditId = null;
    if (editModal) {
        editModal.classList.add("hidden");
        editModal.classList.remove("flex");
    }
}

// Global Voice Handler
export function handleVoiceInput(text) {
    if (isListMode) {
         const input = addListItem(text);
         if(input) input.focus();
    } else {
        if (noteContentInput) {
            noteContentInput.value = noteContentInput.value ? noteContentInput.value + "\n" + text : text;
        }
    }
    expandNoteInput();
}

// Modal delete handlers
function openDeleteModal(id) { noteToDeleteId = id; deleteModal.classList.remove("hidden"); deleteModal.classList.add("flex"); }
function closeDeleteModal() { noteToDeleteId = null; deleteModal.classList.add("hidden"); deleteModal.classList.remove("flex"); }

// Pin/Unpin functionality
async function togglePin(noteId) {
    const note = allNotes.find(n => n.id === noteId);
    if (!note) return;
    
    note.pinned = !note.pinned;
    await window.api.saveNote(note);
    await loadNotes();
}

// Drag and Drop State
let draggedElement = null;
let draggedNoteId = null;

function handleDragStart(e) {
    draggedElement = e.currentTarget;
    draggedNoteId = e.currentTarget.dataset.noteId;
    e.currentTarget.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const afterElement = getDragAfterElement(notesGrid, e.clientY);
    if (afterElement == null) {
        notesGrid.appendChild(draggedElement);
    } else {
        notesGrid.insertBefore(draggedElement, afterElement);
    }
    
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();
    return false;
}

async function handleDragEnd(e) {
    e.currentTarget.style.opacity = '';
    
    // Update order based on new DOM position
    const noteElements = Array.from(notesGrid.querySelectorAll('[data-note-id]'));
    const newOrder = noteElements.map((el, index) => ({
        id: el.dataset.noteId,
        order: index
    }));
    
    // Update all notes with new order
    for (const { id, order } of newOrder) {
        const note = allNotes.find(n => n.id === id);
        if (note) {
            note.order = order;
            await window.api.saveNote(note);
        }
    }
    
    await loadNotes();
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('[draggable="true"]:not(.opacity-50)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}
