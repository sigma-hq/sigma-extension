# Sigma HMIS & Inventory Helper - Installation Guide

This guide will walk you through installing the Sigma HMIS & Inventory Helper Chrome extension.

## Prerequisites

- Google Chrome browser (version 88 or later)
- Access to the extension source code files
- The extension requires access to `http://localhost:8000` for API calls

## Installation Steps

### Step 1: Open Chrome Extensions Page

1. Open Google Chrome
2. Navigate to the extensions page using one of these methods:
   - Type `chrome://extensions/` in the address bar and press Enter
   - Or go to **Menu (⋮)** → **Extensions** → **Manage extensions**

### Step 2: Enable Developer Mode

1. In the top-right corner of the extensions page, toggle **Developer mode** to ON
2. You should see additional buttons appear: **Load unpacked**, **Pack extension**, and **Update**

### Step 3: Load the Extension

1. Click the **Load unpacked** button
2. Navigate to the folder containing the extension files:
   - Select the `sigma-extension` folder (the folder containing `manifest.json`, `content.js`, and `injected.js`)
3. Click **Select Folder** (or **Select** on Windows)

### Step 4: Verify Installation

1. You should see the extension appear in your extensions list with the name **"Sigma HMIS & Inventory Helper"**
2. Make sure the extension is **Enabled** (toggle switch should be ON)
3. The extension should show version **1.0.0**

## Extension Files Required

The extension folder must contain these files:
- `manifest.json` - Extension configuration
- `content.js` - Main content script
- `injected.js` - Injected script for inventory monitoring

## Usage

### How It Works

1. **Patient Detection**: The extension automatically detects when you're viewing a patient in Bahmni
2. **HMIS Overlay**: Displays a visit summary overlay with patient, visit, and clinic information
3. **Inventory Monitoring**: On the treatment/medications page, automatically checks inventory for prescribed medications
4. **Clinic Data Persistence**: Clinic ID is saved and persists across page navigations

### Features

- **Visit Summary Overlay**: Shows patient visit details, clinic information, and insurance details (if applicable)
- **Inventory Checks**: Automatically monitors medication inventory when on the treatment page
- **Low Stock Warnings**: Displays warnings when medication stock is below required quantity
- **Clinic-Specific Inventory**: Filters inventory checks by clinic location

### Accessing the Extension

- The HMIS overlay appears automatically when viewing a patient
- Inventory monitoring activates automatically on the treatment/medications page
- Check the browser console (F12) for detailed logs and debugging information

## Troubleshooting

### Extension Not Loading

- **Issue**: Extension doesn't appear after clicking "Load unpacked"
  - **Solution**: Make sure you selected the correct folder containing `manifest.json`
  - Verify all required files are present in the folder

### Extension Not Working

- **Issue**: Extension loads but doesn't function
  - **Solution**: 
    - Check that the extension is enabled (toggle switch is ON)
    - Open browser console (F12) and check for any error messages
    - Verify you're on a Bahmni page (the extension only works on Bahmni)

### Inventory Not Checking

- **Issue**: Inventory checks not running
  - **Solution**:
    - Make sure you're on the treatment/medications page (URL contains `/treatment`)
    - Verify clinic ID is available (check console logs)
    - Ensure `http://localhost:8000` is accessible
    - Check browser console for API errors

### HMIS Overlay Not Showing

- **Issue**: Visit summary overlay doesn't appear
  - **Solution**:
    - Verify you're viewing a patient page in Bahmni
    - Check browser console for errors
    - Ensure the extension has proper permissions

### Console Errors

- If you see errors in the console:
  1. Check that all extension files are present and not corrupted
  2. Verify the extension is enabled
  3. Try reloading the extension (click the refresh icon on the extension card)
  4. Clear browser cache and reload the page

## Updating the Extension

When you make changes to the extension files:

1. Go to `chrome://extensions/`
2. Find the **Sigma HMIS & Inventory Helper** extension
3. Click the **Refresh** icon (circular arrow) on the extension card
4. Reload the Bahmni page to see the changes

## Permissions

The extension requires:
- **Storage**: To persist clinic ID and patient data across page navigations
- **Content Scripts**: To interact with Bahmni pages
- **Web Accessible Resources**: To inject scripts into the page context

## Uninstallation

To remove the extension:

1. Go to `chrome://extensions/`
2. Find **Sigma HMIS & Inventory Helper**
3. Click **Remove**
4. Confirm removal

## Support

For issues or questions:
- Check the browser console (F12) for error messages
- Review the extension logs in the console
- Verify all prerequisites are met

## Notes

- The extension only works on Bahmni pages
- Inventory monitoring only activates on the treatment/medications page
- Clinic data is stored locally in Chrome storage
- The extension requires access to `http://localhost:8000` for API calls

