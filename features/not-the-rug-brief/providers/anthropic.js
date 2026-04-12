// providers/anthropic.js — Anthropic provider adapter
//
// Wraps the existing anthropic-client.js into the shared provider adapter shape:
//   { providerName: string, messages: { create(params): Promise } }
//
// The messages.create interface is intentionally identical to the raw Anthropic
// API shape so existing callers require no changes to response handling.

require('../load-env');
const { createAnthropicClient } = require('../anthropic-client');

function createAnthropicAdapter() {
  const client = createAnthropicClient();
  return {
    providerName: 'anthropic',
    messages: client.messages,
  };
}

module.exports = { createAnthropicAdapter };
