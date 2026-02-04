console.log("Bahmni HMIS & Inventory Helper - Starting");

let currentUuid = null;
let overlay = null;
let isCollapsed = false;
let currentVisitData = null;
let refreshInProgress = false;
let currentDisplayId = null;
let orderingSessionActive = false;

// ==========================================
// AUTHENTICATION STATE & HELPERS
// ==========================================

let authTokens = {
  access: null,
  refresh: null
};

// ==========================================
// BACKGROUND FETCH HELPER (bypasses CORS and mixed content)
// ==========================================

async function backgroundFetch(url, options = {}) {
  console.log('[HMIS] backgroundFetch REQUEST:', {
    url,
    method: options.method || 'GET',
    headers: Object.keys(options.headers || {})
  });
  
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: 'fetch',
        url: url,
        options: {
          method: options.method || 'GET',
          headers: options.headers || {},
          body: options.body || undefined
        }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[HMIS] backgroundFetch ERROR:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (response.error) {
          console.error('[HMIS] backgroundFetch FAILED:', response);
          const error = new Error(response.message);
          error.name = response.name;
          reject(error);
          return;
        }
        
        console.log('[HMIS] backgroundFetch RESPONSE:', {
          url,
          status: response.status,
          ok: response.ok
        });
        
        // Create a response-like object
        resolve({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: { 
            get: (name) => response.headers?.[name.toLowerCase()],
            entries: () => Object.entries(response.headers || {})
          },
          json: async () => response.isJson ? response.data : JSON.parse(response.data),
          text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
          data: response.data
        });
      }
    );
  });
}

// Load tokens from storage
async function loadAuthTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authAccess', 'authRefresh'], (result) => {
      authTokens.access = result.authAccess || null;
      authTokens.refresh = result.authRefresh || null;
      resolve(authTokens);
    });
  });
}

// Save tokens to storage
async function saveAuthTokens(access, refresh) {
  authTokens.access = access;
  authTokens.refresh = refresh;
  return new Promise((resolve) => {
    chrome.storage.local.set({
      authAccess: access,
      authRefresh: refresh
    }, resolve);
  });
}

// Clear tokens
async function clearAuthTokens() {
  authTokens.access = null;
  authTokens.refresh = null;
  return new Promise((resolve) => {
    chrome.storage.local.remove(['authAccess', 'authRefresh'], resolve);
  });
}

async function handleLogout() {
  console.log('[HMIS] Header logout triggered');
  orderingSessionActive = false;
  updateHeaderControls();
  await clearAuthTokens();
  renderOrderingTab();
}

function updateRefreshButtonState() {
  const refreshBtn = overlay?.querySelector('#hmis-refresh-btn');
  if (!refreshBtn) return;
  refreshBtn.disabled = refreshInProgress || !currentUuid;
}

function updateHeaderControls() {
  updateRefreshButtonState();
  const headerLogoutBtn = overlay?.querySelector('#hmis-header-logout-btn');
  if (!headerLogoutBtn) return;
  headerLogoutBtn.style.display = orderingSessionActive ? 'inline-flex' : 'none';
}

// Check if authenticated
async function isAuthenticated() {
  await loadAuthTokens();
  if (!authTokens.access) return false;
  
  // Verify token is still valid
  try {
    const baseUrl = await getApiEndpoint();
    const url = `${baseUrl}/api/token/verify/`;
    
    console.log('[API] Calling endpoint: POST', url);
    const response = await backgroundFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: authTokens.access })
    });
    
    return response.ok;
  } catch (err) {
    return false;
  }
}

// Refresh access token
async function refreshAccessToken() {
  if (!authTokens.refresh) {
    throw new Error('No refresh token available');
  }
  
  const baseUrl = await getApiEndpoint();
  const url = `${baseUrl}/api/token/refresh/`;
  
  console.log('[API] Calling endpoint: POST', url);
  const response = await backgroundFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh: authTokens.refresh })
  });
  
  if (!response.ok) {
    await clearAuthTokens();
    throw new Error('Token refresh failed');
  }
  
  const data = await response.json();
  await saveAuthTokens(data.access, data.refresh || authTokens.refresh);
  return data.access;
}

// Get API endpoint from storage
async function getApiEndpoint() {
  const storage = await new Promise((resolve) => {
    chrome.storage.local.get(['apiEndpoint'], resolve);
  });
  const endpoint = storage.apiEndpoint || 'http://192.168.1.169:5000';
  // Remove trailing slash if present, we'll add it per endpoint as needed
  return endpoint.replace(/\/$/, '');
}

// Get authenticated fetch headers
async function getAuthHeaders() {
  await loadAuthTokens();
  
  if (!authTokens.access) {
    return {};
  }
  
  return {
    'Authorization': `Bearer ${authTokens.access}`,
    'Content-Type': 'application/json'
  };
}

// Authenticated fetch with auto-refresh
async function authenticatedFetch(url, options = {}) {
  console.log('[Auth] authenticatedFetch called for URL:', url);
  console.log('[Auth] Options:', JSON.stringify(options, null, 2));
  
  await loadAuthTokens();
  console.log('[Auth] Tokens loaded - Access:', !!authTokens.access, 'Refresh:', !!authTokens.refresh);
  
  // Add auth header
  const headers = await getAuthHeaders();
  console.log('[Auth] Headers to send:', Object.keys(headers));
  options.headers = { ...headers, ...options.headers };
  
  console.log('[Auth] Final request options:', {
    method: options.method || 'GET',
    headers: Object.keys(options.headers),
    hasBody: !!options.body
  });
  
  try {
    console.log('[Auth] Making fetch request...');
    let response = await backgroundFetch(url, options);
    console.log('[Auth] Fetch completed - Status:', response.status, 'OK:', response.ok);
    
    // If 401, try to refresh token
    if (response.status === 401 && authTokens.refresh) {
      console.log('[Auth] Got 401, attempting token refresh...');
      try {
        const newAccess = await refreshAccessToken();
        console.log('[Auth] Token refreshed successfully');
        // Retry with new token
        options.headers['Authorization'] = `Bearer ${newAccess}`;
        console.log('[Auth] Retrying request with new token...');
        response = await backgroundFetch(url, options);
        console.log('[Auth] Retry completed - Status:', response.status, 'OK:', response.ok);
      } catch (err) {
        console.error('[Auth] Token refresh failed:', err);
        await clearAuthTokens();
        throw new Error('Authentication expired. Please login again.');
      }
    }
    
    return response;
  } catch (err) {
    console.error('[Auth] Fetch error:', err);
    console.error('[Auth] Error name:', err.name);
    console.error('[Auth] Error message:', err.message);
    console.error('[Auth] Error stack:', err.stack);
    throw err;
  }
}

// ==========================================
// PART 1: PATIENT DATA EXTRACTION & OVERLAY
// ==========================================

function extractPatient() {
  const img = document.querySelector('.patient-image');
  const nameEl = document.querySelector('.patient-name');

  let uuid = null;
  let displayId = null;

  if (img && img.src) {
    const match = img.src.match(/patientUuid=([a-z0-9-]+)/i);
    if (match) uuid = match[1];
  }

  if (nameEl && nameEl.innerText) {
    const match = nameEl.innerText.match(/\((.*?)\)/);
    if (match) displayId = match[1];
  }

  if (uuid && uuid !== currentUuid) {
    currentUuid = uuid;
    currentDisplayId = displayId;
    console.log("Bahmni patient detected:", { uuid, displayId });
    showOverlay(uuid, displayId);
  }
}

