# Chrome Extension Integration Guide

This guide provides detailed instructions for updating your Chrome Extension to work with the new database-backed NISU Teacher system.

## Overview

Your Chrome Extension currently stores data locally and pulls JSON from Google Cloud Storage. This guide will walk you through integrating with the new Google App Engine backend which provides:

- Google Authentication
- Database storage of notebooks and playlists
- Progress tracking for students
- Support for multiple notebooks

## Required Updates

### Step 1: Update Manifest.json

First, update your Chrome Extension's manifest.json file to request the necessary permissions:

```json
{
  "name": "NISU Chrome Extension",
  "version": "2.0",
  "description": "NISU Teacher Extension with Google Authentication",
  "manifest_version": 3,
  "permissions": [
    "storage",
    "identity",
    "activeTab"
  ],
  "host_permissions": [
    "https://your-project-id.appspot.com/*"
  ],
  "oauth2": {
    "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    "scopes": [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile"
    ]
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "images/icon16.png",
      "32": "images/icon32.png",
      "48": "images/icon48.png",
      "128": "images/icon128.png"
    }
  },
  "background": {
    "service_worker": "background.js"
  }
}
```

### Step 2: Set Up Authentication

Create a background.js service worker to handle authentication:

```javascript
// background.js

// Constants
const API_BASE_URL = 'https://your-project-id.appspot.com/api';
let authToken = null;
let currentUser = null;

// Initialize when extension is installed or updated
chrome.runtime.onInstalled.addListener(async () => {
  console.log('NISU Extension installed or updated');
  
  // Check if already authenticated
  const data = await chrome.storage.local.get(['authToken', 'currentUser']);
  if (data.authToken && data.currentUser) {
    authToken = data.authToken;
    currentUser = data.currentUser;
    console.log('User already authenticated:', currentUser.email);
  }
});

// Authentication function
async function authenticate() {
  try {
    // Request Google authentication token
    const authResult = await chrome.identity.getAuthToken({ interactive: true });
    authToken = authResult.token;
    
    // Get user info using the token
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!userInfoResponse.ok) {
      throw new Error('Failed to get user info');
    }
    
    currentUser = await userInfoResponse.json();
    
    // Store the auth data
    await chrome.storage.local.set({ 
      'authToken': authToken, 
      'currentUser': currentUser 
    });
    
    console.log('Authentication successful:', currentUser.email);
    return { success: true, user: currentUser };
  } catch (error) {
    console.error('Authentication error:', error);
    return { success: false, error: error.message };
  }
}

// Sign out function
async function signOut() {
  try {
    if (authToken) {
      // Revoke the token
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${authToken}`);
    }
    
    // Clear storage
    await chrome.storage.local.remove(['authToken', 'currentUser', 'currentNotebook', 'completedItems']);
    authToken = null;
    currentUser = null;
    
    console.log('Sign out successful');
    return { success: true };
  } catch (error) {
    console.error('Sign out error:', error);
    return { success: false, error: error.message };
  }
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'authenticate') {
    authenticate().then(sendResponse);
    return true; // Required for async response
  }
  
  if (request.action === 'signOut') {
    signOut().then(sendResponse);
    return true;
  }
  
  if (request.action === 'getCurrentUser') {
    sendResponse({ user: currentUser });
    return true;
  }
  
  // Handle other message types here
});
```

### Step 3: Fetch Notebooks and Playlists

Create a notebook service to handle API interactions:

```javascript
// notebook-service.js

class NotebookService {
  constructor() {
    this.API_BASE_URL = 'https://your-project-id.appspot.com/api';
    this.authToken = null;
    this.currentNotebookId = null;
    
    // Initialize from storage
    this.initialize();
  }
  
  async initialize() {
    const data = await chrome.storage.local.get(['authToken', 'currentNotebookId']);
    if (data.authToken) {
      this.authToken = data.authToken;
    }
    if (data.currentNotebookId) {
      this.currentNotebookId = data.currentNotebookId;
    }
  }
  
