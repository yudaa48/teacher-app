// background.js - Updated with improved authentication support

// Constants
// const API_BASE_URL = 'https://funkeai.uc.r.appspot.com/api';
const API_BASE_URL = 'http://localhost:8080/api';
let authToken = null;
let userData = null;

// Initialize when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
    console.log("NISU Extension installed.");
    
    // Check if already authenticated
    chrome.storage.local.get(['authToken', 'userData'], function(data) {
        if (data.authToken && data.userData) {
            authToken = data.authToken;
            userData = data.userData;
            console.log("User already authenticated:", userData.email);
        }
    });
});

// Listen for tab updates to detect auth callback
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Check if this is a redirect from our auth endpoint with auth result in the URL
    if (changeInfo.status === 'complete' && tab.url) {
        console.log("Tab updated:", tab.url);
        
        // Look for auth callback in the URL
        if (tab.url.includes('/api/auth/google/callback') || tab.url.includes('auth_success=')) {
            console.log("Auth callback detected");
            
            // Parse the page content for auth data
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: extractAuthData
            }, (results) => {
                if (results && results.length > 0 && results[0].result) {
                    const authData = results[0].result;
                    console.log("Auth data extracted:", authData);
                    
                    if (authData.token && authData.userData) {
                        // Store auth data
                        authToken = authData.token;
                        userData = authData.userData;
                        
                        chrome.storage.local.set({
                            authToken: authToken,
                            userData: userData
                        }, () => {
                            console.log("Auth data saved to storage");
                            
                            // Send message to popup about successful auth
                            chrome.runtime.sendMessage({
                                action: "auth_success",
                                token: authToken,
                                userData: userData
                            });
                        });
                    } else if (authData.error) {
                        console.error("Auth error from callback:", authData.error);
                        chrome.runtime.sendMessage({
                            action: "auth_failure",
                            error: authData.error
                        });
                    }
                }
            });
        }
    }
});

