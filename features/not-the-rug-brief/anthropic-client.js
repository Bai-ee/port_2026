require('./load-env');

function requireAnthropicApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY for Not The Rug brief pipeline');
  }
  return apiKey;
}

async function createMessage(params) {
  const apiKey = requireAnthropicApiKey();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(params),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 400)}`);
  }

  return JSON.parse(text);
}

function createAnthropicClient() {
  return {
    messages: {
      create: createMessage,
    },
  };
}

module.exports = {
  createAnthropicClient,
  requireAnthropicApiKey,
};