  async fetchAllNotebooks() {
    try {
      if (!this.authToken) {
        throw new Error('Not authenticated');
      }
      
      const response = await fetch(`${this.API_BASE_URL}/notebooks`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch notebooks');
      }
      
      const data = await response.json();
      return data.notebooks || [];
    } catch (error) {
      console.error('Error fetching notebooks:', error);
      throw error;
    }
  }
  
  async fetchNotebookByName(notebookName) {
    try {
      if (!this.authToken) {
        throw new Error('Not authenticated');
      }
      
      const response = await fetch(`${this.API_BASE_URL}/notebooks/byName/${encodeURIComponent(notebookName)}`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch notebook');
      }
      
      const data = await response.json();
      
      // Store current notebook ID for progress tracking
      this.currentNotebookId = data.notebook.id;
      await chrome.storage.local.set({ 'currentNotebookId': data.notebook.id });
      
      return data.notebook;
    } catch (error) {
      console.error('Error fetching notebook by name:', error);
      throw error;
    }
  }
  
  async fetchProgress() {
    try {
      if (!this.authToken || !this.currentNotebookId) {
        throw new Error('Not authenticated or no notebook selected');
      }
      
      const response = await fetch(`${this.API_BASE_URL}/progress/${this.currentNotebookId}`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch progress');
      }
      
      const data = await response.json();
      
      // Store completed items
      await chrome.storage.local.set({ 'completedItems': data.completedItems });
      
      return data.completedItems || [];
    } catch (error) {
      console.error('Error fetching progress:', error);
      throw error;
    }
  }
  
