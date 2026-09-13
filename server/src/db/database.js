const fs = require('fs');
const path = require('path');
const lodash = require('lodash');

const dataDir = path.join(__dirname, '..', '..', 'data');
const dbFile = path.join(dataDir, 'db.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readState() {
  if (!fs.existsSync(dbFile)) {
    return {};
  }

  const raw = fs.readFileSync(dbFile, 'utf-8').trim();

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

function writeState(state) {
  fs.writeFileSync(dbFile, JSON.stringify(state, null, 2));
}

const state = readState();

// A fresh copy of lodash so mixing in write() below does not affect
// any other part of the app that might use lodash directly.
const _ = lodash.runInContext();

// Wrap value() so calling write() at the end of a chain persists the
// current state to disk and then returns whatever the chain computed.
_.prototype.write = _.wrap(_.prototype.value, function (func) {
  const result = func.apply(this);
  writeState(state);
  return result;
});

const db = {
  get(collectionName) {
    if (!Array.isArray(state[collectionName])) {
      state[collectionName] = [];
    }
    return _.chain(state[collectionName]);
  },

  defaults(defaultState) {
    Object.keys(defaultState).forEach((key) => {
      if (!(key in state)) {
        state[key] = defaultState[key];
      }
    });
    return {
      write() {
        writeState(state);
        return state;
      }
    };
  }
};

db.defaults({
  adminUsers: [],
  vehicles: [],
  contacts: [],
  crashEvents: [],
  simStatuses: []
}).write();

module.exports = db;
