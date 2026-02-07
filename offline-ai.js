const path = require("path");
const fs = require("fs");
const wavefile = require("wavefile");

class OfflineAI {
  constructor() {
    this.transcriber = null;
    this.rewriter = null;
    this.modelsPath = this.getModelsPath();
    this.isInitialized = false;
    this.transformersModule = null;
  }

  getModelsPath() {
    // Production: resources/models
    // Development: project/models
    const isProd =
      process.env.NODE_ENV === "production" ||
      /[\\/]resources[\\/]app.asar/.test(__dirname);
    if (isProd) {
      // In packaged app, resources are at process.resourcesPath
      // __dirname is inside app.asar
      return path.join(process.resourcesPath, "models");
    }
    return path.join(__dirname, "models");
  }

  async init() {
    if (this.isInitialized) return;

    try {
      console.log("[OfflineAI] Loading Transformers.js...");
      // Dynamic import for ESM compatibility
      this.transformersModule = await import("@xenova/transformers");
      const { pipeline, env } = this.transformersModule;

      // Configure Transformers.js
      env.localModelPath = this.modelsPath;
      env.allowRemoteModels = false; // Force offline mode
      env.cacheDir = this.modelsPath;

      console.log("[OfflineAI] Configured model path:", this.modelsPath);
      console.log("[OfflineAI] Initializing models...");

      // Parallel loading
      const [transcriber, rewriter] = await Promise.all([
        pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en"),
        pipeline("text2text-generation", "Xenova/flan-t5-small"),
      ]);

      this.transcriber = transcriber;
      this.rewriter = rewriter;
      this.isInitialized = true;
      console.log("[OfflineAI] Models initialized successfully.");
    } catch (error) {
      console.error("[OfflineAI] Initialization failed:", error);
      throw error;
    }
  }

  async transcribe(audioBuffer, audioSamples = null) {
    if (!this.isInitialized) await this.init();

    try {
      // Use provided samples (decoded in renderer) or fallback to wavefile preprocessing
      let audioData = audioSamples
        ? audioSamples
        : await this.preprocessAudio(audioBuffer);

      // Ensure audioData is a Float32Array (IPC can sometimes mangle TypedArrays into Objects)
      if (audioData && !(audioData instanceof Float32Array)) {
        if (audioData.buffer && audioData.byteLength) {
          audioData = new Float32Array(
            audioData.buffer,
            audioData.byteOffset,
            audioData.byteLength / 4,
          );
        } else {
          audioData = Float32Array.from(Object.values(audioData));
        }
      }

      // Robust Peak Normalization (Whisper needs standard volume)
      let maxVal = 0;
      let sumAbs = 0;
      let nonZeroCount = 0;
      for (let i = 0; i < audioData.length; i++) {
        const abs = Math.abs(audioData[i]);
        if (abs > maxVal) maxVal = abs;
        sumAbs += abs;
        if (abs > 0.0001) nonZeroCount++;
      }

      const avgAbs = sumAbs / audioData.length;

      console.group("[OfflineAI] Transcribing...");
      console.log("[OfflineAI] Samples count:", audioData.length);
      console.log("[OfflineAI] Max amplitude:", maxVal);
      console.log("[OfflineAI] Avg amplitude:", avgAbs);
      console.log("[OfflineAI] Non-silent samples (>0.0001):", nonZeroCount);

      if (maxVal > 0 && maxVal < 0.8) {
        console.log("[OfflineAI] Normalizing audio to 0.9 peak...");
        const ratio = 0.9 / maxVal;
        for (let i = 0; i < audioData.length; i++) {
          audioData[i] *= ratio;
        }
      }

      // Most basic possible call
      const result = await this.transcriber(audioData);

      console.log("[OfflineAI] Full Results:", JSON.stringify(result));
      if (result.chunks && result.chunks.length > 0) {
        console.log("[OfflineAI] Segments found:", result.chunks.length);
        result.chunks.forEach((c, idx) => {
          console.log(
            `  Segment ${idx}: "${c.text}" (${c.timestamp[0]}-${c.timestamp[1]})`,
          );
        });
      }
      console.groupEnd();

      return (result.text || "").trim();
    } catch (error) {
      console.error("[OfflineAI] Transcription failed:", error);
      throw error;
    }
  }

