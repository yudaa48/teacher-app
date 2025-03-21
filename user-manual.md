# NISU Teacher App User Manual

This manual provides detailed instructions for using and administering the NISU Teacher App, including Datastore management and code deployment procedures.

## Table of Contents
1. [Application Overview](#application-overview)
2. [User Management](#user-management)
3. [Working with Notebooks](#working-with-notebooks)
4. [Datastore Administration](#datastore-administration)
5. [Deploying Code Updates](#deploying-code-updates)

## Application Overview

The NISU Teacher App is a web application that allows teachers to create and manage educational content organized into notebooks. Each notebook contains a playlist of content items that can be exported for use in a Chrome extension.

### Key Features
- Google Authentication for secure access
- Multiple notebooks organization
- Various content types (Prompts, Multimedia, Quizzes, etc.)
- Export functionality for Chrome extension

## User Management

### Adding New Teachers

Only registered teachers can access the NISU Teacher App. To register a new teacher:

1. Log in with an existing teacher account
2. Click the "Manage Users" button in the top right corner
3. Enter the new teacher's email address in the form
4. Click "Register" to add the teacher

The new teacher can now log in with their Google account using the registered email address.

## Working with Notebooks

### Creating a Notebook
1. Click the "New" button in the Notebooks sidebar
2. Enter a name for the notebook
3. Click "Create"

### Adding Content to a Notebook
1. Select a notebook from the sidebar
2. Enter content in the text field at the top
3. Select the content type from the dropdown (Prompt, Multimedia, Quiz, etc.)
4. Click "Add Item"
5. **Important**: Click "Save Changes" to store your updates to the database

### Editing Content
1. Select the notebook containing the content to edit
2. Modify the content text or type using the controls in each item card
3. **Important**: Click "Save Changes" to store your edits

### Deleting Content
1. Click the "Remove" button on any content item you wish to delete
2. **Important**: Click "Save Changes" to confirm the deletion

### Exporting a Notebook
1. Select the notebook you want to export
2. Click the "Export for Chrome Extension" button
3. The notebook will be downloaded as a JSON file that can be used in the Chrome extension

### Deleting a Notebook
1. Click the "×" button next to the notebook name in the sidebar
2. Confirm the deletion when prompted

## Datastore Administration

Google Datastore is used to store all application data. Here's how to access and manage it:

### Accessing Datastore
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to "Firestore" in the left menu (it may appear as "Datastore")
4. Click on "Data" to view the database entities

### Viewing Entities
Datastore contains three types of entities:
- **Notebook**: Contains notebook metadata and playlist items
- **User**: Stores teacher information and roles
- **Progress**: Tracks student progress through notebooks (created when students use the Chrome extension)

To view a specific entity type:
1. In the Datastore interface, click on the entity type in the "Kind" dropdown
2. Browse the list of entities
3. Click on any entity to view its details

### Example: Notebook Entity Structure
A typical Notebook entity contains:
- **name**: The notebook name (e.g., "Biology")
- **createdBy**: Email of the teacher who created it
- **playlist**: Array of content items with:
  - **id**: Unique identifier for the item
  - **command**: The content text or URL
  - **type**: Content type (Prompt, Multimedia, etc.)
- **updatedAt**: Timestamp of the last update

### Example: Progress Entity Structure
When students use the Chrome extension, Progress entities track their completion:
- **progressKey**: Combined notebook ID and student email
- **notebookId**: ID of the notebook
- **userEmail**: Email of the student
- **completedItems**: Array of completed item IDs
- **updatedAt**: Last update timestamp

### Manually Editing Entities
While most changes should be made through the app interface, you can manually edit entities if needed:

1. Find and select the entity to edit
2. Click "Edit" at the top of the entity details panel
3. Modify properties as needed
4. Click "Save" to apply changes

> **Warning**: Manual edits can cause data inconsistencies if not done carefully.

### Running GQL Queries
You can run database queries using GQL (similar to SQL):

1. Click "Run Query" at the top of the Datastore interface
2. Enter a GQL query, for example:
   ```
   SELECT * FROM Notebook WHERE createdBy = 'teacher@example.com'
   ```
3. Click "Run" to execute the query

## Deploying Code Updates

The NISU Teacher App code is hosted on GitHub at https://github.com/yudaa48/teacher-app and deployed to Google App Engine.

### Deploying from Local Machine

#### Prerequisites
- Git installed
- Google Cloud SDK installed
- Access to the GitHub repository

#### Deployment Steps
1. Clone the repository:
   ```bash
   git clone https://github.com/yudaa48/teacher-app.git
   cd teacher-app
   ```

2. Make sure you're authenticated with Google Cloud:
   ```bash
   gcloud auth login
   ```

3. Set the correct project:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

4. Deploy the application:
   ```bash
   gcloud app deploy
   ```

5. Access the deployed application:
   ```bash
   gcloud app browse
   ```

### Making Code Changes

1. Create a new branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your code changes
3. Test locally with:
   ```bash
   npm start
   ```

4. Commit your changes:
   ```bash
   git add .
   git commit -m "Description of changes"
   ```

5. Push to GitHub:
   ```bash
   git push origin feature/your-feature-name
   ```

6. Create a pull request on GitHub
7. After review and merge, deploy using the steps above

### Updating Frontend Code Only

If you only need to update the frontend (HTML, CSS, JavaScript):

1. Edit the files in the repository:
   - `index.html` for the main interface
   - CSS styles (inline or in the style section)
   - JavaScript functions

2. Commit and push changes to GitHub

3. Deploy using the command:
   ```bash
   gcloud app deploy
   ```

### Viewing Deployment Logs

To monitor your application and troubleshoot issues:

1. View real-time logs:
   ```bash
   gcloud app logs tail
   ```

2. Check for errors or warnings in the logs
3. Make changes as needed to fix any issues
4. Redeploy with `gcloud app deploy`

## Troubleshooting

### Common Issues and Solutions

1. **Authentication problems**:
   - Check that the OAuth credentials are properly configured in the Google Cloud Console
   - Verify that the correct redirect URIs are set

2. **Data not saving**:
   - Remember to click the "Save Changes" button after making modifications
   - Check browser console for any errors
   - Verify API responses in Network tab of browser DevTools

3. **Deployment failures**:
   - Check the deployment logs for error messages
   - Verify that all required APIs are enabled in Google Cloud Console

For additional support, please contact the project administrator.