const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

async function testChat() {
  const apiKey = process.env.GEN_AI_API_KEY;
  // Use the model that was previously 404ing
  const modelName = "gemini-2.5-flash-lite";

  console.log(`Testing with model: ${modelName}`);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  try {
    const result = await model.generateContent("Hello, are you working?");
    const response = await result.response;
    console.log("Response:", response.text());
    console.log("SUCCESS: Chat is working!");
  } catch (error) {
    console.error("FAILED: Chat still not working.", error);
  }
}

testChat();
