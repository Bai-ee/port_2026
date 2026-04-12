// knowledge.js — Shared helpers for client-specific knowledge files

const fs = require('fs');
const path = require('path');

function readJSONSync(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadBrandVoice(clientId) {
  return readJSONSync(path.join(__dirname, 'knowledge', clientId, 'brand-voice.json'));
}

function loadGameKnowledge(clientId) {
  return readJSONSync(path.join(__dirname, 'knowledge', clientId, 'game-knowledge-supplement.json'));
}

function loadBriefContext(clientId) {
  return readJSONSync(path.join(__dirname, 'knowledge', clientId, 'brief-context.json'));
}

module.exports = {
  loadBrandVoice,
  loadGameKnowledge,
  loadBriefContext,
};
