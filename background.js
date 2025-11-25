// Background service worker for Sigma HMIS Extension
// Handles opening the options page from content scripts

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
  }
  return true; // Keep the message channel open for async response
});

