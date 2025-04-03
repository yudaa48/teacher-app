// app.js - Main Express application for Google App Engine
const express = require('express');
const { Datastore } = require('@google-cloud/datastore');
const { OAuth2Client } = require('google-auth-library');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Initialize Express
const app = express();
app.use(express.json());
app.use(cors());
// Add proper CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    return res.status(200).json({});
  }
  next();
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Google Datastore
const datastore = new Datastore();
const NOTEBOOK_KIND = 'Notebook';
const PROGRESS_KIND = 'Progress';
const USER_KIND = 'User';

// Initialize Google OAuth client
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET);
const API_BASE_URL = 'https://ai-dot-funkeai.uc.r.appspot.com/api'
const userRoleCache = new Map(); // Simple in-memory cache
const CACHE_TTL = 300000; // 5 minutes in milliseconds

// Authentication middleware
// Add this to your authenticate middleware in app.js
async function authenticate(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
      }
  
      const token = authHeader.split(' ')[1];
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: CLIENT_ID
      });
  
      const payload = ticket.getPayload();
      
      // Add token expiration check
      const currentTime = Math.floor(Date.now() / 1000);
      if (payload.exp < currentTime) {
        return res.status(401).json({ error: 'Unauthorized: Token expired' });
      }
  
      req.user = {
        email: payload.email,
        userId: payload.sub,
        name: payload.name,
        picture: payload.picture
      };
  
      next();
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  }

// Add this to your app.js
async function isAdmin(email) {
  try {
    const query = datastore
      .createQuery(USER_KIND)
      .filter('email', '=', email);
    
    const [users] = await datastore.runQuery(query);
    
    return users.length > 0 && users[0].role === 'admin';
  } catch (error) {
    console.error('Error checking admin role:', error);
    return false;
  }
}

// Create a middleware for admin-only routes
function requireAdmin(req, res, next) {
  const userEmail = req.user.email;
  
  isAdmin(userEmail).then(isUserAdmin => {
    if (isUserAdmin) {
      next(); // User is an admin, proceed
    } else {
      res.status(403).json({ error: 'Admin access required' });
    }
  }).catch(error => {
    console.error('Error in admin check:', error);
    res.status(500).json({ error: 'Internal server error' });
  });
}

// Helper to determine if the user is an admin/teacher
async function isTeacher(email) {
    try {
      // Check cache first
      const cachedData = userRoleCache.get(email);
      if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL)) {
        return cachedData.isTeacher;
      }
      
      // If not in cache or expired, query the database
      const query = datastore
        .createQuery(USER_KIND)
        .filter('email', '=', email);
      
      const [users] = await datastore.runQuery(query);
      
      const isTeacherResult = users.length > 0 && users[0].role === 'teacher';
      
      // Update cache
      userRoleCache.set(email, {
        isTeacher: isTeacherResult,
        timestamp: Date.now()
      });
      
      return isTeacherResult;
    } catch (error) {
      console.error('Error checking teacher role:', error);
      return false;
    }
  }

// Root endpoint serves the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add a route to serve the student interface
app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

// This handles the first login by creating a teacher user
app.post('/api/first-user', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    // Check if any users exist
    const query = datastore.createQuery(USER_KIND);
    const [users] = await datastore.runQuery(query);
    
    if (users.length === 0) {
      // This is the first user, make them a teacher
      const key = datastore.key(USER_KIND);
      const userEntity = {
        key: key,
        data: {
          email: userEmail,
          role: 'teacher',
          createdAt: new Date().toISOString()
        }
      };
      
      await datastore.save(userEntity);
      res.json({ success: true, message: 'First user created as teacher' });
    } else {
      // Check if this user exists
      const userQuery = datastore
        .createQuery(USER_KIND)
        .filter('email', '=', userEmail);
      
      const [existingUsers] = await datastore.runQuery(userQuery);
      
      if (existingUsers.length === 0) {
        res.status(403).json({ error: 'Not authorized. Contact an administrator.' });
      } else {
        res.json({ success: true, message: 'User already exists' });
      }
    }
  } catch (error) {
    console.error('Error creating first user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// API endpoint to get all notebooks for a teacher
app.get('/api/notebooks', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    // Check if user is a teacher
    if (!(await isTeacher(userEmail))) {
      console.log(`User ${userEmail} attempted to access notebooks but is not a teacher`);
      return res.status(403).json({ error: 'Not authorized to access notebooks' });
    }
    
    console.log(`Fetching notebooks for user: ${userEmail}`);
    
    // Query for notebooks created by this teacher
    const query = datastore
      .createQuery(NOTEBOOK_KIND)
      .filter('createdBy', '=', userEmail);
    
    const [notebooks] = await datastore.runQuery(query);
    console.log(`Found ${notebooks.length} notebooks for user ${userEmail}`);
    
    // Format data agar ID bisa digunakan
    const formattedNotebooks = notebooks.map(notebook => ({
      id: notebook[datastore.KEY]?.id || notebook[datastore.KEY]?.name, // Ambil ID atau Name
      ...notebook
    }));

    // Kirim respons ke client hanya sekali
    res.json({ notebooks: formattedNotebooks });

    // console.log(`Formatted data:`, formattedNotebooks);
  } catch (error) {
    console.error(`Database error fetching notebooks: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ error: 'Failed to fetch notebooks' });
  }
});

// API endpoint to get all notebook is assign to student for teacher
app.get('/api/students/notebooks/teacher', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;

    // Cek apakah user adalah seorang teacher
    if (!(await isTeacher(userEmail))) {
      console.log(`User ${userEmail} attempted to access notebooks but is not a teacher`);
      return res.status(403).json({ error: 'Not authorized to access notebooks' });
    }

    console.log(`Fetching notebooks student for user: ${userEmail}`);

    // Ambil semua data dari NOTEBOOK_STUDENT_KIND
    const queryNotebookStudent = datastore.createQuery(NOTEBOOK_STUDENT_KIND);
    const [notebookStudents] = await datastore.runQuery(queryNotebookStudent);

    if (!notebookStudents.length) {
      return res.status(404).json({ message: 'No notebook students found' });
    }

    // Ambil semua unique notebookId dari NOTEBOOK_STUDENT_KIND
    const notebookIds = [...new Set(notebookStudents.map(ns => ns.notebookId))];

    if (notebookIds.length === 0) {
      return res.status(404).json({ message: 'No associated notebooks found' });
    }

    // Query untuk mengambil data dari NOTEBOOK_KIND berdasarkan notebookId
    const notebookKeys = notebookIds.map(id => datastore.key([NOTEBOOK_KIND, parseInt(id)]));

    console.log('Notebook IDs:', notebookIds); // Log daftar notebookId yang akan diambil
    console.log('Notebook Keys:', notebookKeys); // Log daftar kunci yang digunakan untuk query

    // Ambil data dari NOTEBOOK_KIND
    const [notebooks] = await datastore.get(notebookKeys);

    console.log('Notebook Data:', notebooks); // Log data yang diambil dari NOTEBOOK_KIND

    // Buat mapping notebookId -> notebookName
    const notebookMap = notebooks.reduce((acc, notebook) => {
      const key = notebook[datastore.KEY]?.id?.toString(); // Pastikan key aman
      if (key) {
        acc[key] = notebook.name || 'Unknown'; // Gunakan 'Unknown' jika name tidak ditemukan
      }
      return acc;
    }, {});

    console.log('NOTEBOOK_KIND Mapping:', notebookMap); // Log hasil pemetaan notebookId -> notebookName

    // Gabungkan data dari NOTEBOOK_STUDENT_KIND dengan nama notebook dari NOTEBOOK_KIND
    const result = notebookStudents.map(studentNotebook => ({
      id: studentNotebook[datastore.KEY].id,
      assignedAt: studentNotebook.assignedAt,
      assignedBy: studentNotebook.assignedBy,
      studentEmail: studentNotebook.studentEmail,
      studentName: studentNotebook.studentName || 'Unknown', // Jika studentName undefined
      notebookId: studentNotebook.notebookId,
      notebookName: notebookMap[studentNotebook.notebookId] || 'Unknown' // Gunakan notebookMap
    }));

    console.log('Fetched Notebook Student:', result);
    res.status(200).json(result);
  } catch (error) {
    console.error(`Database error fetching notebook student: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ error: 'Failed to fetch notebook students' });
  }
});

