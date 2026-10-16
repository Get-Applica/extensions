/**
 * Applica Extension - Background Service Worker
 * Toggles the drawer when the extension icon is clicked. Job sites use activeTab + scripting
 * (user gesture) for on-demand injection. host_permissions cover the Applica app origin only
 * (API + sign-in). content_scripts on app.getapplica.com handle the login callback page.
 */

importScripts('lib/extension-config.js', 'lib/constants.js');

const REOPEN_DRAWER_TS_KEY = globalThis.ApplicaConstants.STORAGE.REOPEN_DRAWER_TS;
const REOPEN_DRAWER_TTL_MS = 20000;
const CONTENT_SCRIPT_FILES = [
  'lib/config.js',
  'lib/extension-config.js',
  'lib/constants.js',
  'content/content.js',
];

async function injectDrawerContentScript(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content/content.css']
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  });
}

async function toggleDrawerOnTab(tabId) {
  await injectDrawerContentScript(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      window.dispatchEvent(new CustomEvent('applica-drawer-toggle'));
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'applica-will-navigate' && message.url) {
    chrome.storage.local.set({ [REOPEN_DRAWER_TS_KEY]: Date.now() }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === 'applica-open-tab' && message.url) {
    chrome.storage.local.set({ [REOPEN_DRAWER_TS_KEY]: Date.now() }, () => {
      chrome.tabs.create({ url: message.url, active: true }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({ ok: true });
      });
    });
    return true;
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  toggleDrawerOnTab(tab.id).catch((e) => {
    console.debug('Applica: could not toggle drawer', e);
  });
});

/** Keyboard shortcuts (seeker manifest `commands`). Invoking one grants activeTab on the page. */
const DRAWER_COMMANDS = new Set(['analyze-job', 'fill-form']);

async function runDrawerCommandOnTab(tabId, command) {
  await injectDrawerContentScript(tabId);
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (cmd) => {
      window.dispatchEvent(new CustomEvent('applica-drawer-command', { detail: { command: cmd } }));
    },
    args: [command]
  });
}

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (!DRAWER_COMMANDS.has(command) || !tab?.id) return;
    runDrawerCommandOnTab(tab.id, command).catch((e) => {
      console.debug('Applica: could not run shortcut', command, e);
    });
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab?.url?.startsWith('http')) return;
  chrome.storage.local.get([REOPEN_DRAWER_TS_KEY], (data) => {
    const ts = data[REOPEN_DRAWER_TS_KEY];
    if (!ts || Date.now() - ts > REOPEN_DRAWER_TTL_MS) return;
    injectDrawerContentScript(tabId).catch((e) => {
      console.debug('Applica: could not re-inject for reopen', e);
    });
  });
});
