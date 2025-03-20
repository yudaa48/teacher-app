// create-test-entity.js
const {Datastore} = require('@google-cloud/datastore');

// Initialize Datastore
const datastore = new Datastore();

// Constants
const NOTEBOOK_KIND = 'Notebook';
const USER_KIND = 'User';

async function createTestEntities() {
  try {
    console.log('Creating test user and notebook...');
    
    // Your email - replace with your actual email that you use to sign in
    const userEmail = 'yudaa0110@gmail.com'; 
    
    // 1. First create a test user (teacher)
    const userKey = datastore.key(USER_KIND);
    const userEntity = {
      key: userKey,
      data: {
        email: userEmail,
        role: 'teacher',
        createdAt: new Date().toISOString()
      }
    };
    
    // 2. Create a test notebook
    const notebookKey = datastore.key(NOTEBOOK_KIND);
    const notebookEntity = {
      key: notebookKey,
      data: {
        name: 'Sample Biology Notebook',
        createdBy: userEmail,
        playlist: [
          {
            id: 'item-1',
            command: 'Explain photosynthesis in simple terms',
            type: 'Prompt'
          },
          {
            id: 'item-2',
            command: 'https://www.youtube.com/watch?v=sQK3Yr4Sc_k',
            type: 'Multimedia'
          },
          {
            id: 'item-3',
            command: 'https://quizlet.com/415105832/photosynthesis-flash-cards/',
            type: 'Quiz'
          }
        ],
        updatedAt: new Date().toISOString()
      }
    };
    
    // Save both entities
    await datastore.save([userEntity, notebookEntity]);
    
    console.log('Test entities created successfully!');
    console.log('User ID:', userKey.id || userKey.name);
    console.log('Notebook ID:', notebookKey.id || notebookKey.name);
    
    // Create a second notebook to test multiple notebooks feature
    const notebook2Key = datastore.key(NOTEBOOK_KIND);
    const notebook2Entity = {
      key: notebook2Key,
      data: {
        name: 'Sample Chemistry Notebook',
        createdBy: userEmail,
        playlist: [
          {
            id: 'chem-1',
            command: 'Explain the periodic table to a beginner',
            type: 'Prompt'
          },
          {
            id: 'chem-2',
            command: 'https://www.youtube.com/watch?v=rz4Dd1I_fX0',
            type: 'Multimedia'
          }
        ],
        updatedAt: new Date().toISOString()
      }
    };
    
    await datastore.save(notebook2Entity);
    console.log('Second notebook created with ID:', notebook2Key.id || notebook2Key.name);
    
  } catch (error) {
    console.error('Error creating test entities:', error);
  }
}

// Run the function
createTestEntities();