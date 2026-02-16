const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function listModels() {
  const apiKey = process.env.GEN_AI_API_KEY;
  if (!apiKey) {
    console.error("No API Key found in .env");
    return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  try {
    // The SDK doesn't have a direct listModels but we can try to use the rest client or just guess
    // Actually, we can use the fetch API if we want to be sure
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );
    const data = await response.json();
    console.log("Available Models:", JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error listing models:", error);
  }
}

listModels();
