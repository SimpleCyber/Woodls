const fs = require("fs");
const path = require("path");
const { pipeline, env } = require("@xenova/transformers");

// Configuration
const MODELS_DIR = path.join(__dirname, "..", "models");
env.localModelPath = MODELS_DIR;
env.cacheDir = MODELS_DIR;
env.allowRemoteModels = true; // Allow downloading for this script

// Models to download
const MODELS = [
  { name: "Xenova/whisper-tiny.en", task: "automatic-speech-recognition" },
  { name: "Xenova/flan-t5-small", task: "text2text-generation" },
];

async function downloadModels() {
  console.log(`Checking/Downloading models to: ${MODELS_DIR}`);
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }

  for (const model of MODELS) {
    console.log(`\nProcessing model: ${model.name}...`);
    try {
      // Trigger download by instantiating the pipeline
      // Transformers.js will cache it in localModelPath/cacheDir
      await pipeline(model.task, model.name, {
        cache_dir: MODELS_DIR,
      });
      console.log(`✅ Successfully downloaded/verified: ${model.name}`);
    } catch (error) {
      console.error(`❌ Failed to download ${model.name}:`, error);
    }
  }
  console.log("\nAll models processed.");
}

downloadModels();