// Function to extract auth data from the callback page
function extractAuthData() {
    console.log("Extracting auth data from page");
    
    try {
        // First try to parse the entire page body as JSON
        try {
            const pageText = document.body.innerText.trim();
            const jsonData = JSON.parse(pageText);
            console.log("Found JSON data in page:", jsonData);
            
            if (jsonData.token && jsonData.userData) {
                return jsonData;
            }
        } catch (e) {
            console.log("Page is not valid JSON, trying other methods");
        }
        
        // Look for pre-formatted JSON content
        const preElements = document.querySelectorAll('pre');
        for (const pre of preElements) {
            try {
                const jsonData = JSON.parse(pre.textContent.trim());
                console.log("Found JSON in pre element:", jsonData);
                if (jsonData.token) {
                    return jsonData;
                }
            } catch (e) {
                // Not valid JSON, continue to next element
            }
        }
        
        // Try to find JSON by regex
        const pageText = document.body.innerText;
        const jsonMatch = pageText.match(/(\{.*"token".*\})/);
        if (jsonMatch) {
            try {
                const jsonData = JSON.parse(jsonMatch[0]);
                console.log("Found JSON via regex:", jsonData);
                return jsonData;
            } catch (e) {
                console.log("Regex match is not valid JSON");
            }
        }
        
        console.log("No valid auth data found in page");
        return null;
    } catch (error) {
        console.error("Error extracting auth data:", error);
        return null;
    }
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background received message:", message.action);
    
    // Handle authentication messages
    if (message.action === "checkAuth") {
        console.log("Checking auth status:", !!authToken);
        sendResponse({ 
            isAuthenticated: !!authToken, 
            userData: userData 
        });
        return true;
    }
    
    // Handle login message from popup
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
            sendResponse({ success: true });
        });
        return true;
    }
    
    // Handle logout message
    if (message.action === "logout") {
        console.log("Logout message received");
        authToken = null;
        userData = null;
        
        // Clear auth data from Chrome storage
        chrome.storage.local.remove(['authToken', 'userData'], function() {
            console.log("Auth data cleared from local storage");
            sendResponse({ success: true });
        });
        return true;
    }
    
    // Debug auth state
    if (message.action === "debugAuth") {
        console.log("Debug auth request");
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
        console.log("Fetch notebooks request");
        if (!authToken) {
            console.error("Not authenticated");
            sendResponse({ success: false, error: "Not authenticated" });
            return true;
        }
        
        console.log("Fetching notebooks with token");
        fetch(`${API_BASE_URL}/students/notebooks`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        })
        .then(response => {
            console.log("Notebooks response status:", response.status);
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`Failed to fetch notebooks: ${text}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log("Notebooks data:", data);
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
        console.log("Fetch instructions request");
        // If not authenticated, fall back to the original implementation
        if (!authToken) {
            console.log("Not authenticated, falling back to default implementation");
            // Append a unique timestamp to bypass cache.
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
        } else {
            // Get the current notebook name from the active tab URL
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (tabs.length === 0) {
                    sendResponse({ success: false, error: "No active tab" });
                    return;
                }
                
                const url = new URL(tabs[0].url);
                console.log("Current URL:", url.toString());
                const notebookName = extractNotebookNameFromUrl(url.toString());
                console.log("Extracted notebook name:", notebookName);
                
                if (!notebookName) {
                    sendResponse({ success: false, error: "Could not determine notebook name" });
                    return;
                }
                
                // Fetch the playlist for this notebook
                console.log("Fetching playlist for notebook:", notebookName);
                fetch(`${API_BASE_URL}/students/notebooks/${encodeURIComponent(notebookName)}/playlist`, {
                    headers: {
                        'Authorization': `Bearer ${authToken}`
                    }
                })
                .then(response => {
                    console.log("Playlist response status:", response.status);
                    if (!response.ok) {
                        return response.text().then(text => {
                            throw new Error(`Failed to fetch playlist: ${text}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    console.log("Playlist data received");
                    sendResponse({ success: true, data: data });
                })
                .catch(error => {
                    console.error("Error fetching playlist:", error.message);
                    sendResponse({ success: false, error: error.message });
                });
            });
        }
        return true;
    }
    
    // Save progress for a specific notebook
    if (message.action === "updateProgress") {
        console.log("Update progress request");
        if (!authToken) {
            console.error("Not authenticated");
            sendResponse({ success: false, error: "Not authenticated" });
            return true;
        }
        
        console.log("Updating progress with data:", message.progress);
        fetch(`${API_BASE_URL}/students/progress`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(message.progress)
        })
        .then(response => {
            console.log("Progress update response status:", response.status);
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`Failed to update progress: ${text}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log("Progress update successful");
            sendResponse({ success: true, data: data });
        })
        .catch(error => {
            console.error("Error updating progress:", error.message);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
    
    // Handle website opening (keep original functionality)
    if (message.action === "openWebsite") {
        console.log("Open website request:", message.url);
        chrome.tabs.create({ url: message.url }, function (tab) {
            sendResponse({ success: true, tabId: tab.id });
        });
        return true;
    }
});

// Helper function to extract notebook name from URL
function extractNotebookNameFromUrl(url) {
    console.log("Extracting notebook name from URL:", url);
    
    try {
        const parsedUrl = new URL(url);
        const pathname = parsedUrl.pathname;
        console.log("URL pathname:", pathname);
        
        const parts = pathname.split('/');
        console.log("URL parts:", parts);
        
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
            // Look for a title in the document
            return "Sample Biology Notebook"; // Default fallback
        }
        
        // For testing/development
        return "Sample Biology Notebook";
    } catch (error) {
        console.error("Error parsing URL:", error);
        return "Sample Biology Notebook"; // Default fallback
    }
}

// Listen for tab updates to check if we're on a NotebookLM page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Check if this is a redirect from our auth endpoint
    if (changeInfo.status === 'complete' && tab.url) {
        console.log("Tab updated:", tab.url);
        
        // Look for auth callback in the URL
        if (tab.url.includes('/api/auth/google/callback')) {
            console.log("Auth callback detected");
            
            // Parse the page content for auth data
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: extractAuthData
            }, (results) => {
                if (results && results.length > 0 && results[0].result) {
                    const authData = results[0].result;
                    console.log("Auth data extracted:", authData);
                    
                    if (authData.token && authData.userData) {
                        // Store auth data
                        authToken = authData.token;
                        userData = authData.userData;
                        
                        chrome.storage.local.set({
                            authToken: authToken,
                            userData: userData
                        }, () => {
                            console.log("Auth data saved to storage");
                            
                            // Send message to popup about successful auth
                            chrome.runtime.sendMessage({
                                action: "auth_success",
                                token: authToken,
                                userData: userData
                            });
                            
                            // Close the tab after successful auth
                            setTimeout(() => {
                                chrome.tabs.remove(tabId);
                            }, 1000);
                        });
                    } else if (authData.error) {
                        console.error("Auth error from callback:", authData.error);
                        chrome.runtime.sendMessage({
                            action: "auth_failure",
                            error: authData.error
                        });
                    }
                } else {
                    console.log("No auth data found in page");
                }
            });
        }
    }
});