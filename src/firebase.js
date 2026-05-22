import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

// Configuracion web del proyecto Firebase de la nueva sucursal.
const firebaseConfig = {
  apiKey: "AIzaSyAxNua6dWb-0u_d5FUYLEwgrdGYxKJbtJs",
  authDomain: "sistema-contable-csm-granada.firebaseapp.com",
  projectId: "sistema-contable-csm-granada",
  storageBucket: "sistema-contable-csm-granada.firebasestorage.app",
  messagingSenderId: "328470883059",
  appId: "1:328470883059:web:a08c7367893eab1bc5a586",
  measurementId: "G-RSLY1FP9W2"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);
