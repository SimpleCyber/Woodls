import whisper from "node-whisper";

const result = await whisper("./models/inputVoice.wav", {
  model: "./models/small.pt",   // or tiny, base, small, medium, large-v3
});

console.log(result.text);