async function showOverlay(uuid, displayId) {
  if (overlay) overlay.remove();
  currentDisplayId = displayId || currentDisplayId;

  overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.bottom = '0';
  overlay.style.right = '0';
  overlay.style.zIndex = '9999';
  overlay.style.background = '#fff';
  overlay.style.border = '1px solid #ddd';
  overlay.style.padding = '0';
  overlay.style.borderRadius = '10px';
  overlay.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  overlay.style.fontFamily = 'system-ui, sans-serif';
  overlay.style.minWidth = '650px';
  overlay.style.maxWidth = '800px';
  overlay.style.transition = 'all 0.3s ease';
  overlay.style.margin = '0 20px 20px 0';

  overlay.innerHTML = `
    <div id="hmis-overlay-expanded">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; background: #00897B; color: white; border-radius: 10px 10px 0 0;">
        <strong style="font-size: 15px;">Sigma HMIS Visit Summary</strong>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button id="hmis-refresh-btn" title="Refresh summary" style="background:none;border:1px solid rgba(255,255,255,0.4);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;transition:background 0.2s;">Refresh</button>
          <button id="hmis-settings-btn" title="Settings" style="background:none;border:1px solid rgba(255,255,255,0.4);color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;transition:background 0.2s;">Settings</button>
          <button id="hmis-header-logout-btn" title="Logout" style="background:#c62828;border:none;color:#fff;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px;transition:opacity 0.2s;display:none;">Logout</button>
          <button id="hmis-minimize-btn" title="Minimize" style="background:none; border:none; font-size:20px; cursor:pointer; color:white; padding:0;">-</button>
        </div>
      </div>
      
      <div id="hmis-tabs" style="display: flex; border-bottom: 1px solid #e0e0e0; background: #f5f5f5;">
        <button class="hmis-tab active" data-tab="visit" style="flex:1; padding:10px; border:none; background:white; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid #00897B; outline:none;">Visit</button>
        <button class="hmis-tab" data-tab="patient" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; outline:none;">Patient</button>
        <button class="hmis-tab" data-tab="clinic" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; outline:none;">Clinic</button>
        <button class="hmis-tab" data-tab="insurance" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; display:none; outline:none;">Insurance</button>
        <button class="hmis-tab" data-tab="dental" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; display:none; outline:none;">Dental</button>
        <button class="hmis-tab" data-tab="notes" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; display:none; outline:none;">Notes</button>
        <button class="hmis-tab" data-tab="ordering" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; outline:none;">💊 Ordering</button>
        <button class="hmis-tab" data-tab="settings" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; outline:none;">⚙ Settings</button>
      </div>

      <div id="hmis-content" style="padding: 16px; max-height: 400px; overflow-y: auto; font-size: 13px;">
        <em style="color: #666;">Loading data...</em>
      </div>
    </div>
    
    <div id="hmis-overlay-collapsed" style="display:none; justify-content:center; align-items:center; width:48px; height:48px; background:#00897B; color:#fff; border-radius:50%; font-size:24px; cursor:pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.3); transition: transform 0.2s ease;">
      <span style="margin-top: -2px;">+</span>
    </div>
  `;

  document.body.appendChild(overlay);

  const minimizeBtn = overlay.querySelector('#hmis-minimize-btn');
  const settingsBtn = overlay.querySelector('#hmis-settings-btn');
  const refreshBtn = overlay.querySelector('#hmis-refresh-btn');
  const headerLogoutBtn = overlay.querySelector('#hmis-header-logout-btn');
  const expanded = overlay.querySelector('#hmis-overlay-expanded');
  const collapsed = overlay.querySelector('#hmis-overlay-collapsed');

  // SETUP TABS FIRST - BEFORE ANY ERROR CAN OCCUR
  setupTabs();

  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (!currentUuid || refreshInProgress) return;
      refreshInProgress = true;
      updateRefreshButtonState();
      try {
        await showOverlay(currentUuid, currentDisplayId);
      } catch (err) {
        console.error('[HMIS] Manual refresh failed:', err);
      } finally {
        refreshInProgress = false;
        updateRefreshButtonState();
      }
    });
  }

  // Settings button click handler - switch to settings tab
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const settingsTab = overlay.querySelector('[data-tab="settings"]');
    if (settingsTab) {
      settingsTab.click();
    }
  });

  // Settings button hover effects
  settingsBtn.addEventListener('mouseenter', () => {
    settingsBtn.style.background = 'rgba(255,255,255,0.2)';
  });
  settingsBtn.addEventListener('mouseleave', () => {
    settingsBtn.style.background = 'none';
  });

  if (headerLogoutBtn) {
    headerLogoutBtn.addEventListener('click', async () => {
      await handleLogout();
    });
  }

  minimizeBtn.addEventListener('click', () => {
    expanded.style.display = 'none';
    collapsed.style.display = 'flex';
    overlay.style.background = 'transparent';
    overlay.style.border = 'none';
    overlay.style.boxShadow = 'none';
    overlay.style.margin = '0';
    overlay.style.bottom = '0';
    overlay.style.right = '0';
  });

  collapsed.addEventListener('click', () => {
    expanded.style.display = 'block';
    collapsed.style.display = 'none';
    overlay.style.background = '#fff';
    overlay.style.border = '1px solid #ddd';
    overlay.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    overlay.style.margin = '0 20px 20px 0';
  });

  collapsed.addEventListener('mouseenter', () => {
    collapsed.style.transform = 'scale(1.1)';
  });

  collapsed.addEventListener('mouseleave', () => {
    collapsed.style.transform = 'scale(1)';
  });

  updateRefreshButtonState();

  try {
    // Get API endpoint from storage - use exactly as configured
    const baseUrl = await getApiEndpoint();
    const url = `${baseUrl}/api/visits/summary/by-patient-uuid/${uuid}/`;
    
    console.log('[API] Calling endpoint: GET', url);
    console.log("Fetching visit summary from:", url);
    
    // Use regular fetch (authentication only needed for ordering tab)
    const res = await backgroundFetch(url);
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    console.log("HMIS visit summary retrieved:", data);

    // STORE THE DATA GLOBALLY
    currentVisitData = data;

    // STORE CLINIC DATA IN CHROME STORAGE
    const clinicId = data.clinic_id || data.clinic_details?.id || data.clinic?.id;
    const clinicName = data.clinic_name || data.clinic_details?.name || data.clinic?.name;
    const clinicCode = data.clinic_code || data.clinic_details?.code || data.clinic?.code;
    
    console.log("Extracted clinic info:", { clinicId, clinicName, clinicCode });
    
    if (clinicId) {
      chrome.storage.local.set({ 
        clinicId: clinicId,
        clinicName: clinicName,
        clinicCode: clinicCode,
        patientUuid: uuid,
        lastUpdated: new Date().toISOString()
      }, () => {
        console.log("Clinic data saved to storage");
        
        if (isTreatmentPage()) {
          console.log("Clinic data ready - injecting inventory monitor now");
          injectInventoryMonitor(() => {
            (async () => {
              await sendClinicDataToInjectedScript({
                clinicId: clinicId,
                clinicName: clinicName,
                clinicCode: clinicCode,
                patientUuid: uuid
              });
            })();
          });
        }
      });
    } else {
      console.warn("No clinic ID found in visit summary data");
      if (isTreatmentPage()) {
        injectInventoryMonitor();
      }
    }

    const insuranceTab = overlay.querySelector('[data-tab="insurance"]');
    const dentalTab = overlay.querySelector('[data-tab="dental"]');
    
    if (data.mode_of_payment === 'insurance' && data.insurance_scheme_details) {
      insuranceTab.style.display = 'block';
    }
    
    if (data.dental_treatments && data.dental_treatments.length > 0) {
      dentalTab.style.display = 'block';
    }
    
    const notesTab = overlay.querySelector('[data-tab="notes"]');
    if (data.notes && data.notes.length > 0) {
      notesTab.style.display = 'block';
    }

    // Show the visit tab with data
    showTab('visit');

  } catch (err) {
    let errorMessage = 'Unable to connect to the API server.';
    
    if (err.message.includes('Failed to fetch')) {
      errorMessage = 'Could not reach the API server. Please check your connection and ensure the server is running.';
    } else if (err.message.includes('CORS')) {
      errorMessage = 'The API server may not allow requests from this origin. Please check your server configuration.';
    } else if (err.message.includes('401') || err.message.includes('403')) {
      errorMessage = 'Authentication issue. Please check your login credentials or API permissions.';
    } else if (err.message.includes('404')) {
      errorMessage = 'The requested endpoint was not found. Please verify your API endpoint configuration.';
    } else if (err.message) {
      errorMessage = `Connection error: ${err.message}`;
    }
    
    overlay.querySelector('#hmis-content').innerHTML = `
      <div style="color:#d32f2f; padding:12px; background:#ffebee; border-radius:4px;">
        <strong>⚠️ Unable to Load Visit Summary</strong><br/>
        <small style="margin-top:8px; display:block;">${errorMessage}</small><br/>
        <small style="margin-top:8px; display:block;">
          <a href="#" id="configure-endpoint-link" style="color:#00897B; text-decoration:underline; cursor:pointer;">Configure API endpoint</a>
        </small>
      </div>
    `;
    
    // Add click handler for the configure link
    const configureLink = overlay.querySelector('#configure-endpoint-link');
    if (configureLink) {
      configureLink.addEventListener('click', (e) => {
        e.preventDefault();
        const settingsTab = overlay.querySelector('[data-tab="settings"]');
        if (settingsTab) {
          settingsTab.click();
        }
      });
    }
    
    console.error("Error fetching visit summary:", err);
  }
}

