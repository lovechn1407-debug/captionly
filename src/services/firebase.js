import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  child, 
  remove,
  push 
} from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBg9S65lRisez99F8lDicU33quzZ2rhD4E",
  authDomain: "captionly-4e228.firebaseapp.com",
  projectId: "captionly-4e228",
  storageBucket: "captionly-4e228.firebasestorage.app",
  messagingSenderId: "293573292680",
  appId: "1:293573292680:web:fedb468493fe7ad5afa53d",
  measurementId: "G-FESNELF1ZW",
  databaseURL: "https://captionly-4e228-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Guard against duplicate app init (happens during Vite HMR hot reloads)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Realtime Database
const db = getDatabase(app);

// Initialize Analytics safely (runs only in browser environments supporting it)
let analytics = null;
if (typeof window !== "undefined") {
  try {
    analytics = getAnalytics(app);
  } catch (error) {
    // Silently ignore — analytics may already be initialized on HMR reload
  }
}

/**
 * Saves a project's settings, style config, and captions.
 * @param {string} projectId 
 * @param {object} projectData 
 */
export async function saveProject(projectId, projectData) {
  const projectRef = ref(db, `projects/${projectId}`);
  const dataToSave = {
    ...projectData,
    updatedAt: Date.now(),
  };
  await set(projectRef, dataToSave);
  return dataToSave;
}

/**
 * Fetches a single project from Firebase.
 * @param {string} projectId 
 */
export async function getProject(projectId) {
  const dbRef = ref(db);
  const snapshot = await get(child(dbRef, `projects/${projectId}`));
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return null;
}

/**
 * Deletes a project.
 * @param {string} projectId 
 */
export async function deleteProject(projectId) {
  const projectRef = ref(db, `projects/${projectId}`);
  await remove(projectRef);
}

/**
 * Fetches all saved projects.
 */
export async function listProjects() {
  const dbRef = ref(db);
  const snapshot = await get(child(dbRef, "projects"));
  if (snapshot.exists()) {
    const data = snapshot.val();
    // Return as array sorted by last modified date (descending)
    return Object.keys(data).map(key => ({
      id: key,
      ...data[key]
    })).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return [];
}

export { app, db, analytics };