  async markItemCompleted(itemId, completed = true) {
    try {
      if (!this.authToken || !this.currentNotebookId) {
        throw new Error('Not authenticated or no notebook selected');
      }
      
      const response = await fetch(`${this.API_BASE_URL}/progress/${this.currentNotebookId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({ itemId, completed })
      });
      
      if (!response.ok) {
        throw new Error('Failed to update progress');
      }
      
      const data = await response.json();
      
      // Update local storage with new completed items
      await chrome.storage.local.set({ 'completedItems': data.completedItems });
      
      return data.completedItems;
    } catch (error) {
      console.error('Error updating progress:', error);
      throw error;
    }
  }
}

// Create a singleton instance
const notebookService = new NotebookService();
```

### Step 4: Update Popup UI

Create the popup.html and popup.js files to provide the user interface:

```html
<!-- popup.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NISU Extension</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <!-- Login View -->
  <div id="loginView">
    <h2>NISU Teacher</h2>
    <p>Please sign in to access your notebooks</p>
    <button id="loginButton">Sign In with Google</button>
  </div>
  
  <!-- Main View (shown after login) -->
  <div id="mainView" style="display:none">
    <div class="user-info">
      <img id="userAvatar" src="" alt="User">
      <span id="userName"></span>
      <button id="logoutButton">Sign Out</button>
    </div>
    
    <div class="notebook-selector">
      <label for="notebookSelect">Select Notebook:</label>
      <select id="notebookSelect"></select>
    </div>
    
    <div id="playlistContainer"></div>
  </div>
  
  <script src="notebook-service.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

```javascript
// popup.js
document.addEventListener('DOMContentLoaded', function() {
  // UI Elements
  const loginView = document.getElementById('loginView');
  const mainView = document.getElementById('mainView');
  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const notebookSelect = document.getElementById('notebookSelect');
  const playlistContainer = document.getElementById('playlistContainer');
  
  // Check authentication state on load
  checkAuthState();
  
  // Event Listeners
  loginButton.addEventListener('click', handleLogin);
  logoutButton.addEventListener('click', handleLogout);
  notebookSelect.addEventListener('change', handleNotebookSelect);
  
  // Functions
  async function checkAuthState() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getCurrentUser' });
      
      if (response.user) {
        // User is logged in
        showUserInfo(response.user);
        showMainView();
        loadNotebooks();
      } else {
        // User is not logged in
        showLoginView();
      }
    } catch (error) {
      console.error('Error checking auth state:', error);
      showLoginView();
    }
  }
  
  async function handleLogin() {
    try {
      loginButton.disabled = true;
      loginButton.textContent = 'Signing in...';
      
      const response = await chrome.runtime.sendMessage({ action: 'authenticate' });
      
      if (response.success) {
        showUserInfo(response.user);
        showMainView();
        loadNotebooks();
      } else {
        alert('Login failed: ' + response.error);
        loginButton.disabled = false;
        loginButton.textContent = 'Sign In with Google';
      }
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed. Please try again.');
      loginButton.disabled = false;
      loginButton.textContent = 'Sign In with Google';
    }
  }
  
  async function handleLogout() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'signOut' });
      
      if (response.success) {
        showLoginView();
      } else {
        alert('Logout failed: ' + response.error);
      }
    } catch (error) {
      console.error('Logout error:', error);
      alert('Logout failed. Please try again.');
    }
  }
  
  function showLoginView() {
    loginView.style.display = 'block';
    mainView.style.display = 'none';
    loginButton.disabled = false;
    loginButton.textContent = 'Sign In with Google';
  }
  
  function showMainView() {
    loginView.style.display = 'none';
    mainView.style.display = 'block';
  }
  
  function showUserInfo(user) {
    userAvatar.src = user.picture;
    userName.textContent = user.name;
  }
  
  async function loadNotebooks() {
    try {
      // Clear the dropdown
      notebookSelect.innerHTML = '<option value="">Select a notebook...</option>';
      
      // Get all notebooks
      const notebooks = await notebookService.fetchAllNotebooks();
      
      // Add options to the dropdown
      notebooks.forEach(notebook => {
        const option = document.createElement('option');
        option.value = notebook.name;
        option.textContent = notebook.name;
        notebookSelect.appendChild(option);
      });
      
      // Check if there's a previously selected notebook
      const data = await chrome.storage.local.get(['currentNotebook']);
      if (data.currentNotebook) {
        notebookSelect.value = data.currentNotebook;
        if (notebookSelect.value) {
          await handleNotebookSelect();
        }
      }
    } catch (error) {
      console.error('Error loading notebooks:', error);
      playlistContainer.innerHTML = `<div class="error">Error loading notebooks: ${error.message}</div>`;
    }
  }
  
  async function handleNotebookSelect() {
    try {
      const selectedNotebook = notebookSelect.value;
      
      if (!selectedNotebook) {
        playlistContainer.innerHTML = '<div class="info">Please select a notebook</div>';
        return;
      }
      
      // Save selection
      await chrome.storage.local.set({ 'currentNotebook': selectedNotebook });
      
      // Show loading state
      playlistContainer.innerHTML = '<div class="loading">Loading notebook...</div>';
      
      // Fetch the notebook
      const notebook = await notebookService.fetchNotebookByName(selectedNotebook);
      
      // Fetch progress
      const completedItems = await notebookService.fetchProgress();
      
      // Display the playlist
      displayPlaylist(notebook.playlist, completedItems);
    } catch (error) {
      console.error('Error loading notebook:', error);
      playlistContainer.innerHTML = `<div class="error">Error loading notebook: ${error.message}</div>`;
    }
  }
  
  function displayPlaylist(playlist, completedItems) {
    if (!playlist || playlist.length === 0) {
      playlistContainer.innerHTML = '<div class="info">This notebook is empty</div>';
      return;
    }
    
    // Create playlist HTML
    let html = '<div class="playlist">';
    
    playlist.forEach(item => {
      const isCompleted = completedItems.includes(item.id);
      const statusClass = isCompleted ? 'completed' : 'pending';
      const statusIcon = isCompleted ? '✓' : '○';
      
      html += `
        <div class="playlist-item ${statusClass}" data-id="${item.id}" data-type="${item.type}">
          <div class="item-status">${statusIcon}</div>
          <div class="item-content">
            <div class="item-type">${item.type}</div>
            <div class="item-command">${item.command}</div>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    
    // Update the container
    playlistContainer.innerHTML = html;
    
    // Add click handlers to items
    document.querySelectorAll('.playlist-item').forEach(item => {
      item.addEventListener('click', () => handlePlaylistItemClick(item));
    });
  }
  
  async function handlePlaylistItemClick(itemElement) {
    try {
      const itemId = itemElement.dataset.id;
      const itemType = itemElement.dataset.type;
      const isCompleted = itemElement.classList.contains('completed');
      
      // If already completed, do nothing
      if (isCompleted) {
        return;
      }
      
      // Handle different item types
      switch (itemType) {
        case 'Prompt':
          handlePromptItem(itemElement);
          break;
        case 'Multimedia':
          handleMultimediaItem(itemElement);
          break;
        case 'Quiz':
          handleQuizItem(itemElement);
          break;
        case 'Assignment':
          handleAssignmentItem(itemElement);
          break;
        case 'Website':
          handleWebsiteItem(itemElement);
          break;
        default:
          alert(`Unknown item type: ${itemType}`);
          return;
      }
      
      // Mark item as completed
      await notebookService.markItemCompleted(itemId);
      
      // Update UI
      itemElement.classList.add('completed');
      itemElement.querySelector('.item-status').textContent = '✓';
    } catch (error) {
      console.error('Error handling item click:', error);
      alert('Error: ' + error.message);
    }
  }
  
  // Functions to handle different item types
  function handlePromptItem(itemElement) {
    const command = itemElement.querySelector('.item-command').textContent;
    
    // Open command in new tab for Claude or other AI assistant
    chrome.tabs.create({ url: 'https://claude.ai/chat' }, function(tab) {
      // After tab is created, wait for it to load and then insert the prompt
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          
          // Inject script to input the prompt
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: (promptText) => {
              // Find the input field and insert the prompt
              setTimeout(() => {
                const inputField = document.querySelector('textarea');
                if (inputField) {
                  inputField.value = promptText;
                  inputField.dispatchEvent(new Event('input', { bubbles: true }));
                }
              }, 2000); // Give the page time to fully initialize
            },
            args: [command]
          });
        }
      });
    });
  }
  
  function handleMultimediaItem(itemElement) {
    const url = itemElement.querySelector('.item-command').textContent;
    chrome.tabs.create({ url });
  }
  
  function handleQuizItem(itemElement) {
    const url = itemElement.querySelector('.item-command').textContent;
    chrome.tabs.create({ url });
  }
  
  function handleAssignmentItem(itemElement) {
    const url = itemElement.querySelector('.item-command').textContent;
    chrome.tabs.create({ url });
  }
  
  function handleWebsiteItem(itemElement) {
    const url = itemElement.querySelector('.item-command').textContent;
    chrome.tabs.create({ url });
  }
});
```

### Step 5: Create a Content Script for Notebook LM Integration

If you want to integrate directly with Google's Notebook LM, create a content script:

```javascript
// content-scripts/notebook-lm.js

// This script runs on Notebook LM pages to enhance the experience
console.log('NISU Teacher extension loaded on Notebook LM');

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'injectNotebookContent') {
    injectContent(request.content);
    sendResponse({ success: true });
  }
  return true;
});

// Function to inject content into Notebook LM
function injectContent(content) {
  // Implementation depends on the structure of Notebook LM
  console.log('Injecting content:', content);
  
  // Example implementation (adapt based on actual Notebook LM structure)
  const inputArea = document.querySelector('textarea.notebook-input');
  if (inputArea) {
    inputArea.value = content;
    inputArea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
```

### Step 6: Add Styles

Create a popup.css file for styling:

```css
/* popup.css */
body {
  width: 350px;
  font-family: Arial, sans-serif;
  margin: 0;
  padding: 0;
}

#loginView, #mainView {
  padding: 15px;
}

h2 {
  margin-top: 0;
  color: #3F72AF;
}

.user-info {
  display: flex;
  align-items: center;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 1px solid #eee;
}

#userAvatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  margin-right: 10px;
}

#userName {
  flex: 1;
  font-weight: bold;
}

#logoutButton {
  padding: 5px 10px;
  background: #f8f8f8;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
}

.notebook-selector {
  margin-bottom: 15px;
}

.notebook-selector select {
  width: 100%;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid #ddd;
}

.playlist-item {
  display: flex;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.playlist-item:hover {
  background-color: #f0f8ff;
}

.playlist-item.completed {
  background-color: #f0fff0;
  border-color: #8fbc8f;
}

.item-status {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #3F72AF;
}

.completed .item-status {
  color: #4CAF50;
}

.item-content {
  flex: 1;
  margin-left: 10px;
}

.item-type {
  font-size: 12px;
  color: #666;
  text-transform: uppercase;
}

.item-command {
  font-size: 14px;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.loading, .error, .info {
  padding: 15px;
  text-align: center;
}

.loading {
  color: #3F72AF;
}

.error {
  color: #D32F2F;
}

.info {
  color: #666;
}

button {
  background-color: #4285F4;
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
}

button:hover {
  background-color: #3367D6;
}

button:disabled {
  background-color: #A9A9A9;
  cursor: not-allowed;
}
```

## API Endpoints Reference

Here are all the API endpoints available in the new backend:

| Endpoint | Method | Description | Required Authentication |
|----------|--------|-------------|-------------------------|
| `/api/notebooks` | GET | Get all notebooks for the current user | Yes |
| `/api/notebooks` | POST | Create or update a notebook | Yes |
| `/api/notebooks/:notebookId` | GET | Get a notebook by ID | Yes |
| `/api/notebooks/byName/:name` | GET | Get a notebook by name | Yes |
| `/api/progress/:notebookId` | GET | Get progress for a notebook | Yes |
| `/api/progress/:notebookId` | POST | Update progress for an item | Yes |

## Testing Your Integration

1. **Local Testing**:
   - Load your extension in developer mode in Chrome
   - Check the browser console for any errors
   - Verify authentication flow works correctly
   - Test notebook fetching and selection

2. **API Testing**:
   - Use the Chrome DevTools Network tab to monitor API requests
   - Ensure proper authentication headers are being sent
   - Verify data is being correctly saved and retrieved

3. **Progress Tracking**:
   - Complete items in a notebook
   - Refresh the extension to verify progress persists
   - Check the database to ensure progress is being saved

## Troubleshooting

- **Authentication Issues**: 
  - Verify your Google Client ID is correct
  - Check that the correct scopes are requested
  - Ensure your App Engine domain is allowed in the OAuth configuration

- **CORS Errors**:
  - Make sure your App Engine backend has proper CORS headers
  - Check that your host permissions in manifest.json include the correct domain

- **Data Not Saving**:
  - Verify your API requests include the authentication token
  - Check the network requests for any error responses
  - Ensure your database is properly configured in App Engine

## Next Steps

Once your basic integration is working, consider these enhancements:

1. **Offline Support**: 
   - Add more robust caching of notebooks
   - Implement a queue for saving progress when offline

2. **Sync Across Devices**:
   - Add a way to refresh data when the extension is opened
   - Implement real-time updates using WebSockets or Firebase

3. **Enhanced UI**:
   - Add a progress dashboard
   - Provide visual feedback on completion status
   - Implement filtering and search for notebooks and items

4. **Notifications**:
   - Add reminder notifications for incomplete items
   - Notify users when new content is available