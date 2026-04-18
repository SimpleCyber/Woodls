const { spawn } = require("child_process");
const path = require("path");

const streamExe = path.join(__dirname, "assets", "whisper", "stream.exe");
const modelBin = path.join(__dirname, "assets", "whisper", "ggml-base.en.bin");

console.log("Spawning:", streamExe);

try {
  const p = spawn(streamExe, ["-m", modelBin, "-c", "0"]);
  p.on("error", (err) => console.error("Error:", err));
  p.stdout.on("data", (data) => console.log("STDOUT:", data.toString()));
  p.stderr.on("data", (data) => console.log("STDERR:", data.toString()));
  p.on("close", (code) => console.log("Closed with code", code));
} catch (e) {
  console.error("Catch:", e);
}
