// Load saved settings
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['apiEndpoint'], (result) => {
    if (result.apiEndpoint) {
      document.getElementById('apiEndpoint').value = result.apiEndpoint;
    } else {
      // Set default
      document.getElementById('apiEndpoint').value = 'http://192.168.1.169:5000';
    }
  });
});

// Save settings
document.getElementById('optionsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const endpoint = document.getElementById('apiEndpoint').value.trim();
  const errorDiv = document.getElementById('endpointError');
  const successDiv = document.getElementById('successMessage');
  
  // Hide previous messages
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';
  
  // Validate endpoint
  if (!endpoint) {
    errorDiv.textContent = 'Please enter an API endpoint';
    errorDiv.style.display = 'block';
    return;
  }
  
  // Basic URL validation
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Protocol must be http:// or https://');
    }
  } catch (err) {
    errorDiv.textContent = 'Please enter a valid URL (e.g., http://192.168.1.169:5000)';
    errorDiv.style.display = 'block';
    return;
  }
  
  // Save to storage
  chrome.storage.local.set({ apiEndpoint: endpoint }, () => {
    if (chrome.runtime.lastError) {
      errorDiv.textContent = 'Error saving settings: ' + chrome.runtime.lastError.message;
      errorDiv.style.display = 'block';
    } else {
      successDiv.style.display = 'block';
      setTimeout(() => {
        successDiv.style.display = 'none';
      }, 3000);
    }
  });
});

