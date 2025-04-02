// NADU Extension Background Script

// Constants
const API_BASE_URL = 'https://ai-dot-funkeai.uc.r.appspot.com/api';
let authToken = null;
let userData = null;

// Automatically inject content script on authenticated NotebookLM tabs
function injectContentScriptOnAuthenticatedTabs() {
    if (!authToken) return;

    chrome.tabs.query({url: "*://notebooklm.google.com/*"}, function(tabs) {
        tabs.forEach(tab => {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content.js']
            }).then(() => {
                // Send authentication status to the content script
                chrome.tabs.sendMessage(tab.id, {
                    action: 'auth_success',
                    userData: userData
                });
            }).catch(err => {
                console.error("Error injecting content script:", err);
            });
        });
    });
}

// Initialize when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
    console.log("NADU Extension installed.");
    
    // Check if already authenticated
    chrome.storage.local.get(['authToken', 'userData'], function(data) {
        if (data.authToken && data.userData) {
            authToken = data.authToken;
            userData = data.userData;
            console.log("User already authenticated:", userData.email);
        }
    });
});

// Message handler for various extension actions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received message:", message.action);
    
    // Authentication status check
    if (message.action === "checkAuth") {
        sendResponse({ 
            isAuthenticated: !!authToken, 
            userData: userData 
        });
        return true;
    }
    
    // Login handler
    if (message.action === "login") {
        console.log("Login message received, token length:", message.token ? message.token.length : 0);
        authToken = message.token;
        userData = message.userData;
        
        // Store auth data in Chrome storage
        chrome.storage.local.set({ 
            authToken: authToken, 
            userData: userData 
        }, function() {
            console.log("Auth data stored in local storage");
            
            // Automatically inject content script on existing NotebookLM tabs
            injectContentScriptOnAuthenticatedTabs();
            
            sendResponse({ success: true });
        });
        return true;
    }
    
    // Logout handler
    if (message.action === "logout") {
        console.log("Logout message received");
        authToken = null;
        userData = null;
        
        // Clear auth data from Chrome storage
        chrome.storage.local.clear(function() {
            console.log("Auth data cleared from local storage");
            
            // Notify tabs that user has logged out
            chrome.tabs.query({url: "*://notebooklm.google.com/*"}, function(tabs) {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { action: 'auth_logout' });
                });
            });
            
            sendResponse({ success: true });
        });
        return true;
    }
    
    // Debug authentication state
    if (message.action === "debugAuth") {
        sendResponse({
            hasToken: !!authToken,
            tokenLength: authToken ? authToken.length : 0,
            userData: userData,
            serverUrl: API_BASE_URL
        });
        return true;
    }
    
    // Fetch notebooks for authenticated student
    if (message.action === "fetchNotebooks") {
        if (!authToken) {
            sendResponse({ success: false, error: "Not authenticated" });
            return true;
        }
        
        fetch(`${API_BASE_URL}/students/notebooks`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`Failed to fetch notebooks: ${text}`);
                });
            }
            return response.json();
        })
        .then(data => {
            // Create ID to name mapping for future reference
            if (data.notebooks && data.notebooks.length > 0) {
                chrome.storage.local.get(['notebookIdToNameMap', 'notebookNameToIdMap'], function(result) {
                    const idToNameMap = result.notebookIdToNameMap || {};
                    const nameToIdMap = result.notebookNameToIdMap || {};
                    
                    data.notebooks.forEach(notebook => {
                        if (notebook.id && notebook.name) {
                            idToNameMap[notebook.id] = notebook.name;
                            nameToIdMap[notebook.name] = notebook.id;
                        }
                    });
                    
                    chrome.storage.local.set({ 
                        notebookIdToNameMap: idToNameMap,
                        notebookNameToIdMap: nameToIdMap
                    });
                });
            }
            
            sendResponse({ success: true, data: data });
        })
        .catch(error => {
            console.error("Error fetching notebooks:", error.message);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
    
    // Fetch playlist for a specific notebook
    if (message.action === "fetchInstructions") {
        const notebookName = message.notebookName;
        
        // If not authenticated, fall back to default implementation
        if (!authToken) {
            const uniqueParam = Date.now();
            const url = `https://storage.googleapis.com/nisaext/instructions.json?anyparam=${uniqueParam}`;

            fetch(url, {
                mode: "cors",
                credentials: "omit"
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error("Network response was not ok: " + response.statusText);
                }
                return response.json();
            })
            .then(data => {
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
            return true;
        }
        
        // Fetch playlist by notebook name
        if (notebookName) {
            fetch(`${API_BASE_URL}/students/notebooks/${encodeURIComponent(notebookName)}/playlist`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => {
                        throw new Error(`Failed to fetch playlist: ${text}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                console.error("Error fetching playlist:", error.message);
                sendResponse({ success: false, error: error.message });
            });
            
            return true;
        }
        
        // Determine notebook from active tab
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length === 0) {
                sendResponse({ success: false, error: "No active tab" });
                return;
            }
            
            const url = tabs[0].url;
            const extractedNotebookName = extractNotebookNameFromUrl(url);
            
            if (!extractedNotebookName) {
                sendResponse({ success: false, error: "Could not determine notebook name" });
                return;
            }
            
            // Fetch the playlist for this notebook
            fetch(`${API_BASE_URL}/students/notebooks/${encodeURIComponent(extractedNotebookName)}/playlist`, {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => {
                        throw new Error(`Failed to fetch playlist: ${text}`);
                    });
                }
                return response.json();
            })
            .then(data => {
                sendResponse({ success: true, data: data });
            })
            .catch(error => {
                console.error("Error fetching playlist:", error.message);
                sendResponse({ success: false, error: error.message });
            });
        });
        
        return true;
    }
    
    // Update progress for a specific notebook
    if (message.action === "updateProgress") {
        if (!authToken) {
            sendResponse({ success: false, error: "Not authenticated" });
            return true;
        }
        
        fetch(`${API_BASE_URL}/students/progress`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(message.progress)
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`Failed to update progress: ${text}`);
                });
            }
            return response.json();
        })
        .then(data => {
            sendResponse({ success: true, data: data });
        })
        .catch(error => {
            console.error("Error updating progress:", error.message);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
    
    // Open website in a new tab
    if (message.action === "openWebsite") {
        chrome.tabs.create({ url: message.url }, function (tab) {
            sendResponse({ success: true, tabId: tab.id });
        });
        return true;
    }
});

// Helper function to extract notebook name from URL
function extractNotebookNameFromUrl(url) {
    try {
        const parsedUrl = new URL(url);
        const pathname = parsedUrl.pathname;
        const parts = pathname.split('/');
        
        // Pattern 1: /app/[notebookName]
        if (parts.length >= 3 && parts[1] === 'app') {
            return decodeURIComponent(parts[2]);
        }
        
        // Pattern 2: /notebooks/[notebookId]/[notebookName]
        if (parts.length >= 4 && parts[1] === 'notebooks') {
            return decodeURIComponent(parts[3]);
        }
        
        // Pattern 3: /notebook/[id]/...
        if (parts.length >= 3 && parts[1] === 'notebook') {
            return "Sample Biology Notebook"; // Default fallback
        }
        
        return "Sample Biology Notebook";
    } catch (error) {
        console.error("Error parsing URL:", error);
        return "Sample Biology Notebook"; // Default fallback
    }
}

// Listen for tab updates to check if we're on a NotebookLM page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('notebooklm.google.com')) {
        // Check if user is authenticated
        if (!authToken) {
            console.log("User not authenticated, not injecting content script");
            return;
        }
        
        // User is authenticated, inject the content script
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        }).then(() => {
            console.log("Content script injected successfully");
        }).catch(err => {
            console.error("Error injecting content script:", err);
        });
    }
});