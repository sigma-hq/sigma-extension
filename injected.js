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
    let apiEndpoint = 'http://localhost:8000'; // Default endpoint
  
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
        
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log("Inventory response:", data);

        // Extract available quantity from response
        // Adjust this based on the actual response structure
        const availableQty = data.quantity || data.available_quantity || data.stock_quantity || data.available || 0;
        
        console.log("Inventory check result:", {
          drugName: medData.drugName,
          requested: medData.quantity,
          available: availableQty,
          status: availableQty >= medData.quantity ? 'OK' : 'LOW'
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
          Low Stock: ${available} ${medData.unit} available (need ${medData.quantity})
        </span>
      `;
      indicator.style.cssText = 'padding: 5px 10px; background: #ffebee; border-left: 3px solid #f44336; margin-top: 5px; font-size: 12px;';
      
      const dosageDetails = medData.element.querySelector('.dosage-details');
      if (dosageDetails && !medData.element.querySelector('.inventory-warning')) {
        dosageDetails.appendChild(indicator);
      }
    }
  
    function showStockOK(medData, available) {
      console.log(`Stock OK: ${medData.drugName} - ${available} ${medData.unit} available`);
      
      const indicator = document.createElement('span');
      indicator.className = 'inventory-ok';
      indicator.innerHTML = ` <i class="fa fa-check-circle" style="color: #4caf50;"></i>`;
      indicator.style.cssText = 'margin-left: 10px;';
      
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
  
        if (checkedMedications.has(medData.uniqueId)) {
          console.log(`Skipping item ${index} - already checked`);
          return;
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
  
    function setupObserver() {
      const targetNode = document.querySelector('.new-drug-order ul.table-mimic');
      
      if (!targetNode) {
        console.log("Prescription table not found yet, retrying...");
        setTimeout(setupObserver, 1000);
        return;
      }
  
      console.log("Prescription table found, setting up observer");
  
      const observer = new MutationObserver((mutations) => {
        let hasNewItems = false;
        
        mutations.forEach(mutation => {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            hasNewItems = true;
          }
        });
  
        if (hasNewItems) {
          console.log("DOM mutation detected - processing medications");
          setTimeout(processNewMedications, 500);
        }
      });
  
      observer.observe(targetNode, {
        childList: true,
        subtree: true
      });
  
      setTimeout(processNewMedications, 1000);
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
  
    //  INITIALIZE
    function initialize() {
      // Request clinic data immediately
      requestClinicData();
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          setupObserver();
          watchAddButton();
        });
      } else {
        setupObserver();
        watchAddButton();
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