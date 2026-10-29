yimport { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyDrMqldsm7s2urwNh_y5ot1wH7A-VANUDg",
  authDomain: "animalid-7d0ca.firebaseapp.com",
  projectId: "animalid-7d0ca",
  storageBucket: "animalid-7d0ca.firebasestorage.app",
  messagingSenderId: "396155391939",
  appId: "1:396155391939:web:f12ea161f6242f2fefb776",
  measurementId: "G-9TLGZGJ8F8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;