function setupTabs() {
  const tabs = overlay.querySelectorAll('.hmis-tab');
  tabs.forEach(tab => {
    // Remove existing listeners to avoid duplicates
    const newTab = tab.cloneNode(true);
    tab.parentNode.replaceChild(newTab, tab);
  });
  
  // Re-query after cloning
  const tabsAfterClone = overlay.querySelectorAll('.hmis-tab');
  tabsAfterClone.forEach(tab => {
    tab.addEventListener('click', () => {
      tabsAfterClone.forEach(t => {
        t.classList.remove('active');
        t.style.background = 'transparent';
        t.style.borderBottomColor = 'transparent';
      });
      tab.classList.add('active');
      tab.style.background = 'white';
      tab.style.borderBottomColor = '#00897B';
      
      // Show the selected tab
      showTab(tab.dataset.tab);
    });
  });
}

function showTab(tabName) {
  const content = overlay.querySelector('#hmis-content');
  
  switch(tabName) {
    case 'visit':
      if (currentVisitData) {
        content.innerHTML = renderVisitTab(currentVisitData);
      } else {
        content.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No visit data available</p>';
      }
      break;
    case 'patient':
      if (currentVisitData?.patient_details) {
        content.innerHTML = renderPatientTab(currentVisitData.patient_details);
      } else {
        content.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No patient data available</p>';
      }
      break;
    case 'clinic':
      if (currentVisitData?.clinic_details) {
        content.innerHTML = renderClinicTab(currentVisitData.clinic_details);
      } else {
        content.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No clinic data available</p>';
      }
      break;
    case 'insurance':
      if (currentVisitData?.insurance_scheme_details) {
        // Merge date_joined from insurance_scheme if not in insurance_scheme_details
        const insuranceData = { ...currentVisitData.insurance_scheme_details };
        if (!insuranceData.date_joined && currentVisitData?.insurance_scheme?.date_joined) {
          insuranceData.date_joined = currentVisitData.insurance_scheme.date_joined;
        }
        content.innerHTML = renderInsuranceTab(insuranceData);
      } else {
        content.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No insurance information available</p>';
      }
      break;
    case 'dental':
      if (currentVisitData?.dental_treatments) {
        content.innerHTML = renderDentalTab(currentVisitData.dental_treatments);
      } else {
        content.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No dental treatments recorded</p>';
      }
      break;
    case 'notes':
      if (currentVisitData?.notes) {
        content.innerHTML = renderNotesTab(currentVisitData.notes);
      } else {
        content.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No notes recorded</p>';
      }
      break;
    case 'settings':
      renderSettingsTab();
      break;
    case 'ordering':
      renderOrderingTab();
      break;
  }
}

function formatPhoneNumber(phone) {
  if (!phone) return '—';
  
  const cleaned = phone.replace(/[^\d+]/g, '');
  
  if (cleaned.startsWith('+')) {
    const countryCode = cleaned.substring(0, cleaned.length - 10);
    const remaining = cleaned.substring(cleaned.length - 10);
    const areaCode = remaining.substring(0, 3);
    const firstPart = remaining.substring(3, 6);
    const secondPart = remaining.substring(6, 10);
    return `${countryCode} (${areaCode}) ${firstPart}-${secondPart}`;
  }
  
  if (cleaned.length === 10) {
    return `(${cleaned.substring(0, 3)}) ${cleaned.substring(3, 6)}-${cleaned.substring(6)}`;
  }
  
  return phone;
}

