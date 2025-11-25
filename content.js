console.log("Bahmni HMIS & Inventory Helper - Starting");

let currentUuid = null;
let overlay = null;
let isCollapsed = false;
let currentVisitData = null;

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
    console.log("Bahmni patient detected:", { uuid, displayId });
    showOverlay(uuid, displayId);
  }
}

async function showOverlay(uuid, displayId) {
  if (overlay) overlay.remove();

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
  overlay.style.minWidth = '420px';
  overlay.style.maxWidth = '500px';
  overlay.style.transition = 'all 0.3s ease';
  overlay.style.margin = '0 20px 20px 0';

  overlay.innerHTML = `
    <div id="hmis-overlay-expanded">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #e0e0e0; background: #00897B; color: white; border-radius: 10px 10px 0 0;">
        <strong style="font-size: 15px;">Sigma HMIS Visit Summary</strong>
        <div style="display: flex; align-items: center; gap: 12px;">
          <button id="hmis-settings-btn" title="Settings" style="background:none; border:none; font-size:16px; cursor:pointer; color:white; padding:4px 6px; display:flex; align-items:center; justify-content:center; border-radius:4px; transition:background 0.2s;">⚙</button>
          <button id="hmis-minimize-btn" title="Minimize" style="background:none; border:none; font-size:20px; cursor:pointer; color:white; padding:0;">−</button>
        </div>
      </div>
      
      <div id="hmis-tabs" style="display: flex; border-bottom: 1px solid #e0e0e0; background: #f5f5f5;">
        <button class="hmis-tab active" data-tab="visit" style="flex:1; padding:10px; border:none; background:white; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid #00897B; outline:none;">Visit</button>
        <button class="hmis-tab" data-tab="patient" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; outline:none;">Patient</button>
        <button class="hmis-tab" data-tab="clinic" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; outline:none;">Clinic</button>
        <button class="hmis-tab" data-tab="insurance" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; display:none; outline:none;">Insurance</button>
        <button class="hmis-tab" data-tab="dental" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; display:none; outline:none;">Dental</button>
        <button class="hmis-tab" data-tab="notes" style="flex:1; padding:10px; border:none; background:transparent; cursor:pointer; font-size:13px; font-weight:500; border-bottom: 2px solid transparent; display:none; outline:none;">Notes</button>
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
  const expanded = overlay.querySelector('#hmis-overlay-expanded');
  const collapsed = overlay.querySelector('#hmis-overlay-collapsed');

  // SETUP TABS FIRST - BEFORE ANY ERROR CAN OCCUR
  setupTabs();

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

  try {
    // Get API endpoint from storage (default to localhost if not set)
    const storage = await new Promise((resolve) => {
      chrome.storage.local.get(['apiEndpoint'], resolve);
    });
    const apiEndpoint = storage.apiEndpoint || 'http://localhost:8000';
    
    // Remove trailing slash if present
    const baseUrl = apiEndpoint.replace(/\/$/, '');
    const url = `${baseUrl}/api/visits/summary/by-patient-uuid/${uuid}/`;
    
    console.log("Fetching visit summary from:", url);
    
    const res = await fetch(url);
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
    let errorMessage = err.message;
    
    if (err.message.includes('Failed to fetch') || err.message.includes('ERR_CERT_AUTHORITY_INVALID')) {
      errorMessage = 'Certificate error or connection failed. If using HTTPS with a self-signed certificate, you may need to accept it in your browser first.';
    } else if (err.message.includes('CORS')) {
      errorMessage = 'CORS error: The API server may not allow requests from this origin.';
    }
    
    overlay.querySelector('#hmis-content').innerHTML = `
      <div style="color:#d32f2f; padding:12px; background:#ffebee; border-radius:4px;">
        <strong>Failed to load summary</strong><br/>
        <small>${errorMessage}</small><br/>
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
        content.innerHTML = renderInsuranceTab(currentVisitData.insurance_scheme_details);
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
    const currentEndpoint = result.apiEndpoint || 'http://localhost:8000';
    
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
              placeholder="http://localhost:8000 or https://192.168.1.169:8000"
              style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; box-sizing: border-box;"
            />
            <div id="hmis-endpoint-error" style="color: #d32f2f; font-size: 12px; margin-top: 5px; display: none;"></div>
            <div style="font-size: 12px; color: #666; margin-top: 5px;">
              Enter the base URL of your API server. Include the protocol (http:// or https://) and port if needed.
              <br><br>
              <strong>Examples:</strong>
              <ul style="margin: 5px 0; padding-left: 20px;">
                <li>http://localhost:8000</li>
                <li>https://192.168.1.169:8000</li>
                <li>https://api.example.com</li>
              </ul>
            </div>
          </div>
          
          <button 
            type="submit" 
            style="background: #00897B; color: white; border: none; padding: 10px 20px; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; width: 100%;"
          >
            Save Settings
          </button>
        </form>
        
        <div id="hmis-settings-success" style="background: #e8f5e9; color: #2e7d32; padding: 12px; border-radius: 4px; margin-top: 16px; display: none; font-size: 13px;">
          Settings saved successfully!
        </div>
        
        <div style="background: #fff3e0; border-left: 4px solid #ff9800; padding: 12px; margin-top: 16px; border-radius: 4px; font-size: 12px; color: #e65100;">
          <strong>⚠️ Certificate Errors</strong>
          <p style="margin: 5px 0 0 0;">
            If you're using HTTPS with a self-signed certificate and seeing "ERR_CERT_AUTHORITY_INVALID" errors:
          </p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li>Click the certificate error in your browser's address bar</li>
            <li>Select "Advanced" and then "Proceed to [site] (unsafe)"</li>
            <li>This will allow the browser to accept the certificate for this session</li>
            <li>For production, use a valid SSL certificate from a trusted authority</li>
          </ul>
        </div>
      </div>
    `;
    
    // Add form submit handler
    const form = content.querySelector('#hmis-settings-form');
    const endpointInput = content.querySelector('#hmis-api-endpoint');
    const errorDiv = content.querySelector('#hmis-endpoint-error');
    const successDiv = content.querySelector('#hmis-settings-success');
    
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
        errorDiv.textContent = 'Please enter a valid URL (e.g., http://localhost:8000 or https://192.168.1.169:8000)';
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
  // Get API endpoint from storage
  const storage = await new Promise((resolve) => {
    chrome.storage.local.get(['apiEndpoint'], resolve);
  });
  const apiEndpoint = storage.apiEndpoint || 'http://localhost:8000';
  
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
window.addEventListener('message', function(event) {
  if (event.source !== window) return;
  
  if (event.data.type === 'INVENTORY_CHECK') {
    console.log("Inventory check result:", event.data);
  }
  
  if (event.data.type === 'REQUEST_CLINIC_DATA') {
    chrome.storage.local.get(['clinicId', 'clinicName', 'clinicCode', 'patientUuid'], (result) => {
      sendClinicDataToInjectedScript(result);
    });
  }
});

// ==========================================
// INITIALIZATION
// ==========================================

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