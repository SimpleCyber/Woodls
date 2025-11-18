const { GoogleAIFileManager } = require("@google/generative-ai/server");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");

const API_KEY = "AIzaSyDMeBypr5QwUdXAjVTRmfOmWnDXlcJNNK4";
const AUDIO_FILE = "./models/inputVoice.mp3";

async function transcribeAudio() {
  try {
    const fileManager = new GoogleAIFileManager(API_KEY);

    console.log("Uploading file...");
    const upload = await fileManager.uploadFile(AUDIO_FILE, {
      mimeType: "audio/mpeg",
      displayName: "input voice",
    });

    console.log("Uploaded file:", upload.file.uri);

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
    });

    console.log("Transcribing...");
    const result = await model.generateContent([
      "just return the in text format without changes only text nothing else",
      {
        fileData: {
          mimeType: upload.file.mimeType,
          fileUri: upload.file.uri,
        },
      },
    ]);

    console.log("\n📝 Transcription:\n", result.response.text());
  } catch (error) {
    console.error("Error:", error);
  }
}

transcribeAudio();
