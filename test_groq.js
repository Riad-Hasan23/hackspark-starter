const axios = require('axios');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const isGroq = true;
const url = 'https://api.groq.com/openai/v1/chat/completions';
const modelToUse = 'llama3-8b-8192';

const messages = [
  { role: 'system', content: 'test' },
  { role: 'user', content: 'hello' }
];

axios.post(url, {
  model: modelToUse,
  messages: messages,
  temperature: 0.7
}, { headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` } })
.then(res => console.log(res.data.choices[0].message.content))
.catch(err => {
  console.error(err.response ? err.response.data : err.message);
});
