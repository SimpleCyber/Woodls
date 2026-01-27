# <img src="webp/woodls.png" width="40" height="40" alt="Woodls Logo" style="vertical-align: middle;"> Woodls

**Woodls** is an intelligent AI-powered voice typing assistant designed to streamline your workflow. By combining global hotkeys with Google's advanced Gemini AI, Woodls captures your speech, refines it for perfect grammar and punctuation, and types it directly into any active application.

## 🚀 Features

- **Global Hotkey Activation**: Press a custom hotkey anywhere on your system to start recording instantly.
- **AI-Powered Transcription**: Uses Google's **Gemini Flash** model for fast and accurate speech-to-text.
- **Smart Refinement**: Automatically fixes grammar, punctuation, and removes filler words (like "ums" and "ahs").
- **Auto-Type & Instant Paste**: Can simulate typing or paste text directly into your active window (Word, browser, code editor, etc.).
- **Built-in Notes**: A dedicated Notes tab to capture thoughts and ideas using your voice.
- **History Tracking**: Keeps a local history of all your transcriptions with audio playback.
- **Minimalist Overlay**: A non-intrusive floating overlay shows recording status and volume levels.
- **Privacy-Focused**: Audio recordings and history are stored locally on your machine.
- **Background Mode**: Runs quietly in the system tray.

## 🛠️ Installation

> [!IMPORTANT]
> **Windows SmartScreen Notice**: Since Woodls is currently an unsigned application, Windows may show a "Windows protected your PC" warning during installation.
> To proceed: Click **"More info"** and then select **"Run anyway"**.

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- A Google Gemini API Key (Get one from [Google AI Studio](https://aistudio.google.com/))

### Steps

1. **Clone the repository**

   ```bash
   git clone https://github.com/SimpleCyber/Woodls.git
   cd woodls
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure Environment**
   Create a `.env` file in the root directory:

   ```env
   GEN_AI_API_KEY=your_gemini_api_key_here
   GEN_AI_MODEL=gemini-2.5-flash-lite
   ```

4. **Run the App**
   ```bash
   npm start
   ```

## 📖 Usage

1. **Set your Hotkey**: On the Home screen, click "Set Hotkey" and press your desired key combination (e.g., `F1` or `Ctrl+Space`).
2. **Start Dictating**: Press the hotkey. The overlay will appear. Speak clearly.
3. **Stop & Transcribe**: Release the hotkey (or press again depending on mode). Woodls will process your audio.
4. **Auto-Type**: The transcribed and refined text will be automatically typed into your currently active window.

## ⚙️ Settings

- **Use Backspace**: If enabled, sends a Backspace key before typing to remove any accidental characters typed during hotkey press.
- **Instant Paste**: Uses Clipboard + Paste (Ctrl+V) for faster text insertion instead of simulating keystrokes.
- **AI Enhanced**: Toggles the grammar and punctuation refinement step.
- **Run on Startup**: Launch Woodls automatically when you log in.
- **Start Hidden**: Launch minimized to the system tray.

## 🔧 Tech Stack

- **Electron**: Cross-platform desktop framework.
- **Google Gemini API**: Generative AI for transcription and text refinement.
- **Firebase Auth**: User authentication.
- **RobotJS**: System-level keyboard simulation.
- **Node Global Key Listener**: standardized global hotkey handling.

## 📄 License

This project is licensed under the ISC License.

<!-- Build releases command -->

git tag -d v1.0.9
git tag v1.0.9
git push origin v1.0.9 --force

---

steps to follow for the new releases

1. update the version in package.json
2. commit the changes
3. <!-- Build releases command -->

   git tag -d v1.6.0
   git tag v1.6.0
   git push origin v1.6.0 --force

4. now update the relsease -> draft to publish changes
5. Great Good to go now users will see the update info
