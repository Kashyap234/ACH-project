// backend/services/chatbotLLM.js — kept for backward compatibility, chatbot.js now initializes Gemini directly
// This file is no longer the primary LLM caller — chatbot.js manages its own Gemini instance.
module.exports = {
  callLLM: async (prompt) => {
    console.warn('[chatbotLLM] callLLM called from legacy path');
    return 'I am your ACH AI assistant. Please ask me anything about the system.';
  }
};