  async rewrite(text, customPrompt = null) {
    if (!this.isInitialized) await this.init();
    if (!text || text.trim().length === 0) return text;

    try {
      // Small models like flan-t5-small need very direct, short instructions.
      // Long prompts cause them to hallucinate identity ("a symphony").
      let prompt;
      if (customPrompt) {
        // Condensed prompt for T5
        prompt = `${customPrompt.trim()}: ${text}`;
      } else {
        prompt = `Fix grammar and format: ${text}`;
      }

      console.group("[OfflineAI] Rewriting...");
      console.log("[OfflineAI] Prompt:", prompt);

      const result = await this.rewriter(prompt, {
        max_new_tokens: 512,
        temperature: 0.1, // Lower for stability
        repetition_penalty: 1.5, // Increased
        no_repeat_ngram_size: 3, // Prevent Looping
        num_beams: 2, // Better search
        do_sample: false,
      });

      let output = result[0].generated_text.trim();
      console.log("[OfflineAI] Raw result:", output);

      // 1. Remove systemic labels
      output = output
        .replace(/^Rewrite:\s*/i, "")
        .replace(/^Rewrite and format:\s*/i, "")
        .replace(/^Formatted Output:\s*/i, "")
        .replace(/^Output:\s*/i, "")
        .trim();

      // 2. Repetition cleaning
      output = this.removeRepetitions(output);

      // 3. Hallucination Guard
      if (this.isHallucination(text, output)) {
        console.warn(
          "[OfflineAI] Hallucination detected, falling back to original text.",
        );
        console.groupEnd();
        return text;
      }

      console.groupEnd();
      return output;
    } catch (error) {
      console.error("[OfflineAI] Rewriting failed:", error);
      return text;
    }
  }

  // Detects if the model completely changed the subject (hallucinated)
  isHallucination(original, generated) {
    if (!generated || generated.length < 2) return true;

    const origWords = new Set(
      original
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2),
    );
    const genWords = generated
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2);

    if (origWords.size === 0) return false; // Hard to judge empty/very short input
    if (genWords.length === 0) return true;

    // Check for "Identity Hallucinations" common in small T5
    const identityTriggers = [
      "symphony",
      "video game",
      "audio file",
      "syncing",
      "ipod",
    ];
    if (
      identityTriggers.some((t) => generated.toLowerCase().includes(t)) &&
      !identityTriggers.some((t) => original.toLowerCase().includes(t))
    ) {
      return true;
    }

    // Measure overlap
    let overlapCount = 0;
    for (const word of genWords) {
      if (origWords.has(word)) overlapCount++;
    }

    const overlapRatio =
      overlapCount / Math.min(origWords.size, genWords.length);
    console.log(`[OfflineAI] Overlap Ratio: ${overlapRatio.toFixed(2)}`);

    // If less than 15% overlap and input was decent length, it's likely a hallucination
    if (overlapRatio < 0.15 && original.length > 15) return true;

    return false;
  }

  removeRepetitions(text) {
    // Basic sentence-level deduplication
    const sentences = text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const seen = new Set();
    const result = [];

    for (const s of sentences) {
      const normalized = s.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(s);
      }
    }

    return result.join(". ") + (result.length > 0 ? "." : "");
  }

  async preprocessAudio(audioBuffer) {
    // Whisper expects 16kHz mono float32
    const wav = new wavefile.WaveFile(audioBuffer);
    wav.toSampleRate(16000);
    let samples = wav.getSamples();

    // Handle stereo -> mono
    if (Array.isArray(samples)) {
      // If stereo, average channels
      if (samples.length > 1) {
        const mono = new Float32Array(samples[0].length);
        for (let i = 0; i < samples[0].length; i++) {
          let sum = 0;
          for (let ch = 0; ch < samples.length; ch++) {
            sum += samples[ch][i];
          }
          mono[i] = sum / samples.length;
        }
        samples = mono;
      } else {
        samples = samples[0];
      }
    }

    // Ensure Float32Array
    if (!(samples instanceof Float32Array)) {
      samples = Float32Array.from(samples);
    }

    // Normalize if values are outside [-1, 1] range (likely int16 raw values)
    // Check first few samples to guess
    let maxVal = 0;
    for (let i = 0; i < Math.min(samples.length, 1000); i++) {
      const abs = Math.abs(samples[i]);
      if (abs > maxVal) maxVal = abs;
    }

    if (maxVal > 1.0) {
      // Scan whole array for true max to avoid clipping
      let trueMax = 0;
      for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > trueMax) trueMax = abs;
      }

      if (trueMax > 0) {
        for (let i = 0; i < samples.length; i++) {
          samples[i] /= trueMax;
        }
      }
    }

    return samples;
  }
}

module.exports = new OfflineAI();