function formatCurrency(value) {
  if (!value) return '—';
  
  // Try to parse as number
  const numValue = parseFloat(value);
  if (isNaN(numValue)) return value;
  
  // Format with thousand separators and MWK currency
  return `MWK ${numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function createTable(rows) {
  return `
    <table style="width:100%; border-collapse: collapse; font-size: 13px;">
      ${rows.map(([label, value]) => `
        <tr style="border-bottom: 1px solid #f0f0f0;">
          <td style="padding: 12px 8px; font-weight: 500; color: #555; width: 40%;">${label}</td>
          <td style="padding: 12px 8px; color: #212121;">${value || '—'}</td>
        </tr>
      `).join('')}
    </table>
  `;
}

function renderVisitTab(data) {
  const visitDate = new Date(data.visit_date);
  const rows = [
    ['Visit Type', data.visit_type_name],
    ['Status', `<span style="background: ${data.status === 'active' ? '#e8f5e9' : '#fff3e0'}; color: ${data.status === 'active' ? '#2e7d32' : '#f57c00'}; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">${data.status.toUpperCase()}</span>`],
    ['Visit Date', visitDate.toLocaleString()],
    ['Mode of Payment', `<span style="text-transform: capitalize; font-weight: 500;">${data.mode_of_payment}</span>`],
    ['Clinic', `${data.clinic_name} (${data.clinic_code})`],
    ['Dentist Visit', data.is_dentist_visit ? 'Yes' : 'No'],
    ['Created By', data.created_by_name],
    ['Created At', data.created_at]
  ];

  if (data.requires_pre_authorization) {
    rows.push(['Pre-Auth Required', 'Yes']);
    if (data.pre_authorization_number) {
      rows.push(['Pre-Auth Number', data.pre_authorization_number]);
    }
  }

  return `
    <div style="margin-bottom: 12px;">
      <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #00897B;">Visit Information</h3>
      ${createTable(rows)}
    </div>
  `;
}

function renderPatientTab(patient) {
  const dob = new Date(patient.dob);
  const formattedPhone = formatPhoneNumber(patient.phone_number);
  const rows = [
    ['Full Name', patient.full_name],
    ['Identifier', patient.customer_identifier],
    ['Phone Number', formattedPhone],
    ['Gender', patient.gender],
    ['Date of Birth', dob.toLocaleDateString()],
    ['Age', `${patient.age} years`],
    ['DOB Estimated', patient.dob_is_estimated ? 'Yes' : 'No'],
    ['Synced to OpenMRS', patient.has_synced_to_openmrs ? 'Yes' : 'No'],
    ['Status', patient.is_active ? 'Active' : 'Inactive']
  ];

  return `
    <div style="margin-bottom: 12px;">
      <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #00897B;">Patient Details</h3>
      ${createTable(rows)}
    </div>
  `;
}

function renderClinicTab(clinic) {
  const rows = [
    ['Name', clinic.name],
    ['Code', clinic.code],
    ['Email', clinic.email || '—'],
    ['Phone', clinic.phone || '—'],
    ['Address', clinic.address || '—'],
    ['City', clinic.city || '—'],
    ['Country', clinic.country || '—']
  ];

  return `
    <div style="margin-bottom: 12px;">
      <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #00897B;">Clinic Information</h3>
      ${createTable(rows)}
    </div>
  `;
}

function renderInsuranceTab(insurance) {
  if (!insurance) {
    return '<p style="color: #666; text-align: center; padding: 20px;">No insurance information available</p>';
  }

  const rows = [
    ['Scheme Name', insurance.scheme_name],
    ['Insurance Company', insurance.insurance_company_name],
    ['Membership Number', insurance.membership_number],
    ['Suffix', insurance.suffix]
  ];

  // Add date_joined if available
  if (insurance.date_joined) {
    rows.push(['Date Joined', insurance.date_joined]);
  }

  return `
    <div style="margin-bottom: 12px;">
      <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #00897B;">Insurance Details</h3>
      ${createTable(rows)}
    </div>
  `;
}

function renderDentalTab(treatments) {
  if (!treatments || treatments.length === 0) {
    return '<p style="color: #666; text-align: center; padding: 20px;">No dental treatments recorded</p>';
  }

  const treatmentsList = treatments.map(treatment => `
    <div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; margin-bottom: 12px; background: #fafafa;">
      ${createTable([
        ['Treatment', treatment.name || 'N/A'],
        ['Tooth Number', treatment.tooth_number || 'N/A'],
        ['Status', treatment.status || 'N/A'],
        ['Date', treatment.date ? new Date(treatment.date).toLocaleDateString() : 'N/A'],
        ['Notes', treatment.notes || '—']
      ])}
    </div>
  `).join('');

  return `
    <div style="margin-bottom: 12px;">
      <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #00897B;">Dental Treatments</h3>
      ${treatmentsList}
    </div>
  `;
}

function renderNotesTab(notes) {
  if (!notes || notes.length === 0) {
    return '<p style="color: #666; text-align: center; padding: 20px;">No notes recorded</p>';
  }

  const notesList = notes.map(note => {
    const createdDate = new Date(note.created_at);
    const updatedDate = new Date(note.updated_at);
    const isUpdated = note.updated_at !== note.created_at;
    
    return `
      <div style="border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; margin-bottom: 12px; background: #fafafa;">
        ${createTable([
          ['Label', note.label || 'N/A'],
          ['Value', formatCurrency(note.value)],
          ['Created By', note.created_by_name || 'N/A'],
          ['Created At', createdDate.toLocaleString()],
          isUpdated ? ['Updated By', note.updated_by_name || 'N/A'] : null,
          isUpdated ? ['Updated At', updatedDate.toLocaleString()] : null
        ].filter(row => row !== null))}
      </div>
    `;
  }).join('');

  return `
    <div style="margin-bottom: 12px;">
      <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #00897B;">Visit Notes</h3>
      ${notesList}
    </div>
  `;
}

function renderSettingsTab() {
  const content = overlay.querySelector('#hmis-content');
  
  // Load current endpoint
  chrome.storage.local.get(['apiEndpoint'], (result) => {
    const currentEndpoint = result.apiEndpoint || 'http://192.168.1.169:5000';
    
    content.innerHTML = `
      <div style="padding: 0;">
        <h3 style="margin: 0 0 16px 0; font-size: 14px; color: #00897B;">API Configuration</h3>
        
        <form id="hmis-settings-form">
          <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333; font-size: 13px;">
              API Endpoint Base URL
            </label>
            <input 
              type="text" 
              id="hmis-api-endpoint" 
              value="${currentEndpoint}"
              placeholder="http://192.168.1.169:5000"
              style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; box-sizing: border-box;"
            />
            <div id="hmis-endpoint-error" style="color: #d32f2f; font-size: 12px; margin-top: 5px; display: none;"></div>
            <div style="font-size: 12px; color: #666; margin-top: 5px;">
              Enter the base URL of your API server. Include the protocol (http:// or https://) and port if needed.
              <br><br>
              <strong>Examples:</strong>
              <ul style="margin: 5px 0; padding-left: 20px;">
                <li>http://192.168.1.169:5000</li>
                <li>http://localhost:8000</li>
                <li>https://api.example.com</li>
              </ul>
            </div>
          </div>
          
          <div style="display: flex; gap: 8px;">
            <button 
              type="button"
              id="hmis-test-connection-btn"
              style="background: #fff; color: #00897B; border: 1px solid #00897B; padding: 10px 20px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; flex: 1;"
            >
              Test Connection
            </button>
            <button 
              type="submit" 
              style="background: #00897B; color: white; border: none; padding: 10px 20px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; flex: 1;"
            >
              Save Settings
            </button>
          </div>
        </form>
        
        <div id="hmis-connection-status" style="padding: 12px; border-radius: 4px; margin-top: 16px; display: none; font-size: 13px;"></div>
        
        <div id="hmis-settings-success" style="background: #e8f5e9; color: #2e7d32; padding: 12px; border-radius: 4px; margin-top: 16px; display: none; font-size: 13px;">
          Settings saved successfully!
        </div>
        
        <div style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px; margin-top: 16px; border-radius: 4px; font-size: 12px; color: #1565C0;">
          <strong>ℹ️ Troubleshooting Tips</strong>
          <p style="margin: 5px 0 0 0;">
            If you're experiencing connection issues:
          </p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li>Ensure your API server is running and accessible</li>
            <li>Verify the endpoint URL is correct (including protocol and port)</li>
            <li>Check that your server allows requests from this origin (CORS settings)</li>
            <li>Default endpoint is <code>http://192.168.1.169:5000</code></li>
          </ul>
        </div>
      </div>
    `;
    
    // Add form submit handler
    const form = content.querySelector('#hmis-settings-form');
    const endpointInput = content.querySelector('#hmis-api-endpoint');
    const errorDiv = content.querySelector('#hmis-endpoint-error');
    const successDiv = content.querySelector('#hmis-settings-success');
    const testBtn = content.querySelector('#hmis-test-connection-btn');
    const connectionStatus = content.querySelector('#hmis-connection-status');
    
    // Test connection button handler
    testBtn.addEventListener('click', async () => {
      const endpoint = endpointInput.value.trim();
      
      // Hide previous messages
      errorDiv.style.display = 'none';
      connectionStatus.style.display = 'none';
      
      // Validate endpoint format
      if (!endpoint) {
        errorDiv.textContent = 'Please enter an API endpoint first';
        errorDiv.style.display = 'block';
        return;
      }
      
      try {
        const url = new URL(endpoint);
        if (!['http:', 'https:'].includes(url.protocol)) {
          throw new Error('Invalid protocol');
        }
      } catch (err) {
        errorDiv.textContent = 'Please enter a valid URL first';
        errorDiv.style.display = 'block';
        return;
      }
      
      // Show testing status
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      connectionStatus.style.display = 'block';
      connectionStatus.style.background = '#fff3e0';
      connectionStatus.style.color = '#e65100';
      connectionStatus.innerHTML = '⏳ Testing connection...';
      
      try {
        const baseUrl = endpoint.replace(/\/$/, '');
        const testUrl = `${baseUrl}/api/visits/summary/by-patient-uuid/test/`;
        
        console.log('[API] Calling endpoint: GET', testUrl);
        console.log('[Settings] Testing connection to:', testUrl);
        const response = await backgroundFetch(testUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        
        // If we get here, connection worked (even if 404, it means the server responded)
        connectionStatus.style.background = '#e8f5e9';
        connectionStatus.style.color = '#2e7d32';
        connectionStatus.innerHTML = '✅ Connection successful! The endpoint is reachable.';
        
      } catch (err) {
        let statusMessage = '';
        let statusColor = '#d32f2f';
        let statusBg = '#ffebee';
        
        if (err.message.includes('Failed to fetch')) {
          statusMessage = '❌ Could not reach the server. Please check that:<br>';
          statusMessage += '<ul style="margin: 8px 0; padding-left: 20px;">';
          statusMessage += '<li>The server is running</li>';
          statusMessage += '<li>The URL is correct</li>';
          statusMessage += '<li>Your network connection is active</li>';
          statusMessage += '</ul>';
          statusMessage += '<br>Try opening <a href="' + endpoint + '" target="_blank" style="color: #00897B; text-decoration: underline;">' + endpoint + '</a> in a new tab to verify the server is accessible.';
        } else if (err.message.includes('CORS')) {
          statusMessage = '⚠️ CORS error: The server may not allow requests from this origin. Please check your server\'s CORS configuration.';
        } else if (err.message.includes('ERR_CONNECTION_REFUSED')) {
          statusMessage = '❌ Connection refused. The server may not be running, or the URL/port is incorrect.';
        } else {
          statusMessage = '❌ Connection failed: ' + err.message;
        }
        
        connectionStatus.style.background = statusBg;
        connectionStatus.style.color = statusColor;
        connectionStatus.innerHTML = statusMessage;
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';
      }
    });
    
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const endpoint = endpointInput.value.trim();
      
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
          
          // Optionally reload the visit data with new endpoint
          if (currentUuid) {
            console.log('Settings saved, reloading visit data with new endpoint...');
            setTimeout(() => {
              showOverlay(currentUuid, null);
            }, 500);
          }
        }
      });
    });
  });
}

function renderOrderingTab() {
  const content = overlay.querySelector('#hmis-content');
  
  // Check authentication first
  isAuthenticated().then(authenticated => {
    orderingSessionActive = authenticated;
    updateHeaderControls();
    if (!authenticated) {
      // Show login form
      renderLoginForm(content);
    } else {
      // Show ordering interface
      renderOrderingInterface(content);
    }
  });
}

function renderLoginForm(container) {
  container.innerHTML = `
    <div style="padding: 0;">
      <h3 style="margin: 0 0 16px 0; font-size: 14px; color: #00897B;">Authentication Required</h3>
      <p style="font-size: 12px; color: #666; margin-bottom: 16px;">
        Please login to access ordering and billing functionality.
      </p>
      
      <form id="hmis-login-form">
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333; font-size: 13px;">
            Email
          </label>
          <input 
            type="email" 
            id="hmis-login-email" 
            required
            placeholder="your.email@example.com"
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; box-sizing: border-box;"
          />
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333; font-size: 13px;">
            Password
          </label>
          <input 
            type="password" 
            id="hmis-login-password" 
            required
            placeholder="Enter your password"
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; box-sizing: border-box;"
          />
        </div>
        
        <button 
          type="submit" 
          style="background: #00897B; color: white; border: none; padding: 10px 20px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; width: 100%;"
        >
          Login
        </button>
      </form>
      
      <div id="hmis-login-error" style="color: #d32f2f; font-size: 12px; margin-top: 12px; display: none;"></div>
      <div id="hmis-login-success" style="background: #e8f5e9; color: #2e7d32; padding: 12px; border-radius: 4px; margin-top: 16px; display: none; font-size: 13px;">
        Login successful! Loading ordering interface...
      </div>
    </div>
  `;
  
  const form = container.querySelector('#hmis-login-form');
  const errorDiv = container.querySelector('#hmis-login-error');
  const successDiv = container.querySelector('#hmis-login-success');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';
    
    const email = container.querySelector('#hmis-login-email').value.trim();
    const password = container.querySelector('#hmis-login-password').value;
    
    if (!email || !password) {
      errorDiv.textContent = 'Please enter both email and password';
      errorDiv.style.display = 'block';
      return;
    }
    
    try {
      const baseUrl = await getApiEndpoint();
      const url = `${baseUrl}/api/token/`;
      
      console.log('[API] Calling endpoint: POST', url);
      const response = await backgroundFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Login failed. Please check your credentials.');
      }
      
      const data = await response.json();
      await saveAuthTokens(data.access, data.refresh);
      orderingSessionActive = true;
      updateHeaderControls();
      
      successDiv.style.display = 'block';
      
      // Reload ordering interface after successful login
      setTimeout(() => {
        renderOrderingInterface(container);
      }, 1000);
      
    } catch (err) {
      errorDiv.textContent = err.message || 'Login failed. Please try again.';
      errorDiv.style.display = 'block';
    }
  });
}

async function renderOrderingInterface(container) {
  // Check if we have visit data
  if (!currentVisitData) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #666;">
        <p>Please wait for visit data to load, or navigate to a patient page.</p>
      </div>
    `;
    return;
  }
  
  const clinicId = currentVisitData.clinic_id || currentVisitData.clinic_details?.id || currentVisitData.clinic?.id;
  const visitId = currentVisitData.visit_id || currentVisitData.id;
  
  if (!clinicId) {
    container.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #d32f2f;">
        <p>No clinic information available. Cannot proceed with ordering.</p>
      </div>
    `;
    return;
  }

  // Payment / pricelist context
  const modeOfPayment = currentVisitData.mode_of_payment || currentVisitData.visit?.mode_of_payment;
  const insuranceName =
    currentVisitData.insurance_scheme_details?.scheme_name ||
    currentVisitData.insurance?.scheme_name ||
    null;
  const pricelistName =
    currentVisitData.pricelist?.name ||
    (modeOfPayment === 'insurance' ? insuranceName : null) ||
    'Standard Pricelist';

  // Render the interface (no location selection for now)
  container.innerHTML = `
    <div style="padding: 0;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <h3 style="margin: 0; font-size: 14px; color: #00897B;">Ordering & Billing</h3>
      </div>

      <div style="margin-bottom: 16px; font-size: 12px; color: #555;">
        <div><strong>Payment Mode:</strong> ${modeOfPayment || 'cash'}</div>
        <div><strong>Price List:</strong> ${pricelistName}</div>
        ${insuranceName ? `<div><strong>Insurance Scheme:</strong> ${insuranceName}</div>` : ''}
      </div>
      
      <div id="hmis-products-section" style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333; font-size: 13px;">
          Search Products
        </label>
        <div style="display: flex; gap: 8px;">
          <input 
            type="text" 
            id="hmis-product-search" 
            placeholder="Search products..."
            style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; box-sizing: border-box;"
          />
          <button 
            id="hmis-load-products-btn"
            style="background: #00897B; color: white; border: none; padding: 10px 16px; border-radius: 4px; font-size: 13px; cursor: pointer; white-space: nowrap;"
          >
            Load Products
          </button>
        </div>
        
        <div id="hmis-products-list" style="margin-top: 12px; max-height: 200px; overflow-y: auto; border: 1px solid #e0e0e0; border-radius: 4px; padding: 8px;">
          <p style="text-align: center; color: #666;">Click "Load Products" or products will auto-load...</p>
        </div>
      </div>
      
      <div id="hmis-cart-section" style="margin-top: 16px;">
        <h4 style="margin: 0 0 12px 0; font-size: 13px; color: #00897B;">Items to Dispense</h4>
        <div id="hmis-cart-items" style="border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; min-height: 60px;">
          <p style="color: #999; text-align: center; margin: 0;">No items added yet</p>
        </div>
        
        <div style="margin-top: 12px;">
          <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333; font-size: 13px;">
            Notes (Optional)
          </label>
          <textarea 
            id="hmis-dispense-notes" 
            placeholder="Additional notes for this dispensation..."
            style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; box-sizing: border-box; min-height: 60px; resize: vertical;"
          ></textarea>
        </div>
        
        <button 
          id="hmis-submit-dispense-btn"
          disabled
          style="background: #00897B; color: white; border: none; padding: 12px 24px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; width: 100%; margin-top: 16px; opacity: 0.5;"
        >
          Create Order
        </button>
      </div>
      
      <div id="hmis-dispense-status" style="margin-top: 16px; display: none;"></div>
    </div>
  `;
  
  // Setup event handlers
  setupOrderingHandlers(container, clinicId, visitId);
}

function setupOrderingHandlers(container, clinicId, visitId) {
  const productsSection = container.querySelector('#hmis-products-section');
  const loadProductsBtn = container.querySelector('#hmis-load-products-btn');
  const productSearch = container.querySelector('#hmis-product-search');
  const productsList = container.querySelector('#hmis-products-list');
  const cartItems = container.querySelector('#hmis-cart-items');
  const submitBtn = container.querySelector('#hmis-submit-dispense-btn');
  const dispenseNotes = container.querySelector('#hmis-dispense-notes');
  const statusDiv = container.querySelector('#hmis-dispense-status');
  
  let selectedLocationId = null; // optional, kept for future stock-deduction support
  let products = [];
  let cart = [];
  
  // Load all products from Odoo catalog - FIXED
  async function loadAllProducts() {
    try {
      console.log('[Ordering] Loading all products from Odoo catalog');
      
      // Check authentication first
      const authenticated = await isAuthenticated();
      console.log('[Ordering] Authentication status:', authenticated);
      
      if (!authenticated) {
        console.warn('[Ordering] Not authenticated - switching to login form');
        renderLoginForm(container);
        return;
      }
      
      const baseUrl = await getApiEndpoint();
      const url = `${baseUrl}/api/odoo/products/?get_all=true`;
      
      console.log('[API] Calling endpoint: GET', url);
      console.log('[Ordering] API Endpoint:', baseUrl);
      console.log('[Ordering] Full URL:', url);
      
      // Check authentication
      await loadAuthTokens();
      console.log('[Ordering] Auth token available:', !!authTokens.access);
      if (authTokens.access) {
        console.log('[Ordering] Auth token (first 20 chars):', authTokens.access.substring(0, 20) + '...');
      }
      
      loadProductsBtn.disabled = true;
      loadProductsBtn.textContent = 'Loading...';
      productsList.innerHTML = '<p style="text-align: center; color: #666;">Loading products...</p>';
      
      console.log('[Ordering] Making authenticated fetch request...');
      const response = await authenticatedFetch(url);
      
      console.log('[Ordering] Response status:', response.status);
      console.log('[Ordering] Response ok:', response.ok);
      console.log('[Ordering] Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Ordering] Response error body:', errorText);
        let errorMessage = `Failed to load products (Status: ${response.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorJson.message || errorMessage;
          console.error('[Ordering] Parsed error:', errorJson);
        } catch (e) {
          console.error('[Ordering] Could not parse error as JSON:', e);
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      console.log('[Ordering] Products loaded successfully:', data);
      console.log('[Ordering] Data type:', typeof data);
      console.log('[Ordering] Is array:', Array.isArray(data));
      console.log('[Ordering] Data keys:', data ? Object.keys(data) : 'null');
      
      // Handle response format: Odoo products endpoint returns { status: 'success', data: [...] }
      let productsArray = null;
      
      if (Array.isArray(data)) {
        productsArray = data;
        console.log('[Ordering] Direct array response, products count:', productsArray.length);
      } else if (data && typeof data === 'object') {
        // Check for nested data structure
        if (data.data && Array.isArray(data.data)) {
          // Response wrapped in { status, data: [...] }
          productsArray = data.data;
          console.log('[Ordering] Loaded products from data.data:', productsArray.length);
        } else if (data.results && Array.isArray(data.results)) {
          // Paginated response
          productsArray = data.results;
          console.log('[Ordering] Loaded products from paginated response:', productsArray.length);
        } else {
          console.warn('[Ordering] Unexpected response format - no array found in data:', data);
          console.warn('[Ordering] Response keys:', Object.keys(data));
          if (data.data) {
            console.warn('[Ordering] data.data type:', typeof data.data, 'isArray:', Array.isArray(data.data));
          }
        }
      }
      
      if (!productsArray) {
        console.error('[Ordering] Could not extract products array from response');
        products = [];
      } else {
        products = productsArray;
      }
      
      // Map Odoo products to expected format
      products = products.map(p => ({
        ...p,
        // Use id as product_id for dispensation (Odoo product ID)
        product_id: p.id,
        // Map Odoo fields to expected format
        product_name: p.name || p.product_name,
        product_code: p.default_code || p.product_code || p.code,
        list_price: p.list_price || 0,
        odoo_id: p.id
      }));
      
      console.log('[Ordering] Products array length:', products.length);
      if (products.length > 0) {
        console.log('[Ordering] First product:', products[0]);
        console.log('[Ordering] Product odoo_id:', products[0].odoo_id, 'product_id:', products[0].product_id);
      }
      
      renderProductsList();
      
    } catch (err) {
      console.error('[Ordering] Error loading products:', err);
      console.error('[Ordering] Error name:', err.name);
      console.error('[Ordering] Error message:', err.message);
      console.error('[Ordering] Error stack:', err.stack);
      
      let errorMessage = 'Unable to load products.';
      
      // Provide friendly, specific error messages
      if (err.message.includes('Failed to fetch')) {
        // Check if it's an HTTPS/HTTP mismatch
        const storage = await new Promise((resolve) => {
          chrome.storage.local.get(['apiEndpoint'], resolve);
        });
        const endpoint = storage.apiEndpoint || '';
        
        if (endpoint.startsWith('https://') && (endpoint.includes('localhost') || endpoint.includes('127.0.0.1') || endpoint.includes('192.168.'))) {
          errorMessage = '⚠️ Protocol mismatch: The development server uses HTTP, not HTTPS. Please update your API endpoint to use http:// instead of https://';
          console.error('[Ordering] HTTPS/HTTP mismatch detected');
        } else {
          errorMessage = '⚠️ Could not reach the server. Please check your connection and verify the API endpoint is correct.';
          console.error('[Ordering] Network error - server may be unreachable');
        }
      } else if (err.message.includes('401')) {
        errorMessage = '🔐 Authentication required. Please login again to access products.';
        console.error('[Ordering] Authentication error - token may be expired');
      } else if (err.message.includes('403')) {
        errorMessage = '🚫 Access denied. You may not have permission to access this resource.';
        console.error('[Ordering] Permission error');
      } else if (err.message.includes('404')) {
        errorMessage = '❓ Endpoint not found. Please verify your API endpoint configuration.';
        console.error('[Ordering] Not found error');
      } else if (err.message) {
        errorMessage = `⚠️ ${err.message}`;
      }
      
      productsList.innerHTML = `<div style="color: #d32f2f; text-align: center; padding: 12px; background: #ffebee; border-radius: 4px;">${errorMessage}</div>`;
    } finally {
      loadProductsBtn.disabled = false;
      loadProductsBtn.textContent = 'Load Products';
    }
  }
  
  // Load products button handler
  if (loadProductsBtn) {
    loadProductsBtn.addEventListener('click', () => {
      loadAllProducts();
    });
  } else {
    console.error('[Ordering] Load products button not found!');
  }
  
  // Auto-load products when ordering tab is opened - FIXED
  console.log('[Ordering] Auto-loading products on tab open...');
  setTimeout(() => {
    loadAllProducts();
  }, 100);
  
  // Render products list
  function renderProductsList() {
    const searchTerm = productSearch.value.toLowerCase();
    // Get product IDs that are already in the cart
    const cartProductIds = new Set(cart.map(item => item.product_id));
    
    const filtered = products.filter(p => {
      // Filter out products already in cart
      if (cartProductIds.has(p.product_id)) {
        return false;
      }
      // Apply search filter (handle Odoo and mapped fields)
      if (!searchTerm) return true;
      const nameMatch = (p.product_name || p.name || '').toLowerCase().includes(searchTerm);
      const codeMatch = (p.product_code || p.default_code || p.code || '').toLowerCase().includes(searchTerm);
      return nameMatch || codeMatch;
    });
    
    if (filtered.length === 0) {
      productsList.innerHTML = '<p style="text-align: center; color: #666;">No products found</p>';
      return;
    }
    
    productsList.innerHTML = filtered.map(product => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; border-bottom: 1px solid #f0f0f0;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px;">
            ${product.product_name || product.name || 'Unknown Product'}
          </div>
          <div style="font-size: 11px; color: #666;">
            Code: ${product.product_code || product.default_code || product.code || 'N/A'}
            ${product.list_price ? ` | Price: ${product.list_price}` : ''}
          </div>
        </div>
        <button 
          class="hmis-add-product-btn" 
          data-product-id="${product.product_id || product.odoo_id || product.id}"
          data-product-name="${product.product_name || product.name || 'Unknown'}"
          style="background: #00897B; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 11px; cursor: pointer;"
        >
          Add
        </button>
      </div>
    `).join('');
    
    // Add click handlers - remove old listeners first to prevent duplicates
    productsList.querySelectorAll('.hmis-add-product-btn').forEach(btn => {
      // Clone button to remove all existing event listeners
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      
      newBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const productId = parseInt(newBtn.dataset.productId); // This is Odoo product ID
        const productName = newBtn.dataset.productName;
        
        console.log('[Ordering] Add button clicked for product:', productId, productName);

        // Find full product to get price
        const product = products.find(
          p => p.product_id === productId || p.id === productId || p.odoo_id === productId
        );
        const unitPrice = product && typeof product.list_price !== 'undefined'
          ? parseFloat(product.list_price) || 0
          : 0;
        
        // Check if already in cart
        const existing = cart.find(item => item.product_id === productId);
        if (existing) {
          console.log('[Ordering] Product already in cart, incrementing quantity from', existing.quantity, 'to', existing.quantity + 1);
          existing.quantity += 1;
        } else {
          console.log('[Ordering] Adding new product to cart:', productId, productName, 'quantity: 1');
          cart.push({
            product_id: productId, // Store Odoo product ID for dispensation
            product_name: productName,
            unit_price: unitPrice,
            quantity: 1
          });
        }
        
        console.log('[Ordering] Cart after add:', JSON.stringify(cart, null, 2));
        updateCart();
        renderProductsList(); // Refresh products list to remove added item
      });
    });
  }
  
  // Product search handler
  productSearch.addEventListener('input', () => {
    if (products.length > 0) {
      renderProductsList();
    }
  });
  
  // Update cart display
  function updateCart() {
    if (cart.length === 0) {
      cartItems.innerHTML = '<p style="color: #999; text-align: center; margin: 0;">No items added yet</p>';
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.5';
    } else {
      const cartTotal = cart.reduce(
        (sum, item) => sum + (item.unit_price || 0) * (parseFloat(item.quantity) || 0),
        0
      );

      const rowsHtml = cart.map((item, index) => {
        const lineTotal = (item.unit_price || 0) * (parseFloat(item.quantity) || 0);
        return `
          <div style="display: flex; align-items: center; padding: 6px 8px; border-bottom: 1px solid #f0f0f0;">
            <div style="flex: 2; min-width: 0;">
              <div style="font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px;">
                ${item.product_name}
              </div>
            </div>
            <div style="flex: 0.9; font-size: 12px; text-align: right; padding: 0 4px;">
              ${formatCurrency(item.unit_price || 0)}
            </div>
            <div style="flex: 0.9; text-align: right; padding: 0 4px;">
              <input 
                type="number" 
                min="1" 
                step="1"
                value="${item.quantity}"
                data-index="${index}"
                class="hmis-cart-quantity"
                style="width: 70px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; text-align: right;"
              />
            </div>
            <div style="flex: 1.1; font-size: 12px; text-align: right; padding: 0 4px;">
              ${formatCurrency(lineTotal)}
            </div>
            <div style="width: 70px; text-align: right; padding-left: 4px;">
              <button 
                class="hmis-remove-product-btn" 
                data-index="${index}"
                style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;"
              >
                Remove
              </button>
            </div>
          </div>
        `;
      }).join('');

      cartItems.innerHTML = `
        <div style="display: flex; font-size: 11px; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid #e0e0e0; background: #fafafa;">
          <div style="flex: 2;">Item</div>
          <div style="flex: 0.9; text-align: right; padding: 0 4px;">Unit</div>
          <div style="flex: 0.9; text-align: right; padding: 0 4px;">Qty</div>
          <div style="flex: 1.1; text-align: right; padding: 0 4px;">Total</div>
          <div style="width: 70px;"></div>
        </div>
        ${rowsHtml}
        <div style="display: flex; justify-content: flex-end; padding: 8px 8px 4px 8px; border-top: 1px solid #e0e0e0; margin-top: 4px; font-size: 13px; font-weight: 600;">
          <span style="margin-right: 8px;">Total:</span>
          <span>${formatCurrency(cartTotal)}</span>
        </div>
      `;
      
      // Add handlers for quantity changes and removals
      cartItems.querySelectorAll('.hmis-cart-quantity').forEach(input => {
        input.addEventListener('change', (e) => {
          const index = parseInt(e.target.dataset.index);
          const newQty = parseInt(e.target.value, 10) || 0;
          if (newQty > 0) {
            cart[index].quantity = newQty;
          } else {
            cart.splice(index, 1);
          }
          updateCart();
          renderProductsList(); // Refresh products list if item was removed
        });
      });
      
      cartItems.querySelectorAll('.hmis-remove-product-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.dataset.index);
          cart.splice(index, 1);
          updateCart();
          renderProductsList(); // Refresh products list to show removed item
        });
      });
      
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
    }
  }
  
  // Submit dispensation
  submitBtn.addEventListener('click', async () => {
    if (cart.length === 0) {
      return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    statusDiv.style.display = 'none';
    
    try {
      const storage = await new Promise((resolve) => {
        chrome.storage.local.get(['apiEndpoint'], resolve);
      });
      const baseUrl = await getApiEndpoint();
      const url = `${baseUrl}/api/inventory/product-dispensation/from-helper/`;
      
      console.log('[API] Calling endpoint: POST', url);
      console.log('[Ordering] Submitting dispensation to:', baseUrl);
      // Get pricelist_id from visit data - check multiple possible locations
      const pricelistId = currentVisitData?.pricelist?.id || 
                         currentVisitData?.pricelist_id || 
                         null;
      
      console.log('[Ordering] Current visit data:', JSON.stringify(currentVisitData, null, 2));
      console.log('[Ordering] Pricelist ID extracted:', pricelistId);
      console.log('[Ordering] Pricelist object:', currentVisitData?.pricelist);
      
      const payload = {
        clinic_id: clinicId,
        visit_id: visitId,
        patient_uuid: currentUuid,
        items: cart.map(item => ({
          product_id: item.product_id, // This is odoo_id
          quantity: item.quantity.toString()
        })),
        notes: dispenseNotes.value.trim() || 'Order created via helper',
        sales_order_id: null,
        location_id: selectedLocationId ? parseInt(selectedLocationId) : null
      };
      
      // Only include pricelist_id if it exists (don't send null)
      if (pricelistId) {
        payload.pricelist_id = pricelistId;
        console.log('[Ordering] Including pricelist_id in payload:', pricelistId);
      } else {
        console.warn('[Ordering] No pricelist_id found in visit data - not including in payload');
      }
      
      console.log('[Ordering] Sales order payload:', JSON.stringify(payload, null, 2));
      
      const response = await authenticatedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (response.status === 201) {
        const data = await response.json();
        statusDiv.style.display = 'block';
        statusDiv.style.background = '#e8f5e9';
        statusDiv.style.color = '#2e7d32';
        statusDiv.style.padding = '12px';
        statusDiv.style.borderRadius = '4px';
        statusDiv.innerHTML = `
          ✅ Order created successfully!<br>
          Sales Order ID: ${data.sales_order_id || 'N/A'}<br>
          <small>Sales order created/updated.</small>
        `;
        
        // Clear cart completely - use length = 0 to maintain reference
        console.log('[Ordering] Clearing cart after successful submission. Cart before clear:', cart.length, 'items');
        console.log('[Ordering] Cart contents before clear:', JSON.stringify(cart, null, 2));
        cart.length = 0; // Clear array in place to ensure all references see the cleared cart
        console.log('[Ordering] Cart after clear:', cart.length, 'items');
        console.log('[Ordering] Cart contents after clear:', JSON.stringify(cart, null, 2));
        
        updateCart();
        dispenseNotes.value = '';
        
        // Reload products to refresh catalog and re-render list (this will show all products again since cart is empty)
        await loadAllProducts();
        
        // Double-check: ensure products list is refreshed to show all products (cart is now empty)
        console.log('[Ordering] Re-rendering products list after cart clear. Cart length:', cart.length);
        renderProductsList();
        
      } else if (response.status === 400) {
        const errorData = await response.json();
        statusDiv.style.display = 'block';
        statusDiv.style.background = '#ffebee';
        statusDiv.style.color = '#d32f2f';
        statusDiv.style.padding = '12px';
        statusDiv.style.borderRadius = '4px';
        
        let errorMsg = 'Insufficient stock for some items:<br><ul style="margin: 8px 0; padding-left: 20px;">';
        if (errorData.items) {
          errorData.items.forEach(item => {
            errorMsg += `<li>${item.product_name || `Product ${item.product_id}`}: Requested ${item.requested}, Available ${item.available}</li>`;
          });
        }
        errorMsg += '</ul>';
        statusDiv.innerHTML = errorMsg;
        
      } else {
        throw new Error(`Server error: ${response.status}`);
      }
      
    } catch (err) {
      statusDiv.style.display = 'block';
      statusDiv.style.background = '#ffebee';
      statusDiv.style.color = '#d32f2f';
      statusDiv.style.padding = '12px';
      statusDiv.style.borderRadius = '4px';
      
      let friendlyMessage = 'An error occurred while creating the order.';
      if (err.message.includes('Failed to fetch')) {
        friendlyMessage = '⚠️ Could not reach the server. Please check your connection and try again.';
      } else if (err.message.includes('401') || err.message.includes('403')) {
        friendlyMessage = '🔐 Authentication issue. Please login again and try submitting.';
      } else if (err.message) {
        friendlyMessage = `⚠️ ${err.message}`;
      }
      
      statusDiv.innerHTML = `❌ ${friendlyMessage}`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Order';
    }
  });
}

// ==========================================
// PART 2: INVENTORY MONITOR INJECTION
// ==========================================

let inventoryMonitorInjected = false;
let lastHash = window.location.hash;

// Check if we're on the treatment/medications page
function isTreatmentPage() {
  const url = window.location.href;
  const hash = window.location.hash;
  
  // Check if URL or hash contains /dashboard/treatment or /treatment
  const isTreatment = url.includes('/dashboard/treatment') || 
                      url.includes('/treatment') ||
                      hash.includes('/dashboard/treatment') ||
                      hash.includes('/treatment');
  
  return isTreatment;
}

// Check and inject inventory monitor if on treatment page
function checkAndInjectInventoryMonitor() {
  const currentHash = window.location.hash;
  const wasOnTreatment = lastHash.includes('/dashboard/treatment') || lastHash.includes('/treatment');
  const isOnTreatment = isTreatmentPage();
  
  // Reset injection flag if we navigated away from treatment page
  if (wasOnTreatment && !isOnTreatment) {
    console.log("Navigated away from treatment page - resetting injection flag");
    inventoryMonitorInjected = false;
  }
  
  lastHash = currentHash;
  
  // If on treatment page, inject it (or send clinic data if already injected)
  if (isOnTreatment) {
    if (!inventoryMonitorInjected) {
      console.log("On treatment page - checking for clinic data and injecting monitor");
      
      // Load clinic data from storage and inject
      chrome.storage.local.get(['clinicId', 'clinicName', 'clinicCode', 'patientUuid'], (result) => {
        if (result.clinicId) {
          console.log("Found persisted clinic ID:", result.clinicId);
          injectInventoryMonitor(async () => {
            console.log("Sending persisted clinic data to injected script:", result);
            await sendClinicDataToInjectedScript(result);
          });
        } else {
          console.log("No clinic data in storage yet - will inject when clinic data is available");
          // Still inject, it can request clinic data later
          injectInventoryMonitor();
        }
      });
    } else {
      // Already injected, but make sure clinic data is sent
      console.log("On treatment page - monitor already injected, sending clinic data");
      chrome.storage.local.get(['clinicId', 'clinicName', 'clinicCode', 'patientUuid'], async (result) => {
        if (result.clinicId) {
          console.log("Sending persisted clinic data to already-injected script:", result);
          await sendClinicDataToInjectedScript(result);
        }
      });
    }
  }
}

function injectInventoryMonitor(onInjectedCallback) {
  // Only inject on treatment page
  if (!isTreatmentPage()) {
    console.log("Not on treatment page - skipping inventory monitor injection");
    return;
  }
  if (inventoryMonitorInjected) {
    console.log("Inventory monitor already injected");
    // If already injected, still send clinic data if callback provided
    if (onInjectedCallback) {
      setTimeout(() => {
        chrome.storage.local.get(['clinicId', 'clinicName', 'clinicCode', 'patientUuid'], async (result) => {
          if (result.clinicId) {
            console.log("Sending stored clinic data to already-injected script:", result);
            await sendClinicDataToInjectedScript(result);
          }
        });
        onInjectedCallback();
      }, 100);
    }
    return;
  }
  
  console.log("Injecting Inventory Monitor into page context");

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    this.remove();
    inventoryMonitorInjected = true;
    console.log("Inventory monitor injected successfully");
    
    // Wait a bit for the script to initialize
    setTimeout(() => {
      // Send initial clinic data if available
      chrome.storage.local.get(['clinicId', 'clinicName', 'clinicCode', 'patientUuid'], async (result) => {
        if (result.clinicId) {
          console.log("Sending stored clinic data to injected script:", result);
          await sendClinicDataToInjectedScript(result);
        } else {
          console.log("No stored clinic data available yet");
        }
      });
      
      // Call the callback if provided
      if (onInjectedCallback) {
        onInjectedCallback();
      }
    }, 200);
  };
  (document.head || document.documentElement).appendChild(script);
}

async function sendClinicDataToInjectedScript(clinicData) {
  // Get API endpoint from storage - use exactly as configured
  const apiEndpoint = await getApiEndpoint();
  
  window.postMessage({
    type: 'CLINIC_DATA',
    data: {
      ...clinicData,
      apiEndpoint: apiEndpoint
    }
  }, '*');
  console.log("Clinic data and API endpoint sent to injected script:", { ...clinicData, apiEndpoint });
}

// Listen for requests from injected script
window.addEventListener('message', async function(event) {
  if (event.source !== window) return;
  
  if (event.data.type === 'INVENTORY_CHECK') {
    console.log("Inventory check result:", event.data);
  }
  
  if (event.data.type === 'REQUEST_CLINIC_DATA') {
    chrome.storage.local.get(['clinicId', 'clinicName', 'clinicCode', 'patientUuid'], (result) => {
      sendClinicDataToInjectedScript(result);
    });
  }
  
  // Handle fetch requests from injected script (bypasses CORS/mixed content)
  if (event.data.type === 'FETCH_REQUEST') {
    const { requestId, url, options } = event.data;
    console.log('[HMIS] Fetch request from injected script:', url);
    
    try {
      const response = await backgroundFetch(url, options);
      const data = await response.json().catch(() => response.data);
      
      window.postMessage({
        type: 'FETCH_RESPONSE',
        requestId: requestId,
        success: true,
        data: data,
        status: response.status,
        ok: response.ok
      }, '*');
    } catch (err) {
      console.error('[HMIS] Fetch error for injected script:', err);
      window.postMessage({
        type: 'FETCH_RESPONSE',
        requestId: requestId,
        success: false,
        error: err.message
      }, '*');
    }
  }
});

// ==========================================
// INITIALIZATION
// ==========================================

// Initialize auth tokens on load
loadAuthTokens().then(() => {
  console.log("Auth tokens loaded");
});

// Start patient extraction (this will trigger visit data fetch and inventory injection)
extractPatient();
setInterval(extractPatient, 2000);

// Check for treatment page on initial load
checkAndInjectInventoryMonitor();

// Listen for hash changes (SPA navigation)
window.addEventListener('hashchange', () => {
  console.log("Hash changed - checking if on treatment page");
  checkAndInjectInventoryMonitor();
});

// Also check periodically in case hash changes aren't detected
setInterval(() => {
  const currentHash = window.location.hash;
  if (currentHash !== lastHash) {
    console.log("Hash changed (detected via interval) - checking if on treatment page");
    checkAndInjectInventoryMonitor();
  }
}, 1000);

console.log("Bahmni HMIS & Inventory Helper - Ready (monitoring for treatment page navigation)");
