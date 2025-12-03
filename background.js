// Background service worker for Sigma HMIS Extension
// Handles opening options page and API requests (bypasses CORS and mixed content)

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }
  
  // Handle API fetch requests from content script
  if (request.action === 'fetch') {
    handleFetch(request)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ 
        error: true, 
        message: error.message,
        name: error.name
      }));
    return true; // Keep channel open for async response
  }
  
  return true;
});

async function handleFetch(request) {
  const { url, options } = request;
  
  console.log('[Background] Fetching:', url, options?.method || 'GET');
  
  try {
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers || {},
      body: options?.body || undefined,
    });
    
    // Get response text first
    const text = await response.text();
    
    // Try to parse as JSON
    let data = null;
    let isJson = false;
    try {
      data = JSON.parse(text);
      isJson = true;
    } catch (e) {
      data = text;
    }
    
    console.log('[Background] Response:', {
      url,
      status: response.status,
      ok: response.ok,
      isJson
    });
    
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      data: data,
      isJson: isJson,
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch (error) {
    console.error('[Background] Fetch error:', error);
    
    return {
      error: true,
      message: error.message,
      name: error.name
    };
  }
}
