// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCrt4pL8ru5NwITTkJ3EDYiPHLeb_aauhk",
  authDomain: "ffresearchr.firebaseapp.com",
  projectId: "ffresearchr",
  storageBucket: "ffresearchr.firebasestorage.app",
  messagingSenderId: "952150939228",
  appId: "1:952150939228:web:30347f717a36fc023c7899",
  measurementId: "G-WL1TMDCTM5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
