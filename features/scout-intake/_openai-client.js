'use strict';

let dotenvLoaded = false;

function maybeLoadDotenv() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    require('dotenv/config');
  } catch {
    // Ignore missing dotenv in deployed environments.
  }
}

function getOpenAiApiKey({ required = true } = {}) {
  let key = process.env.OPENAI_API_KEY;
  if (!key) {
    maybeLoadDotenv();
    key = process.env.OPENAI_API_KEY;
  }
  if (!key && required) {
    throw new Error('OPENAI_API_KEY is not set.');
  }
  return key || null;
}

/**
 * Call the OpenAI Images API (gpt-image-1).
 *
 * @param {object} params  — body sent to /v1/images/generations
 * @param {object} [opts]
 * @param {string} [opts.apiKey]
 * @returns {Promise<object>} parsed JSON response
 */
async function callOpenAiImages(params, { apiKey } = {}) {
  const resolvedApiKey = apiKey || getOpenAiApiKey();
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${resolvedApiKey}`,
    },
    body: JSON.stringify(params),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI API ${response.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

module.exports = { callOpenAiImages, getOpenAiApiKey };
