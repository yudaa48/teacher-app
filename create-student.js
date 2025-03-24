// create-student.js
// Script to directly create a student record in the Datastore

const { Datastore } = require('@google-cloud/datastore');

// Initialize Google Datastore
const datastore = new Datastore();
const STUDENT_KIND = 'Student';
const NOTEBOOK_STUDENT_KIND = 'NotebookStudent';

async function createStudentRecord() {
  try {
    // Create a new student entity
    const studentKey = datastore.key(STUDENT_KIND);
    const studentEntity = {
      key: studentKey,
      data: {
        email: '',
        name: '',
        picture: '',
        createdAt: new Date().toISOString()
      }
    };
    
    await datastore.save(studentEntity);
    console.log(`Student record created with ID: ${studentKey.id}`);
    
    // Optionally, assign a notebook to this student
    if (process.argv.includes('--assign-notebook')) {
      const notebookId = ''; // Replace with your notebook ID
      
      const assignmentKey = datastore.key(NOTEBOOK_STUDENT_KIND);
      const assignmentEntity = {
        key: assignmentKey,
        data: {
          notebookId: notebookId,
          studentEmail: '', // Replace with a student email
          assignedBy: '', // Replace with a teacher email
          assignedAt: new Date().toISOString()
        }
      };
      
      await datastore.save(assignmentEntity);
      console.log(`Notebook ${notebookId} assigned to student`);
    }
    
    console.log('Done!');
  } catch (error) {
    console.error('Error creating student record:', error);
  }
}

createStudentRecord();