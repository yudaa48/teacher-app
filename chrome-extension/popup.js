// popup.js - Updated to fix CORS issues

// Constants
// Change this to your local server address
const API_BASE_URL = 'http://localhost:8080/api';
// const API_BASE_URL = 'https://funkeai.uc.r.appspot.com/api';

// DOM Elements
const loginView = document.getElementById('loginView');
const userView = document.getElementById('userView');
const loadingView = document.getElementById('loadingView');
const signInButton = document.getElementById('signInButton');
const signOutButton = document.getElementById('signOutButton');
const activateButton = document.getElementById('activateButton');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const userEmail = document.getElementById('userEmail');
const notebookList = document.getElementById('notebookList');
const statusMessage = document.getElementById('statusMessage');
const loginStatus = document.getElementById('loginStatus');
const loginLoader = document.getElementById('loginLoader');

// Initialize popup
document.addEventListener('DOMContentLoaded', function() {
    console.log("NISU popup initialized");
    
    // Hide all views initially
    loginView.style.display = 'none';
    userView.style.display = 'none';
    loadingView.style.display = 'block';
    
    // Check if user is authenticated
    chrome.runtime.sendMessage({ action: 'checkAuth' }, function(response) {
        console.log("Auth check response:", response);
        if (response && response.isAuthenticated) {
            // User is authenticated, show user view
            showUserView(response.userData);
            // Fetch user's notebooks
            fetchNotebooks();
        } else {
            // User is not authenticated, show login view
            showLoginView();
        }
    });
    
    // Add event listeners
    signInButton.addEventListener('click', initiateGoogleSignIn);
    signOutButton.addEventListener('click', signOut);
    activateButton.addEventListener('click', activateOnCurrentPage);
});

// Show the login view
function showLoginView() {
    console.log("Showing login view");
    loginView.style.display = 'block';
    userView.style.display = 'none';
    loadingView.style.display = 'none';
}

// Show the user view
function showUserView(userData) {
    console.log("Showing user view for:", userData);
    loginView.style.display = 'none';
    userView.style.display = 'block';
    loadingView.style.display = 'none';
    
    // Update user information
    userAvatar.src = userData.picture || 'nisuext.png';
    userName.textContent = userData.name || 'User';
    userEmail.textContent = userData.email || '';
}

// Initiate Google Sign In
function initiateGoogleSignIn() {
    console.log("Initiating Google Sign In");
    loginStatus.textContent = '';
    loginLoader.style.display = 'block';
    
    // Open the auth page in a new tab instead of a popup window
    // This avoids CORS issues with window.closed
    chrome.tabs.create({ url: `${API_BASE_URL}/auth/google` }, function(tab) {
        console.log("Auth tab created:", tab.id);
        
        // Listen for messages from the background script
        const messageListener = function(message, sender) {
            console.log("Received message:", message);
            
            // Check if this is our auth success message
            if (message.action === "auth_success" && message.token && message.userData) {
                console.log("Auth success received");
                
                // Store the auth data
                chrome.runtime.sendMessage({
                    action: 'login',
                    token: message.token,
                    userData: message.userData
                }, function(response) {
                    console.log("Login response:", response);
                    if (response && response.success) {
                        // Authentication successful
                        showUserView(message.userData);
                        fetchNotebooks();
                    } else {
                        loginStatus.textContent = 'Error storing authentication data.';
                    }
                    loginLoader.style.display = 'none';
                });
                
                // Close the auth tab
                chrome.tabs.remove(tab.id);
                
                // Remove this listener
                chrome.runtime.onMessage.removeListener(messageListener);
            } 
            else if (message.action === "auth_failure" && message.error) {
                console.error("Auth failure:", message.error);
                loginStatus.textContent = 'Authentication failed: ' + message.error;
                loginLoader.style.display = 'none';
                
                // Close the auth tab
                chrome.tabs.remove(tab.id);
                
                // Remove this listener
                chrome.runtime.onMessage.removeListener(messageListener);
            }
        };
        
        // Add listener for auth success/failure messages
        chrome.runtime.onMessage.addListener(messageListener);
        
        // Set a timeout to remove the listener if no response is received
        setTimeout(function() {
            chrome.runtime.onMessage.removeListener(messageListener);
            loginLoader.style.display = 'none';
            loginStatus.textContent = 'Authentication timed out. Please try again.';
        }, 60000); // 1 minute timeout
    });
}

// Sign out
function signOut() {
    console.log("Signing out");
    chrome.runtime.sendMessage({ action: 'logout' }, function(response) {
        console.log("Logout response:", response);
        if (response && response.success) {
            showLoginView();
        }
    });
}

// Fetch user's notebooks
function fetchNotebooks() {
    console.log("Fetching notebooks");
    chrome.runtime.sendMessage({ action: 'fetchNotebooks' }, function(response) {
        console.log("Fetch notebooks response:", response);
        if (response && response.success && response.data && response.data.notebooks) {
            displayNotebooks(response.data.notebooks);
        } else {
            statusMessage.textContent = 'No notebooks found or error fetching notebooks.';
            console.error("Error fetching notebooks:", response ? response.error : "No response");
            notebookList.innerHTML = '';
        }
    });
}

// Display list of notebooks
function displayNotebooks(notebooks) {
    console.log("Displaying notebooks:", notebooks);
    notebookList.innerHTML = '';
    
    if (notebooks.length === 0) {
        statusMessage.textContent = 'No notebooks assigned to you.';
        return;
    }
    
    notebooks.forEach(notebook => {
        const item = document.createElement('div');
        item.className = 'notebook-item';
        item.textContent = notebook.name;
        item.addEventListener('click', function() {
            openNotebook(notebook);
        });
        notebookList.appendChild(item);
    });
    
    statusMessage.textContent = 'Click on a notebook to activate the NISU helper.';
}

// Open a notebook in NotebookLM
function openNotebook(notebook) {
    console.log("Opening notebook:", notebook);
    // This is a placeholder - you'll need to adjust the URL format
    const notebookURL = `https://notebooklm.google.com/app/${encodeURIComponent(notebook.name)}`;
    
    // Check if we're already on a NotebookLM page
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs[0].url.includes('notebooklm.google.com')) {
            // We're already on NotebookLM, update the URL
            chrome.tabs.update(tabs[0].id, { url: notebookURL });
        } else {
            // Open a new tab with NotebookLM
            chrome.tabs.create({ url: notebookURL });
        }
        
        // Close the popup
        window.close();
    });
}

// Activate on current page
function activateOnCurrentPage() {
    console.log("Activating on current page");
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (!tabs[0].url.includes('notebooklm.google.com')) {
            statusMessage.textContent = 'Please navigate to NotebookLM first.';
            return;
        }
        
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: injectContentScript
        });
        
        // Close the popup
        window.close();
    });
}

// Function to inject the content script
function injectContentScript() {
    // First check if the content script is already injected
    if (document.querySelector('#nisu-extension-overlay')) {
        console.log('NISU Extension is already active on this page.');
        return;
    }
    
    // Load the content script
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content.js');
    script.onload = function() {
        this.remove();
    };
    
    (document.head || document.documentElement).appendChild(script);
    console.log('NISU Extension activated on this page.');
}