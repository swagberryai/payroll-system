import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBZFcfsqV55BTfyKBQsC-_S7ciLFt5cqks",
  authDomain: "my-firebase-app-82e01.firebaseapp.com",
  projectId: "my-firebase-app-82e01",
  storageBucket: "my-firebase-app-82e01.firebasestorage.app",
  messagingSenderId: "1071863424515",
  appId: "1:1071863424515:web:b6b34db5dc274354ce9036",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
  const storesSnap = await getDocs(collection(db, "stores"));
  console.log("Current Stores in Firestore:");
  storesSnap.docs.forEach((d) => console.log(d.id, d.data()));
  process.exit(0);
}

check().catch(console.error);
