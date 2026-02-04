(function () {
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
    
    // Only run on treatment page
    if (!isTreatmentPage()) {
      console.log("Not on treatment page - inventory monitor will not run");
      return;
    }
    
    console.log("Bahmni Inventory Monitor - Running in page context with Angular access");
  
    const checkedMedications = new Map();
    let clinicData = null;
    let apiEndpoint = 'http://192.168.1.169:5000'; // Default endpoint
    
    // Fetch helper that goes through content script (bypasses CORS/mixed content)
    const pendingFetches = new Map();
    let fetchRequestId = 0;
    
    function contentScriptFetch(url, options = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++fetchRequestId;
        
        // Store the promise handlers
        pendingFetches.set(requestId, { resolve, reject });
        
        // Send request to content script
        window.postMessage({
          type: 'FETCH_REQUEST',
          requestId: requestId,
          url: url,
          options: options
        }, '*');
        
        // Timeout after 30 seconds
        setTimeout(() => {
          if (pendingFetches.has(requestId)) {
            pendingFetches.delete(requestId);
            reject(new Error('Fetch request timed out'));
          }
        }, 30000);
      });
    }
    
    // Listen for fetch responses from content script
    window.addEventListener('message', function(event) {
      if (event.source !== window) return;
      
      if (event.data.type === 'FETCH_RESPONSE') {
        const { requestId, success, data, error, status, ok } = event.data;
        const pending = pendingFetches.get(requestId);
        
        if (pending) {
          pendingFetches.delete(requestId);
          
          if (success) {
            pending.resolve({
              ok: ok,
              status: status,
              json: async () => data,
              data: data
            });
          } else {
            pending.reject(new Error(error));
          }
        }
      }
    });
  
    // LISTEN FOR CLINIC DATA FROM CONTENT SCRIPT
    window.addEventListener('message', function(event) {
      if (event.source !== window) return;
      
      if (event.data.type === 'CLINIC_DATA') {
        const receivedData = event.data.data;
        
        // Extract API endpoint if provided
        if (receivedData.apiEndpoint) {
          apiEndpoint = receivedData.apiEndpoint;
          console.log("Received API endpoint from content script:", apiEndpoint);
          // Remove apiEndpoint from clinicData to avoid confusion
          const { apiEndpoint: _, ...clinicDataOnly } = receivedData;
          clinicData = clinicDataOnly;
        } else {
          clinicData = receivedData;
        }
        
        console.log("Received clinic data from content script:", clinicData);
        console.log("CLINIC ID RECEIVED IN INJECTED SCRIPT:", clinicData?.clinicId);
        
        if (clinicData && clinicData.clinicId) {
          console.log("Clinic ID available:", clinicData.clinicId);
          console.log("Starting inventory check process now that clinic ID is available");
          // Re-process medications now that we have clinic data
          // Add a small delay to ensure DOM is ready
          setTimeout(() => {
            console.log("Processing medications with clinic ID:", clinicData.clinicId);
            processNewMedications();
          }, 300);
        } else {
          console.warn("No clinic ID available yet");
        }
      }
    });
  
    // REQUEST CLINIC DATA ON STARTUP
    function requestClinicData() {
      console.log("Requesting clinic data from content script...");
      window.postMessage({ type: 'REQUEST_CLINIC_DATA' }, '*');
    }
  
    function getDrugIdFromScope(element) {
      try {
        if (typeof angular === 'undefined') {
          console.warn("Angular still not available");
          return {};
        }
  
        const ngElement = angular.element(element);
        const scope = ngElement.scope();
        
        if (scope && scope.newTreatment) {
          const treatment = scope.newTreatment;
          
          console.log("Full treatment object:", treatment);
          
          return {
            drugUuid: treatment.drug?.uuid,
            drugName: treatment.drugNameDisplay,
            conceptUuid: treatment.concept?.uuid,
            orderUuid: treatment.uuid,
            drugObject: treatment.drug,
            conceptObject: treatment.concept,
            dose: treatment.uniformDosingType?.dose,
            doseUnits: treatment.uniformDosingType?.doseUnits,
            frequency: treatment.uniformDosingType?.frequency,
            duration: treatment.duration,
            durationUnit: treatment.durationUnit,
            quantity: treatment.quantity,
            quantityUnit: treatment.quantityUnit
          };
        }
        
        return {};
      } catch (err) {
        console.error("Error accessing scope:", err);
        return {};
      }
    }
  
    function extractMedicationData(listItem) {
      try {
        const drugNameEl = listItem.querySelector('.drug-name');
        const dosageEl = listItem.querySelector('.dosage-frequency');
        const quantityEl = listItem.querySelector('.dosage-details [ng-if="newTreatment.getQuantityWithUnit()"]');
        
        if (!drugNameEl) return null;
  
        const drugName = drugNameEl.textContent.trim();
        const dosageText = dosageEl ? dosageEl.textContent.trim() : '';
        const quantityText = quantityEl ? quantityEl.textContent.trim() : '';
        
        const quantityMatch = quantityText.match(/(\d+\.?\d*)\s*(\w+)/);
        const quantity = quantityMatch ? parseFloat(quantityMatch[1]) : null;
        const unit = quantityMatch ? quantityMatch[2] : null;
  
        const scopeData = getDrugIdFromScope(listItem);
  
        const uniqueId = scopeData.drugUuid || scopeData.conceptUuid || `${drugName}-${Date.now()}`;
  
        return {
          drugName,
          dosageText,
          quantity,
          unit,
          quantityText,
          uniqueId,
          element: listItem,
          ...scopeData
        };
      } catch (err) {
        console.error("Error extracting medication data:", err);
        return null;
      }
    }
  
    async function checkInventory(medData) {
      console.log("Checking inventory for:", {
        name: medData.drugName,
        drugUuid: medData.drugUuid,
        conceptUuid: medData.conceptUuid,
        quantity: medData.quantity,
        clinicId: clinicData?.clinicId,
        clinicName: clinicData?.clinicName
      });
      
      // Check if we have required data
      if (!medData.drugUuid) {
        console.warn("No drug UUID available for inventory check:", medData.drugName);
        showAPIError(medData);
        return null;
      }
      
      if (!clinicData?.clinicId) {
        console.warn("No clinic ID available for inventory check:", medData.drugName);
        showAPIError(medData);
        return null;
      }
      
      try {
        // Use API endpoint received from content script (or default)
        const baseUrl = apiEndpoint.replace(/\/$/, '');
        const endpoint = `${baseUrl}/api/inventory/location/by-drug-uuid/?drug_uuid=${medData.drugUuid}&clinic_id=${clinicData.clinicId}`;
        
        console.log('[API] Calling endpoint: GET', endpoint);
        console.log("Calling inventory API:", endpoint);
        
        // Use content script bridge to bypass CORS/mixed content
        const response = await contentScriptFetch(endpoint, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        console.log("Inventory response:", data);

        // Extract available quantity from response (using total_quantity from API)
        const availableQty = data.total_quantity || data.quantity || data.available_quantity || data.stock_quantity || data.available || 0;
        
        // Store full inventory data including locations for overlay display
        medData.inventoryData = data;
        
        console.log("Inventory check result:", {
          drugName: medData.drugName,
          requested: medData.quantity,
          available: availableQty,
          status: availableQty >= medData.quantity ? 'OK' : 'LOW',
          locations: data.locations || []
        });
        
        if (medData.quantity && availableQty < medData.quantity) {
          showLowStockWarning(medData, availableQty);
        } else {
          showStockOK(medData, availableQty);
        }

        window.postMessage({
          type: 'INVENTORY_CHECK',
          data: {
            drugName: medData.drugName,
            drugUuid: medData.drugUuid,
            requested: medData.quantity,
            available: availableQty,
            clinicId: clinicData.clinicId,
            clinicName: clinicData.clinicName,
            status: availableQty >= medData.quantity ? 'OK' : 'LOW'
          }
        }, '*');

        return data;
      } catch (err) {
        console.error("Inventory check failed:", err);
        
        // Provide more helpful error messages
        if (err.message.includes('Failed to fetch') || err.message.includes('ERR_CERT_AUTHORITY_INVALID')) {
          console.error("Certificate or connection error. Check your API endpoint configuration in extension options.");
        }
        
        showAPIError(medData);
        return null;
      }
    }
  
    function showLowStockWarning(medData, available) {
      console.warn(`LOW STOCK: ${medData.drugName} - Need: ${medData.quantity}, Available: ${available}`);
      
      const indicator = document.createElement('div');
      indicator.className = 'inventory-warning';
      indicator.innerHTML = `
        <i class="fa fa-exclamation-triangle" style="color: #f44336; margin-right: 5px;"></i>
        <span style="color: #f44336; font-weight: bold;">
          Low Stock: <span class="inventory-quantity-clickable" style="cursor: pointer; text-decoration: underline; text-decoration-style: dotted;" title="Click to view location details">${available} ${medData.unit}</span> available (need ${medData.quantity})
        </span>
      `;
      indicator.style.cssText = 'padding: 5px 10px; background: #ffebee; border-left: 3px solid #f44336; margin-top: 5px; font-size: 12px;';
      
      // Add click handler to show location overlay
      const clickableQty = indicator.querySelector('.inventory-quantity-clickable');
      if (clickableQty && medData.inventoryData) {
        clickableQty.addEventListener('click', (e) => {
          e.stopPropagation();
          showLocationOverlay(medData);
        });
      }
      
      const dosageDetails = medData.element.querySelector('.dosage-details');
      if (dosageDetails && !medData.element.querySelector('.inventory-warning')) {
        dosageDetails.appendChild(indicator);
      }
    }
  
    function showStockOK(medData, available) {
      console.log(`Stock OK: ${medData.drugName} - ${available} ${medData.unit} available`);
      
      const indicator = document.createElement('span');
      indicator.className = 'inventory-ok';
      indicator.innerHTML = ` <i class="fa fa-check-circle" style="color: #4caf50;"></i> <span class="inventory-quantity-clickable" style="cursor: pointer; text-decoration: underline; text-decoration-style: dotted; color: #4caf50; margin-left: 5px; font-weight: 500;" title="Click to view location details">${available} ${medData.unit}</span>`;
      indicator.style.cssText = 'margin-left: 10px;';
      
      // Add click handler to show location overlay
      const clickableQty = indicator.querySelector('.inventory-quantity-clickable');
      if (clickableQty && medData.inventoryData) {
        clickableQty.addEventListener('click', (e) => {
          e.stopPropagation();
          showLocationOverlay(medData);
        });
      }
      
      const drugName = medData.element.querySelector('.drug-name');
      if (drugName && !medData.element.querySelector('.inventory-ok')) {
        drugName.appendChild(indicator);
      }
    }
  
    function showAPIError(medData) {
      console.error(`Could not check inventory for ${medData.drugName}`);
      
      const indicator = document.createElement('div');
      indicator.className = 'inventory-error';
      indicator.innerHTML = `
        <i class="fa fa-exclamation-circle" style="color: #ff9800; margin-right: 5px;"></i>
        <span style="color: #ff9800;">Could not check inventory</span>
      `;
      indicator.style.cssText = 'padding: 5px 10px; background: #fff3e0; border-left: 3px solid #ff9800; margin-top: 5px; font-size: 12px;';
      
      const dosageDetails = medData.element.querySelector('.dosage-details');
      if (dosageDetails && !medData.element.querySelector('.inventory-error')) {
        dosageDetails.appendChild(indicator);
      }
    }

    function showLocationOverlay(medData) {
      // Remove existing overlay if present
      const existingOverlay = document.getElementById('inventory-location-overlay');
      if (existingOverlay) {
        existingOverlay.remove();
      }

      const inventoryData = medData.inventoryData;
      if (!inventoryData || !inventoryData.locations) {
        console.warn("No location data available for overlay");
        return;
      }

      // Create overlay backdrop
      const overlay = document.createElement('div');
      overlay.id = 'inventory-location-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      `;

      // Create modal content
      const modal = document.createElement('div');
      modal.style.cssText = `
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        max-width: 600px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      `;

      // Header
      const header = document.createElement('div');
      header.style.cssText = `
        padding: 20px;
        border-bottom: 1px solid #e0e0e0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #f8f9fa;
      `;
      
      const headerContent = document.createElement('div');
      headerContent.innerHTML = `
        <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #333;">
          ${inventoryData.product?.name || medData.drugName}
        </h3>
        <p style="margin: 5px 0 0 0; font-size: 13px; color: #666;">
          Total Quantity: <strong style="color: #00897B;">${inventoryData.total_quantity || 0} ${medData.unit || ''}</strong>
        </p>
      `;
      
      const closeButton = document.createElement('button');
      closeButton.innerHTML = '&times;';
      closeButton.style.cssText = `
        background: none;
        border: none;
        font-size: 28px;
        color: #666;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
      `;
      closeButton.onmouseover = () => {
        closeButton.style.background = '#e0e0e0';
        closeButton.style.color = '#333';
      };
      closeButton.onmouseout = () => {
        closeButton.style.background = 'none';
        closeButton.style.color = '#666';
      };
      closeButton.onclick = () => overlay.remove();

      header.appendChild(headerContent);
      header.appendChild(closeButton);

      // Body with locations list
      const body = document.createElement('div');
      body.style.cssText = `
        padding: 20px;
        overflow-y: auto;
        flex: 1;
      `;

      if (inventoryData.locations && inventoryData.locations.length > 0) {
        const locationsList = document.createElement('div');
        locationsList.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

        inventoryData.locations.forEach((location, index) => {
          const locationItem = document.createElement('div');
          locationItem.style.cssText = `
            padding: 16px;
            border: 1px solid #e0e0e0;
            border-radius: 6px;
            background: #fafafa;
            transition: all 0.2s;
          `;
          locationItem.onmouseover = () => {
            locationItem.style.background = '#f0f0f0';
            locationItem.style.borderColor = '#00897B';
          };
          locationItem.onmouseout = () => {
            locationItem.style.background = '#fafafa';
            locationItem.style.borderColor = '#e0e0e0';
          };

          locationItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 15px; color: #333; margin-bottom: 6px;">
                  ${location.location_name || 'Unknown Location'}
                </div>
                <div style="font-size: 13px; color: #666;">
                  Code: <strong>${location.location_code || 'N/A'}</strong>
                </div>
              </div>
              <div style="margin-left: 16px; text-align: right;">
                <div style="font-size: 24px; font-weight: 600; color: #00897B;">
                  ${location.quantity || 0}
                </div>
                <div style="font-size: 12px; color: #666; margin-top: 2px;">
                  ${medData.unit || ''}
                </div>
              </div>
            </div>
          `;

          locationsList.appendChild(locationItem);
        });

        body.appendChild(locationsList);
      } else {
        body.innerHTML = `
          <div style="text-align: center; padding: 40px 20px; color: #999;">
            <i class="fa fa-info-circle" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>
            <p style="margin: 0; font-size: 14px;">No location data available</p>
          </div>
        `;
      }

      // Assemble modal
      modal.appendChild(header);
      modal.appendChild(body);
      overlay.appendChild(modal);

      // Close on backdrop click
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
        }
      });

      // Close on Escape key
      const escapeHandler = (e) => {
        if (e.key === 'Escape') {
          overlay.remove();
          document.removeEventListener('keydown', escapeHandler);
        }
      };
      document.addEventListener('keydown', escapeHandler);

      // Add to page
      document.body.appendChild(overlay);

      // Focus close button for accessibility
      closeButton.focus();
    }
  
    let listObserver = null;
    let listObserverTarget = null;
    let tableWatcher = null;

    async function processNewMedications() {
      console.log("processNewMedications called - clinicData:", clinicData);
      console.log("Clinic ID in processNewMedications:", clinicData?.clinicId);
      
      // REQUEST CLINIC DATA IF NOT AVAILABLE
      if (!clinicData || !clinicData.clinicId) {
        console.log("Waiting for clinic data...");
        requestClinicData();
        // Wait a bit for the response
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check again after waiting
        if (!clinicData || !clinicData.clinicId) {
          console.warn("Still no clinic data after waiting, skipping inventory check");
          return;
        }
      }
  
      const listItems = document.querySelectorAll('#new-drug-orders');
      
      console.log(`Processing ${listItems.length} prescription items`);
      
      listItems.forEach((item, index) => {
        const medData = extractMedicationData(item);
        
        if (!medData) {
          console.log(`Skipping item ${index} - no data extracted`);
          return;
        }
  
        // Check if this medication was already checked
        if (checkedMedications.has(medData.uniqueId)) {
          const previousMedData = checkedMedications.get(medData.uniqueId);
          // Verify the previous element still exists in the DOM
          if (previousMedData && previousMedData.element && document.contains(previousMedData.element)) {
            console.log(`Skipping item ${index} - already checked and element still exists`);
            return;
          } else {
            // Element was removed, so remove from checkedMedications and re-check
            console.log(`Item ${index} was previously checked but element removed - will re-check`);
            checkedMedications.delete(medData.uniqueId);
          }
        }
  
        checkedMedications.set(medData.uniqueId, medData);
        
        console.log(`New medication detected (${index}):`, {
          name: medData.drugName,
          drugUuid: medData.drugUuid,
          conceptUuid: medData.conceptUuid,
          quantity: medData.quantity,
          unit: medData.unit,
          clinic: clinicData?.clinicName,
          clinicId: clinicData?.clinicId
        });
        
        // Only check inventory if we have clinic data
        if (clinicData && clinicData.clinicId) {
          console.log(`Starting inventory check for ${medData.drugName} with clinic ID: ${clinicData.clinicId}`);
          checkInventory(medData);
        } else {
          console.warn(`Skipping inventory check for ${medData.drugName} - no clinic ID available`);
        }
      });
    }
  
    function attachListObserver(targetNode) {
      if (!targetNode) return;

      if (listObserver && listObserverTarget === targetNode) {
        return;
      }

      if (listObserver) {
        listObserver.disconnect();
      }

      listObserverTarget = targetNode;
      console.log("Attaching inventory observer to prescription table");

      listObserver = new MutationObserver((mutations) => {
        let hasNewItems = false;
        let hasRemovedItems = false;
        
        mutations.forEach(mutation => {
          if (mutation.type === 'childList') {
            if (mutation.addedNodes.length > 0) {
              hasNewItems = true;
            }
            if (mutation.removedNodes.length > 0) {
              hasRemovedItems = true;
            }
          }
        });
        
        // Clean up removed items from checkedMedications
        if (hasRemovedItems) {
          console.log("DOM mutation detected - cleaning up removed medications");
          const currentItems = document.querySelectorAll('#new-drug-orders');
          const currentUniqueIds = new Set();
          
          currentItems.forEach(item => {
            const medData = extractMedicationData(item);
            if (medData && medData.uniqueId) {
              currentUniqueIds.add(medData.uniqueId);
            }
          });
          
          // Remove any checked medications that are no longer in the DOM
          for (const [uniqueId, medData] of checkedMedications.entries()) {
            if (!currentUniqueIds.has(uniqueId) || !document.contains(medData.element)) {
              console.log(`Removing checked medication from cache: ${medData.drugName} (${uniqueId})`);
              checkedMedications.delete(uniqueId);
            }
          }
        }
        
        if (hasNewItems) {
          console.log("DOM mutation detected - processing medications");
          setTimeout(processNewMedications, 500);
        }
      });

      listObserver.observe(targetNode, {
        childList: true,
        subtree: true
      });

      setTimeout(processNewMedications, 1000);
    }

    function setupObserver() {
      const targetNode = document.querySelector('.new-drug-order ul.table-mimic');
      
      if (!targetNode) {
        console.log("Prescription table not found yet, retrying...");
        setTimeout(setupObserver, 1000);
        return;
      }
  
      console.log("Prescription table found, setting up observer");
      attachListObserver(targetNode);
    }
  
    function watchAddButton() {
      const addButton = document.querySelector('.add-drug-btn');
      if (!addButton) {
        setTimeout(watchAddButton, 1000);
        return;
      }
  
      console.log("Add button found, attaching listener");
      
      addButton.addEventListener('click', () => {
        console.log("Add button clicked");
        setTimeout(processNewMedications, 800);
      });
    }

    function watchSaveButton() {
      const saveButton = document.querySelector('button.save-consultation');
      if (!saveButton) {
        setTimeout(watchSaveButton, 1000);
        return;
      }

      console.log("Save button found, attaching listener");
      saveButton.addEventListener('click', () => {
        console.log("Save button clicked - refreshing inventory monitor");
        checkedMedications.clear();
        requestClinicData();
        setTimeout(() => {
          setupObserver();
          processNewMedications();
        }, 800);
      });
    }

    function watchTableRebuild() {
      if (tableWatcher) return;

      tableWatcher = new MutationObserver(() => {
        const targetNode = document.querySelector('.new-drug-order ul.table-mimic');
        if (targetNode && targetNode !== listObserverTarget) {
          console.log("Prescription table replaced - reattaching observer");
          attachListObserver(targetNode);
        }
      });

      tableWatcher.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  
    //  INITIALIZE
    function initialize() {
      // Request clinic data immediately
      requestClinicData();
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setupObserver();
          watchAddButton();
          watchSaveButton();
          watchTableRebuild();
        });
      } else {
        setupObserver();
        watchAddButton();
        watchSaveButton();
        watchTableRebuild();
      }
    }
  
    initialize();
  
    window.bahmniInventory = {
      check: processNewMedications,
      checkedMeds: checkedMedications,
      clinicData: () => clinicData,
      refreshClinicData: requestClinicData
    };
    
    console.log("Debug: window.bahmniInventory.check() to manually trigger");
    console.log("Debug: window.bahmniInventory.clinicData() to view clinic info");
    console.log("Debug: window.bahmniInventory.refreshClinicData() to reload clinic data");
  })();
