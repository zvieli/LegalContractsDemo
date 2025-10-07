// disputeHistory.js
// Backend module for dispute history management
// Stores arbitration results, batch status, contract verification, etc.

const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../data/dispute_history.json');

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function addDisputeRecord(caseId, batchId, record) {
  const history = loadHistory();
  if (!history[caseId]) history[caseId] = [];
  history[caseId].push({ batchId, ...record });
  saveHistory(history);
}

function getDisputeHistory(caseId) {
  const history = loadHistory();
  return history[caseId] || [];
}

module.exports = {
  addDisputeRecord,
  getDisputeHistory
};
