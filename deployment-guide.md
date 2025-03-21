# NISU Teacher App Deployment Guide

This guide provides step-by-step instructions for setting up and deploying the NISU Teacher application to Google App Engine.

## Prerequisites

- Google Cloud Platform account
- Google Cloud SDK installed on your computer
- Node.js and npm installed
- Git (optional, for version control)

## Step 1: Set Up Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your Project ID as you'll need it later

## Step 2: Configure Google OAuth

1. In the Google Cloud Console, navigate to **APIs & Services** > **OAuth consent screen**
   - Set User Type to "External" (or "Internal" if you have Google Workspace)
   - Fill in the App name, User support email, and Developer contact information
   - Add the scopes: `.../auth/userinfo.email` and `.../auth/userinfo.profile`
   - Add your email as a test user if in testing mode
   - Click "Save and Continue" through all steps

2. Go to **APIs & Services** > **Credentials**
   - Click "Create Credentials" and select "OAuth client ID"
   - Application type: "Web application"
   - Name: "NISU Teacher Web App"
   - Add Authorized JavaScript origins:
     - `http://localhost:8080` (for local testing)
     - `https://your-project-id.appspot.com` (replace with your actual project ID)
   - Add Authorized redirect URIs:
     - `http://localhost:8080`
     - `https://your-project-id.appspot.com`
   - Click "Create"
   - **Note down the Client ID** (you'll need this later)

## Step 3: Enable Required APIs

1. In the Google Cloud Console, go to **APIs & Services** > **Library**
2. Search for and enable these APIs:
   - Google Cloud Datastore API
   - Google App Engine Admin API
   - Identity and Access Management (IAM) API

## Step 4: Update Configuration Files

1. Update `app.yaml` with your OAuth client ID:
   ```yaml
   env_variables:
     GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID_HERE"
   ```

2. Update `index.html` with your OAuth client ID:
   ```javascript
   window.onload = function() {
       google.accounts.id.initialize({
           client_id: "YOUR_CLIENT_ID_HERE",
           callback: handleCredentialResponse
       });
       // ...
   }
   ```

3. In `index.html`, update the API base URL:
   ```javascript
   const API_BASE_URL = 'https://your-project-id.appspot.com/api';
   ```

## Step 5: Create Datastore Indexes

1. Create an `index.yaml` file in your project root:
   ```yaml
   indexes:
   - kind: Notebook
     properties:
     - name: createdBy
     - name: name
       direction: asc

   - kind: Progress
     properties:
     - name: userEmail
     - name: notebookId

   - kind: User
     properties:
     - name: email
     - name: role
   ```

2. Deploy the indexes to Datastore:
   ```bash
   gcloud datastore indexes create index.yaml
   ```

## Step 6: Prepare Your Project Files

Ensure your project has the following files:

- `app.js` - Main Express application backend
- `app.yaml` - Google App Engine configuration
- `index.yaml` - Datastore indexes configuration
- `package.json` - Node.js dependencies
- `index.html` - Frontend UI
- `public/` folder - For any static assets

## Step 7: Install Dependencies

```bash
npm install
```

This will install all the required dependencies listed in your package.json file.

## Step 8: Test Locally (Optional)

1. Start the local development server:
   ```bash
   npm start
   ```

2. Open a browser and go to `http://localhost:8080`
3. Test the authentication and app functionality

## Step 9: Deploy to Google App Engine

1. Make sure you're authenticated with Google Cloud:
   ```bash
   gcloud auth login
   ```

2. Set the current project:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

3. Deploy the application:
   ```bash
   gcloud app deploy
   ```

4. When prompted, select a region close to your users

5. Open your deployed application:
   ```bash
   gcloud app browse
   ```

## Step 10: Create Initial User Data

When you first access the application, you'll be signed in as the first user, which will automatically be registered as a teacher. If you need to set up additional test data:

### Option 1: Use the Create Test Data Endpoint (if implemented)

1. Sign in to the application
2. Navigate to `https://your-project-id.appspot.com/api/create-test-data`

### Option 2: Create Data Using the Web Interface

1. Sign in to the application
2. Create a new notebook
3. Add items to the notebook
4. Save the changes

## Step 11: Configure Chrome Extension (if applicable)

If you're also updating the Chrome extension to work with the new backend:

1. Update the extension's manifest.json with required permissions
2. Update the API endpoints in the extension code
3. Implement Google authentication in the extension
4. Test the extension against your deployed App Engine backend

## Troubleshooting

### Authentication Issues

- **Error: "The given origin is not allowed for the given client ID"**
  - Solution: Go back to the Google Cloud Console and verify that your origins are correctly set

- **Error: "Failed to fetch notebooks"**
  - Check App Engine logs: `gcloud app logs tail`
  - Verify your API endpoint is correctly implemented
  - Check for CORS issues

### Datastore Issues

- **Missing Data**
  - Check Datastore in Google Cloud Console (Firestore in Datastore mode)
  - Verify entity creation logic in your code

### Deployment Issues

- **Deployment Failures**
  - Check deployment logs for errors
  - Verify app.yaml configuration
  - Make sure all required APIs are enabled

## Maintenance

- **Viewing Logs**:
  ```bash
  gcloud app logs tail
  ```

- **Updating the App**:
  - Make your changes
  - Redeploy using `gcloud app deploy`

- **Monitoring**:
  - Use Google Cloud Console > App Engine > Dashboard

## Additional Resources

- [Google App Engine Documentation](https://cloud.google.com/appengine/docs/standard/nodejs)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Cloud Datastore Documentation](https://cloud.google.com/datastore/docs)