// API endpoint to get student data based on notebooks assigned by a teacher
app.get('/api/students/notebooks/assignment/teacher', authenticate, async (req, res) => {
  let userEmail;
  try {
    userEmail = req.user.email;

    // Check if the user is a teacher
    if (!(await isTeacher(userEmail))) {
      console.log(`User ${userEmail} attempted to access notebooks but is not a teacher`);
      return res.status(403).json({ error: 'Not authorized to access notebooks' });
    }

    console.log(`Fetching student notebooks assigned by: ${userEmail}`);

    // Query to fetch all notebooks created by the teacher
    const queryNotebook = datastore
      .createQuery(NOTEBOOK_KIND)
      .filter('createdBy', '=', userEmail);

    const [notebooks] = await datastore.runQuery(queryNotebook);
    console.log(`Found ${notebooks.length} notebooks in notebook kind for user ${userEmail}`);

    const notebookDetails = [];

    for (const notebook of notebooks) {
      const notebookKey = notebook[datastore.KEY]; // Mengambil Key
      const notebookId = notebookKey ? notebookKey.id : null; // Mengambil ID dari Key

      if (!notebookId) {
        console.warn(`Skipping notebook without ID: ${JSON.stringify(notebook)}`);
        continue;
      }

      // Query untuk mendapatkan siswa terkait dengan notebookId
      const queryStudent = datastore
        .createQuery(NOTEBOOK_STUDENT_KIND)
        .filter('notebookId', '=', notebookId);

      const [students] = await datastore.runQuery(queryStudent);

      students.forEach(student => {
        notebookDetails.push({
          notebookId,
          studentName: student.studentName,
          studentEmail: student.studentEmail,
          notebookName: notebook.name || 'Untitled',
          playlist: Array.isArray(notebook.playlist) ? notebook.playlist : [], // Pastikan playlist adalah array
          createdBy: notebook.createdBy || 'Unknown'
        });
      });
    }

    res.json({ notebooks: notebookDetails });


  } catch (error) {
    console.error(`Database error fetching student notebooks assigned by ${userEmail || 'unknown user'}: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ error: 'Failed to fetch notebook students' });
  }
});

// API endpoint to get teacher data based on notebooks created by a teacher

// API endpoint to get all students for a teacher
app.get('/api/students/teacher', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    // Check if user is a teacher
    if (!(await isTeacher(userEmail))) {
      console.log(`User ${userEmail} attempted to access student data but is not a teacher`);
      return res.status(403).json({ error: 'Not authorized to access student data' });
    }

    console.log(`Fetching students for user: ${userEmail}`);
    
    // Query for all students in the datastore
    const query = datastore.createQuery(STUDENT_KIND);
    
    const [students] = await datastore.runQuery(query);
    console.log(`Found ${students.length} students`);
    
    // Format data so ID can be used
    const formattedStudents = students.map(student => ({
      id: student[datastore.KEY]?.id || student[datastore.KEY]?.name, // Get ID or Name
      createdAt: student.createdAt, 
      email: student.email, 
      name: student.name 
    }));

    // Send response with formatted student data
    res.json({ students: formattedStudents });

    // console.log(`Formatted data:`, formattedStudents);
  } catch (error) {
    console.error(`Database error fetching students: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// API endpoint to get all teachers for a teacher
app.get('/api/user/teacher', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    // Check if user is a teacher
    if (!(await isTeacher(userEmail))) {
      console.log(`User ${userEmail} attempted to access teacher data but is not a teacher`);
      return res.status(403).json({ error: 'Not authorized to access teacher data' });
    }

    console.log(`Fetching teachers for user: ${userEmail}`);
    
    // Query for all teachers in the datastore
    const query = datastore.createQuery(USER_KIND);
    
    const [teachers] = await datastore.runQuery(query);  // Change to teachers
    console.log(`Found ${teachers.length} teachers`);
    
    // Format data so ID can be used
    const formattedTeachers = teachers.map(teacher => ({  // Change student to teacher
      id: teacher[datastore.KEY]?.id || teacher[datastore.KEY]?.name, 
      email: teacher.email,
      registeredBy: teacher.registeredBy,
      createdAt: teacher.createdAt, 
    }));

    // Send response with formatted teacher data
    res.json({ teachers: formattedTeachers });

    // console.log(`Formatted data:`, formattedTeachers);
  } catch (error) {
    console.error(`Database error fetching teachers: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

// API endpoint to create or update a notebook
app.post('/api/notebooks', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { name, idFromNotebookLM, playlist } = req.body;
    
    // Check if user is a teacher
    if (!(await isTeacher(userEmail))) {
      return res.status(403).json({ error: 'Not authorized to create notebooks' });
    }
    
    if (!name ||!idFromNotebookLM || !Array.isArray(playlist)) {
      return res.status(400).json({ error: 'Invalid notebook data' });
    }
    
    // Check if notebook with this name already exists for this teacher
    const query = datastore
      .createQuery(NOTEBOOK_KIND)
      .filter('name', '=', name)
      .filter('createdBy', '=', userEmail);
    
    const [existingNotebooks] = await datastore.runQuery(query);
    
    let key;
    if (existingNotebooks.length === 0) {
      // Create a new notebook if none exists
      key = datastore.key(NOTEBOOK_KIND);
    } else {
      // Update existing notebook
      key = existingNotebooks[0][datastore.KEY];
    }
    
    // Prepare the entity data
    const notebookEntity = {
      key: key,
      data: {
        name: name,
        idFromNotebookLM: idFromNotebookLM,
        playlist: playlist,
        createdBy: userEmail,
        updatedAt: new Date().toISOString()
      }
    };
    
    // Save to Datastore
    await datastore.save(notebookEntity);
    
    res.json({ 
      success: true, 
      message: 'Notebook saved successfully',
      notebookId: key.id || key.name
    });
  } catch (error) {
    console.error('Error saving notebook:', error);
    res.status(500).json({ error: 'Failed to save notebook' });
  }
});

// API endpoint to get a specific notebook
app.get('/api/notebooks/:notebookId', authenticate, async (req, res) => {
  try {
    const { notebookId } = req.params;
    const key = datastore.key([NOTEBOOK_KIND, datastore.int(notebookId)]);
    
    const [notebook] = await datastore.get(key);
    
    if (!notebook) {
      return res.status(404).json({ error: 'Notebook not found' });
    }
    
    res.json({ notebook });
  } catch (error) {
    console.error('Error fetching notebook:', error);
    res.status(500).json({ error: 'Failed to fetch notebook' });
  }
});

// API endpoint to get a notebook by name
app.get('/api/notebooks/byName/:name', authenticate, async (req, res) => {
  try {
    const { name } = req.params;
    
    const query = datastore
      .createQuery(NOTEBOOK_KIND)
      .filter('name', '=', name);
    
    const [notebooks] = await datastore.runQuery(query);
    
    if (notebooks.length === 0) {
      return res.status(404).json({ error: 'Notebook not found' });
    }
    
    res.json({ notebook: notebooks[0] });
  } catch (error) {
    console.error('Error fetching notebook by name:', error);
    res.status(500).json({ error: 'Failed to fetch notebook' });
  }
});

// API endpoint for students to get their progress on a notebook
app.get('/api/progress/:notebookId', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { notebookId } = req.params;
    
    // Construct composite key (notebookId + userEmail)
    const progressKey = `${notebookId}_${userEmail}`;
    
    const query = datastore
      .createQuery(PROGRESS_KIND)
      .filter('progressKey', '=', progressKey);
    
    const [progressRecords] = await datastore.runQuery(query);
    
    if (progressRecords.length === 0) {
      // No progress record yet, create an empty one
      return res.json({ completedItems: [] });
    }
    
    res.json({ completedItems: progressRecords[0].completedItems || [] });
  } catch (error) {
    console.error('Error fetching progress:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// API endpoint for students to update their progress
// Modify the progress endpoint to handle more robust scenarios
app.post('/api/progress/:notebookId', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { notebookId, itemId, completed } = req.body;
    
    if (!itemId) {
      return res.status(400).json({ error: 'Item ID is required' });
    }
    
    // Construct composite key (notebookId + userEmail)
    const progressKey = `${notebookId}_${userEmail}`;
    
    const query = datastore
      .createQuery(PROGRESS_KIND)
      .filter('progressKey', '=', progressKey);
    
    const [progressRecords] = await datastore.runQuery(query);
    
    let key;
    let completedItems = [];
    
    if (progressRecords.length === 0) {
      // Create a new progress record
      key = datastore.key(PROGRESS_KIND);
    } else {
      // Update existing progress
      key = progressRecords[0][datastore.KEY];
      completedItems = progressRecords[0].completedItems || [];
    }
    
    // Update the completed items list
    if (completed && !completedItems.includes(itemId)) {
      completedItems.push(itemId);
    } else if (!completed && completedItems.includes(itemId)) {
      completedItems = completedItems.filter(id => id !== itemId);
    }
    
    // Prepare the progress entity
    const progressEntity = {
      key: key,
      data: {
        progressKey: progressKey,
        notebookId: notebookId,
        userEmail: userEmail,
        completedItems: completedItems,
        updatedAt: new Date().toISOString()
      }
    };
    
    // Save to Datastore
    await datastore.save(progressEntity);
    
    res.json({ 
      success: true, 
      message: 'Progress updated successfully',
      completedItems: completedItems
    });
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// API endpoint to register a teacher
app.post('/api/users/register', authenticate, async (req, res) => {
  try {
    const adminEmail = req.user.email;
    const { email } = req.body;
    
    // Check if the current user is already registered
    if (!(await isTeacher(adminEmail))) {
      return res.status(403).json({ error: 'Not authorized to register teachers' });
    }
    
    // Create a new teacher user
    const key = datastore.key(USER_KIND);
    const userEntity = {
      key: key,
      data: {
        email: email,
        role: 'teacher',
        registeredBy: adminEmail,
        createdAt: new Date().toISOString()
      }
    };
    
    // Save to Datastore
    await datastore.save(userEntity);
    
    res.json({ 
      success: true, 
      message: 'Teacher registered successfully'
    });
  } catch (error) {
    console.error('Error registering teacher:', error);
    res.status(500).json({ error: 'Failed to register teacher' });
  }
});

// Add this endpoint to your app.js file
app.delete('/api/notebooks/:notebookId', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { notebookId } = req.params;
    
    // Check if user is a teacher
    if (!(await isTeacher(userEmail))) {
      return res.status(403).json({ error: 'Not authorized to delete notebooks' });
    }
    
    // Get the notebook
    let key;
    
    // Check if notebookId is a number (ID) or string (name)
    if (!isNaN(notebookId)) {
      key = datastore.key([NOTEBOOK_KIND, datastore.int(notebookId)]);
    } else {
      // Find the notebook by name
      const query = datastore
        .createQuery(NOTEBOOK_KIND)
        .filter('name', '=', notebookId)
        .filter('createdBy', '=', userEmail);
      
      const [notebooks] = await datastore.runQuery(query);
      
      if (notebooks.length === 0) {
        return res.status(404).json({ error: 'Notebook not found' });
      }
      
      key = notebooks[0][datastore.KEY];
    }
    
    // Delete the notebook
    await datastore.delete(key);
    
    res.json({ success: true, message: 'Notebook deleted successfully' });
  } catch (error) {
    console.error('Error deleting notebook:', error);
    res.status(500).json({ error: 'Failed to delete notebook' });
  }
});

// Constants for student entities
const STUDENT_KIND = 'Student';
const NOTEBOOK_STUDENT_KIND = 'NotebookStudent';

// Add a route to handle Google authentication for students
app.get('/api/auth/google', (req, res) => {
  // const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  const redirectUri = `${API_BASE_URL}/auth/google/callback`;
  console.log('Using redirect URI:', redirectUri);
  
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&response_type=code&scope=email%20profile&redirect_uri=${encodeURIComponent(redirectUri)}&prompt=select_account`;
  
  res.redirect(authUrl);
});

// Improved Google OAuth Callback
app.get('/api/auth/google/callback', async (req, res) => {
  try {
      const code = req.query.code;
      const isPopup = req.query.popup === 'true';
      
      if (!code) {
          return res.status(400).send(`
              <!DOCTYPE html>
              <html>
              <head>
                  <title>Authentication Error</title>
                  <script>
                      window.close();
                  </script>
              </head>
              <body>
                  <h3>No authentication code received</h3>
              </body>
              </html>
          `);
      }
      
      console.log('Protocol:', req.protocol);
      console.log('Host:', req.get('host'));

      const redirectUri = `${API_BASE_URL}/auth/google/callback`;
      // Exchange code for tokens
      const tokenResponse = await client.getToken({
          code: code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: redirectUri
          // redirect_uri: `${req.protocol}://${req.get('host')}/api/auth/google/callback`
      });
      
      const idToken = tokenResponse.tokens.id_token;
      
      // Verify the token
      const ticket = await client.verifyIdToken({
          idToken: idToken,
          audience: CLIENT_ID
      });
      
      const payload = ticket.getPayload();
      
      // Check if this student exists in our database
      const studentQuery = datastore
          .createQuery(STUDENT_KIND)
          .filter('email', '=', payload.email);
      
      const [students] = await datastore.runQuery(studentQuery);
      
      let student;
      if (students.length === 0) {
          // Create new student record
          const studentKey = datastore.key(STUDENT_KIND);
          const studentEntity = {
              key: studentKey,
              data: {
                  email: payload.email,
                  name: payload.name,
                  picture: payload.picture,
                  createdAt: new Date().toISOString()
              }
          };
          
          await datastore.save(studentEntity);
          
          // Get the new student record
          const [newStudent] = await datastore.get(studentKey);
          student = {
              id: studentKey.id,
              ...newStudent
          };
      } else {
          // Existing student
          student = {
              id: students[0][datastore.KEY].id,
              ...students[0]
          };
      }
      
      // Prepare user data for frontend
      const userData = {
          id: student.id,
          email: student.email,
          name: student.name,
          picture: student.picture || null
      };
      
      // Return HTML with authentication result
      const responseHtml = `
      <!DOCTYPE html>
      <html>
      <head>
          <title>Authentication Successful</title>
          <script>
              function sendAuthResult() {
                  const authData = {
                      token: "${idToken}",
                      userData: ${JSON.stringify(userData)}
                  };
                  
                  // For popup window
                  if (window.opener) {
                      window.opener.postMessage(authData, '*');
                  }
                  
                  // Close the window
                  window.close();
              }
              
              // Ensure the message is sent after the page loads
              window.onload = sendAuthResult;
          </script>
      </head>
      <body>
          <h3>Authenticating...</h3>
          <p>You will be redirected shortly.</p>
      </body>
      </html>
      `;
      
      res.send(responseHtml);
  } catch (error) {
      console.error('Authentication error:', error);
      
      // Error response
      const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
          <title>Authentication Error</title>
          <script>
              function sendAuthError() {
                  const errorData = {
                      error: "${error.message.replace(/"/g, '\\"')}"
                  };
                  
                  if (window.opener) {
                      window.opener.postMessage(errorData, '*');
                  }
                  
                  window.close();
              }
              
              window.onload = sendAuthError;
          </script>
      </head>
      <body>
          <h3>Authentication Failed</h3>
          <p>An error occurred during authentication.</p>
      </body>
      </html>
      `;
      
      res.status(400).send(errorHtml);
  }
});

// Student Authentication middleware
async function authenticateStudent(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID
    });

    const payload = ticket.getPayload();
    
    // Check if this student exists in our database
    const query = datastore
      .createQuery(STUDENT_KIND)
      .filter('email', '=', payload.email);
    
    const [students] = await datastore.runQuery(query);
    
    let studentId;
    
    if (students.length === 0) {
      // *** ADD THIS SECTION TO AUTO-CREATE STUDENT RECORD ***
      console.log(`Student ${payload.email} not found. Creating record...`);
      
      // Create a new student entity
      const studentKey = datastore.key(STUDENT_KIND);
      const studentEntity = {
        key: studentKey,
        data: {
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          createdAt: new Date().toISOString()
        }
      };
      
      await datastore.save(studentEntity);
      studentId = studentKey.id;
      console.log(`Created student record with ID: ${studentId}`);
      // *** END OF NEW SECTION ***
    } else {
      studentId = students[0][datastore.KEY].id;
    }

    req.student = {
      email: payload.email,
      id: studentId,
      name: payload.name
    };

    next();
  } catch (error) {
    console.error('Student authentication error:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

// API endpoint to get notebooks for a student
app.get('/api/students/notebooks', authenticateStudent, async (req, res) => {
  try {
    const studentEmail = req.student.email;
    
    // Query for notebooks assigned to this student
    const query = datastore
      .createQuery(NOTEBOOK_STUDENT_KIND)
      .filter('studentEmail', '=', studentEmail);
    
    const [assignedNotebooks] = await datastore.runQuery(query);
    
    if (assignedNotebooks.length === 0) {
      return res.json({ notebooks: [] });
    }
    
    // Get the actual notebooks
    const notebooks = [];
    for (const assignment of assignedNotebooks) {
      const notebookKey = datastore.key([NOTEBOOK_KIND, parseInt(assignment.notebookId)]);
      const [notebook] = await datastore.get(notebookKey);
      
      if (notebook) {
        notebooks.push({
          id: assignment.notebookId,
          name: notebook.name,
          idFromNotebookLM: notebook.idFromNotebookLM,
          createdBy: notebook.createdBy,
          updatedAt: notebook.updatedAt
        });
      }
    }
    
    res.json({ notebooks });
  } catch (error) {
    console.error('Error fetching student notebooks:', error);
    res.status(500).json({ error: 'Failed to fetch notebooks' });
  }
});

// API endpoint to get a specific notebook's playlist for a student
app.get('/api/students/notebooks/:notebookName/playlist', authenticateStudent, async (req, res) => {
  try {
    const studentEmail = req.student.email;
    const { notebookName } = req.params;
    
    // Find the notebook by name
    const notebookQuery = datastore
      .createQuery(NOTEBOOK_KIND)
      .filter('name', '=', notebookName);
    
    const [notebooks] = await datastore.runQuery(notebookQuery);
    
    if (notebooks.length === 0) {
      return res.status(404).json({ error: 'Notebook not found' });
    }
    
    const notebook = notebooks[0];
    const notebookId = notebooks[0][datastore.KEY].id;
    
    // Check if the student has access to this notebook
    const assignmentQuery = datastore
      .createQuery(NOTEBOOK_STUDENT_KIND)
      .filter('notebookId', '=', notebookId.toString())
      .filter('studentEmail', '=', studentEmail);
    
    const [assignments] = await datastore.runQuery(assignmentQuery);
    
    if (assignments.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this notebook' });
    }
    
    // Get the student's progress for this notebook
    const progressKey = `${notebookId}_${studentEmail}`;
    const progressQuery = datastore
      .createQuery(PROGRESS_KIND)
      .filter('progressKey', '=', progressKey);
    
    const [progressRecords] = await datastore.runQuery(progressQuery);
    const completedItems = progressRecords.length > 0 ? progressRecords[0].completedItems || [] : [];
    
    // Create the playlist with completion status
    const playlist = notebook.playlist.map(item => {
      return {
        ...item,
        status: completedItems.includes(item.id) ? 'complete' : 'pending'
      };
    });
    
    // Format the response like the existing JSON structure
    res.json({
      playlist: playlist
    });
  } catch (error) {
    console.error('Error fetching notebook playlist:', error);
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// API endpoint to get a specific notebook's playlist for a student by ID
app.get('/api/students/notebooks/:notebookId/playlist', authenticateStudent, async (req, res) => {
  try {
    const studentEmail = req.student.email;
    const { notebookId } = req.params;
    
    // Verify the notebook exists
    const notebookKey = datastore.key([NOTEBOOK_KIND, parseInt(notebookId)]);
    const [notebook] = await datastore.get(notebookKey);
    
    if (!notebook) {
      return res.status(404).json({ error: 'Notebook not found' });
    }
    
    // Check if the student has access to this notebook
    const assignmentQuery = datastore
      .createQuery(NOTEBOOK_STUDENT_KIND)
      .filter('notebookId', '=', notebookId.toString())
      .filter('studentEmail', '=', studentEmail);
    
    const [assignments] = await datastore.runQuery(assignmentQuery);
    
    if (assignments.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this notebook' });
    }
    
    // Get the student's progress for this notebook
    const progressKey = `${notebookId}_${studentEmail}`;
    const progressQuery = datastore
      .createQuery(PROGRESS_KIND)
      .filter('progressKey', '=', progressKey);
    
    const [progressRecords] = await datastore.runQuery(progressQuery);
    const completedItems = progressRecords.length > 0 ? progressRecords[0].completedItems || [] : [];
    
    // Create the playlist with completion status
    const playlist = notebook.playlist.map(item => {
      return {
        ...item,
        status: completedItems.includes(item.id) ? 'complete' : 'pending'
      };
    });
    
    res.json({
      playlist: playlist,
      notebookId: notebookId
    });
  } catch (error) {
    console.error('Error fetching notebook playlist:', error);
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// API endpoint to update a student's progress
app.post('/api/students/progress', authenticateStudent, async (req, res) => {
  try {
    const studentEmail = req.student.email;
    let { notebookId, notebookName, itemId, completed } = req.body;
    
    if (!notebookId && !notebookName) {
      return res.status(400).json({ error: 'Notebook ID or Name is required' });
    }
    
    if (!itemId) {
      return res.status(400).json({ error: 'Item ID is required' });
    }
    
    // If we got a name but not an ID, try to find the notebook by name
    if (!notebookId && notebookName) {
      const notebookQuery = datastore
        .createQuery(NOTEBOOK_KIND)
        .filter('name', '=', notebookName);
      
      const [notebooks] = await datastore.runQuery(notebookQuery);
      
      if (notebooks.length > 0) {
        notebookId = notebooks[0][datastore.KEY].id.toString();
      } else {
        return res.status(404).json({ error: 'Notebook not found by name' });
      }
    }
    
    // Check if the student has access to this notebook
    const assignmentQuery = datastore
      .createQuery(NOTEBOOK_STUDENT_KIND)
      .filter('notebookId', '=', notebookId.toString())
      .filter('studentEmail', '=', studentEmail);
    
    const [assignments] = await datastore.runQuery(assignmentQuery);
    
    if (assignments.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this notebook' });
    }
    
    // Construct the progress key
    const progressKey = `${notebookId}_${studentEmail}`;
    
    // Check if a progress record exists
    const progressQuery = datastore
      .createQuery(PROGRESS_KIND)
      .filter('progressKey', '=', progressKey);
    
    const [progressRecords] = await datastore.runQuery(progressQuery);
    
    let key;
    let completedItems = [];
    
    if (progressRecords.length === 0) {
      // Create a new progress record
      key = datastore.key(PROGRESS_KIND);
    } else {
      // Update existing progress
      key = progressRecords[0][datastore.KEY];
      completedItems = progressRecords[0].completedItems || [];
    }
    
    // Update the completed items list
    if (completed && !completedItems.includes(itemId)) {
      completedItems.push(itemId);
    } else if (!completed && completedItems.includes(itemId)) {
      completedItems = completedItems.filter(id => id !== itemId);
    }
    
    // Prepare the progress entity
    const progressEntity = {
      key: key,
      data: {
        progressKey: progressKey,
        notebookId: notebookId,
        userEmail: studentEmail,
        completedItems: completedItems,
        updatedAt: new Date().toISOString()
      }
    };
    
    // Save to Datastore
    await datastore.save(progressEntity);
    
    res.json({ 
      success: true, 
      message: 'Progress updated successfully',
      completedItems: completedItems
    });
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({ error: 'Failed to update progress: ' + error.message });
  }
});

// Helper function to validate email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// API endpoint for teachers to get a spesific notebook's playlist by ID
app.get('/api/notebooks/teachers/:notebookId/playlist', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { notebookId } = req.params
    console.log("Notebook ID:", notebookId)

    // Check if user is a teacher
    if (!(await isTeacher(userEmail))) {
      console.log(`User ${userEmail} attempted to access notebooks but is not a teacher`);
      return res.status(403).json({ error: 'Not authorized to access notebooks' });
    }
    
    console.log(`Fetching notebooks for user: ${userEmail}`);

    // Verify the notebook exists
    const notebookKey = datastore.key([NOTEBOOK_KIND, parseInt(notebookId)]);
    const [notebook] = await datastore.get(notebookKey);
    
    if (!notebook) {
      return res.status(404).json({ error: 'Notebook not found' });
    }

    // Extract playlist
    const playlist = notebook.playlist || [];

    res.json({ playlist });
    
  } catch (error) {
    console.error(`Error fetching notebooks playlist:, ${error.message}`);
  }
})

// API endpoint for teachers to assign students to notebooks
app.post('/api/notebooks/:notebookId/students', authenticate, async (req, res) => {
  try {
    const { notebookId } = req.params;
    const { students } = req.body; 
    const teacherEmail = req.user.email;
    
    // Input validation
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid input: Students array is required and must not be empty' 
      });
    }

    // Check if user is a teacher
    if (!(await isTeacher(teacherEmail))) {
      return res.status(403).json({ error: 'Not authorized to assign students' });
    }
    
    // Verify the notebook exists and belongs to this teacher
    const notebookKey = datastore.key([NOTEBOOK_KIND, parseInt(notebookId)]);
    const [notebook] = await datastore.get(notebookKey);
    
    if (!notebook) {
      return res.status(404).json({ error: 'Notebook not found' });
    }
    
    if (notebook.createdBy !== teacherEmail) {
      return res.status(403).json({ error: 'Not authorized to modify this notebook' });
    }
    
    // Validate and process student data
    const validStudents = [];
    const invalidStudents = [];

    for (const student of students) {
      const studentEmail = student.email.trim();
      const studentName = student.name?.trim(); // Default name jika kosong

      console.log(`🔍 Checking student: ${studentEmail} - ${studentName}`);

      // Validate email format
      if (!isValidEmail(studentEmail)) {
        invalidStudents.push({
          email: studentEmail,
          name: studentName,
          reason: 'Invalid email format'
        });
        continue;
      }

      // Check if student already exists in the system
      const studentQuery = datastore
        .createQuery(STUDENT_KIND)
        .filter('email', '=', studentEmail);
      
      const [existingStudents] = await datastore.runQuery(studentQuery);
      
      // If student doesn't exist, create a student record
      if (existingStudents.length === 0) {
        const studentKey = datastore.key(STUDENT_KIND);
        const studentEntity = {
          key: studentKey,
          data: {
            email: studentEmail,
            name: studentName,
            createdAt: new Date().toISOString(),
            registeredBy: teacherEmail
          }
        };
        
        await datastore.save(studentEntity);
        console.log(`✅ Student added to STUDENT_KIND: ${studentEmail} - ${studentName}`);
      } else {
        console.log(`⚠️ Student already exists in STUDENT_KIND: ${studentEmail}`);
      }

      // Check if student is already assigned to this notebook
      const assignmentQuery = datastore
        .createQuery(NOTEBOOK_STUDENT_KIND)
        .filter('notebookId', '=', notebookId)
        .filter('studentEmail', '=', studentEmail);
      
      const [existingAssignments] = await datastore.runQuery(assignmentQuery);
      
      if (existingAssignments.length > 0) {
        invalidStudents.push({
          email: studentEmail,
          name: studentName,
          reason: 'Already assigned to this notebook'
        });
        continue;
      }

      validStudents.push({ email: studentEmail, name: studentName });
    }
    
    // Create assignments for valid students
    const assignments = validStudents.map(student => ({
      key: datastore.key(NOTEBOOK_STUDENT_KIND),
      data: {
        notebookId: notebookId,
        studentEmail: student.email,
        studentName: student.name, // Simpan nama dalam assignment
        assignedBy: teacherEmail,
        assignedAt: new Date().toISOString()
      }
    }));
    
    // Save assignments
    if (assignments.length > 0) {
      await datastore.save(assignments);
    }
    
    // Prepare response
    const response = {
      success: true,
      message: `${assignments.length} students assigned to notebook`,
      validStudents: validStudents,
      invalidStudents: invalidStudents
    };

    // Log the assignment action
    console.log(`📒 Teacher ${teacherEmail} assigned ${assignments.length} students to notebook ${notebookId}`);
    
    res.json(response);
  } catch (error) {
    console.error('❌ Error assigning students:', error);
    res.status(500).json({ 
      error: 'Failed to assign students', 
      details: error.message 
    });
  }
});


// API endpoint for teachers to import students via CSV
app.post('/api/students/import', authenticate, async (req, res) => {
  try {
    const { notebookId, csvData } = req.body;
    const teacherEmail = req.user.email;
    
    // Check if user is a teacher
    if (!(await isTeacher(teacherEmail))) {
      return res.status(403).json({ error: 'Not authorized to import students' });
    }
    
    // Validate CSV input
    if (!csvData || typeof csvData !== 'string') {
      return res.status(400).json({ error: 'Invalid CSV data' });
    }
    
    // Verify the notebook exists and belongs to this teacher
    let notebook = null;
    if (notebookId) {
      const notebookKey = datastore.key([NOTEBOOK_KIND, parseInt(notebookId)]);
      [notebook] = await datastore.get(notebookKey);
      
      if (!notebook) {
        return res.status(404).json({ error: 'Notebook not found' });
      }
      
      if (notebook.createdBy !== teacherEmail) {
        return res.status(403).json({ error: 'Not authorized to modify this notebook' });
      }
    }
    
    // Parsing CSV
    const parseCSV = (csvContent) => {
      const lines = csvContent.split(/\r\n|\n|\r/);
      const parsedStudents = [];
      const invalidEntries = [];

      lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;
        
        const parts = trimmedLine.split(/[,;|\t]/);
        let email, name;

        if (parts.length === 2) {
          [email, name] = parts.map(p => p.trim()); 
        } else if (parts.length === 1) {
          email = parts[0].trim(); 
          name = "Unknown"; 
        }

        if (isValidEmail(email)) {
          parsedStudents.push({ email, name });
        } else {
          invalidEntries.push({
            line: index + 1,
            content: trimmedLine,
            reason: 'Invalid email format'
          });
        }
      });

      return { parsedStudents, invalidEntries };
    };

    // Parse CSV
    const { parsedStudents, invalidEntries } = parseCSV(csvData);
    
    // Prepare student assignments
    const assignments = [];
    const validStudents = [];
    const alreadyAssignedStudents = [];

    // Process each student
    for (const { email: studentEmail, name } of parsedStudents) {
      console.log(`🔍 Checking student: ${studentEmail}`);

      const studentQuery = datastore.createQuery(STUDENT_KIND).filter('email', '=', studentEmail);
      const [existingStudents] = await datastore.runQuery(studentQuery);

      // console.log(`🔍 Querying student by email: ${studentEmail}`);
      // console.log(`📝 Raw query result:`, JSON.stringify(existingStudents, null, 2));

      if (!existingStudents || existingStudents.length === 0) {
          console.log(`✅ Student not found, proceeding with creation.`);
      } else {
          console.log(`⚠️ Student already exists, skipping creation.`);
      }

      if (!existingStudents || existingStudents.length === 0) {
          const studentKey = datastore.key(STUDENT_KIND);
          const studentEntity = {
              key: studentKey,
              data: {
                  email: studentEmail,
                  name: name || "Unknown",
                  createdAt: new Date().toISOString(),
                  registeredBy: teacherEmail
              }
          };

          // console.log(`💾 Saving new student: ${JSON.stringify(studentEntity, null, 2)}`);

          await datastore.save(studentEntity);
          console.log(`✅ Successfully saved student: ${studentEmail} - ${name}`);
      } else {
          console.log(`⚠️ Student already exists, skipping.`);
      }


      // Check if student is already assigned to this notebook
      if (notebookId) {
        const assignmentQuery = datastore
          .createQuery(NOTEBOOK_STUDENT_KIND)
          .filter('notebookId', '=', notebookId)
          .filter('studentEmail', '=', studentEmail);
        
        const [existingAssignments] = await datastore.runQuery(assignmentQuery);
        
        if (existingAssignments.length > 0) {
          alreadyAssignedStudents.push(studentEmail);
          continue;
        }
      }

      // Create assignment
      const assignmentKey = datastore.key(NOTEBOOK_STUDENT_KIND);
      const assignmentEntity = {
        key: assignmentKey,
        data: {
          notebookId: notebookId,
          studentEmail: studentEmail,
          assignedBy: teacherEmail,
          assignedAt: new Date().toISOString()
        }
      };
      
      assignments.push(assignmentEntity);
      validStudents.push(studentEmail);
    }
    
    // Save assignments
    if (assignments.length > 0) {
      await datastore.save(assignments);
    }
    
    // Prepare comprehensive response
    const response = {
      success: true,
      message: `${assignments.length} students imported`,
      totalAttempted: parsedStudents.length,
      validStudents,
      alreadyAssignedStudents,
      invalidEntries
    };

    // Log the import action
    console.log(`Teacher ${teacherEmail} imported ${assignments.length} students via CSV`);
    
    res.json(response);
  } catch (error) {
    console.error('Error importing students:', error);
    res.status(500).json({ 
      error: 'Failed to import students', 
      details: error.message 
    });
  }
});


// Helper function to check if an email is assigned to a notebook
async function isStudentAssignedToNotebook(studentEmail, notebookId) {
  const query = datastore
    .createQuery(NOTEBOOK_STUDENT_KIND)
    .filter('notebookId', '=', notebookId.toString())
    .filter('studentEmail', '=', studentEmail);
  
  const [assignments] = await datastore.runQuery(query);
  return assignments.length > 0;
}

// Student Authentication middleware with auto-creation
async function authenticateStudent(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID
    });

    const payload = ticket.getPayload();
    console.log("Student auth payload:", payload.email);
    
    // Check if this student exists in our database
    const query = datastore
      .createQuery(STUDENT_KIND)
      .filter('email', '=', payload.email);
    
    const [students] = await datastore.runQuery(query);
    
    let studentId;
    
    if (students.length === 0) {
      // Auto-create a student record
      console.log(`Student ${payload.email} not found. Creating record...`);
      
      // Create a new student entity
      const studentKey = datastore.key(STUDENT_KIND);
      const studentEntity = {
        key: studentKey,
        data: {
          email: payload.email,
          name: payload.name,
          picture: payload.picture,
          createdAt: new Date().toISOString()
        }
      };
      
      await datastore.save(studentEntity);
      
      // Get the new student record
      const [newStudent] = await datastore.get(studentKey);
      studentId = studentKey.id;
      console.log(`Created student record with ID: ${studentId}`);
      
      // Check if there are any notebook assignments for this student email
      const assignmentQuery = datastore
        .createQuery(NOTEBOOK_STUDENT_KIND)
        .filter('studentEmail', '=', payload.email);
      
      const [assignments] = await datastore.runQuery(assignmentQuery);
      
      // If no assignments, automatically assign the student to a notebook
      // so they can use the extension without requiring a teacher to assign them
      if (assignments.length === 0 && process.env.DEFAULT_NOTEBOOK_ID) {
        console.log(`No assignments found for ${payload.email}, adding default notebook assignment`);
        const defaultNotebookId = process.env.DEFAULT_NOTEBOOK_ID;
        
        const assignmentKey = datastore.key(NOTEBOOK_STUDENT_KIND);
        const assignmentEntity = {
          key: assignmentKey,
          data: {
            notebookId: defaultNotebookId,
            studentEmail: payload.email,
            assignedBy: "system",
            assignedAt: new Date().toISOString()
          }
        };
        
        await datastore.save(assignmentEntity);
        console.log(`Assigned student to default notebook: ${defaultNotebookId}`);
      }
    } else {
      studentId = students[0][datastore.KEY].id;
    }

    req.student = {
      email: payload.email,
      id: studentId,
      name: payload.name
    };

    next();
  } catch (error) {
    console.error('Student authentication error:', error);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

// Add this extra endpoint to help with debugging
app.get('/api/auth-status', authenticate, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const userRole = await isTeacher(userEmail) ? 'teacher' : 'student';
    
    // Check if user also has a student record
    const studentQuery = datastore
      .createQuery(STUDENT_KIND)
      .filter('email', '=', userEmail);
    
    const [students] = await datastore.runQuery(studentQuery);
    const hasStudentRecord = students.length > 0;
    
    // Get assigned notebooks if applicable
    const assignmentQuery = datastore
      .createQuery(NOTEBOOK_STUDENT_KIND)
      .filter('studentEmail', '=', userEmail);
    
    const [assignments] = await datastore.runQuery(assignmentQuery);
    
    res.json({
      email: userEmail,
      role: userRole,
      hasStudentRecord: hasStudentRecord,
      assignedNotebooks: assignments.length,
      authStatus: 'valid'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error checking authentication status' });
  }
});

// Also add this version for student authentication status
app.get('/api/student/auth-status', authenticateStudent, async (req, res) => {
  try {
    const studentEmail = req.student.email;
    
    // Get assigned notebooks
    const assignmentQuery = datastore
      .createQuery(NOTEBOOK_STUDENT_KIND)
      .filter('studentEmail', '=', studentEmail);
    
    const [assignments] = await datastore.runQuery(assignmentQuery);
    
    res.json({
      email: studentEmail,
      id: req.student.id,
      assignedNotebooks: assignments.length,
      authStatus: 'valid'
    });
  } catch (error) {
    res.status(500).json({ error: 'Error checking student authentication status' });
  }
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;