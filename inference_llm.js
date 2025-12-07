const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

// Load config
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Select LLM by name (default: first one, or pass as CLI arg)
const llmName = process.argv[2] || config.llms[0].name;
const llm = config.llms.find(l => l.name.toLowerCase() === llmName.toLowerCase());

if (!llm) {
  console.error(`LLM "${llmName}" not found in config. Available: ${config.llms.map(l => l.name).join(', ')}`);
  process.exit(1);
}

console.log(`Using LLM: ${llm.name} (${llm.MODEL})`);

const client = new OpenAI({
  baseURL: llm.baseURL,
  apiKey: llm.token,
  timeout: 60_000,
});

const MODEL = llm.MODEL;
const PROMPT = llm.prompt;

(async () => {
  try {
    const res = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: PROMPT }],
      temperature: 0.2,
    });
    console.log(res.choices[0].message.content);
  } catch (err) {
    // Print as much as possible
    console.error('Auth/Request failed.');
    console.error('Status:', err.status);
    try { console.error('Body:', await err.response.text()); } catch {}
    console.error('Message:', err.message);
  }
})();
