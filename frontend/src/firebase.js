import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAAbkquVxkHYsnvfpHFRAXlYxjUJoSg9tY",
  authDomain: "financiera-95144.firebaseapp.com",
  projectId: "financiera-95144",
  storageBucket: "financiera-95144.firebasestorage.app",
  messagingSenderId: "661126590507",
  appId: "1:661126590507:web:1770b59f5fbc925a557a6e",
  measurementId: "G-TDJTGN2LER",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;