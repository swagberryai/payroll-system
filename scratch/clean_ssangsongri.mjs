import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, deleteDoc, doc } from "firebase/firestore";

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

async function clean() {
  console.log("Cleaning up '쌍송리' and '이성진' from Firestore...");
  
  // 1. Delete stores with name "쌍송리"
  const storesRef = collection(db, "stores");
  const storeSnap = await getDocs(storesRef);
  for (const d of storeSnap.docs) {
    const data = d.data();
    if (data.name === "쌍송리" || data.code === "STR-002" || data.name?.includes("쌍송리")) {
      console.log("Deleting store:", d.id, data.name);
      await deleteDoc(doc(db, "stores", d.id));
    }
  }

  // 2. Delete employees named "이성진" or storeCode === "쌍송리"
  const empRef = collection(db, "employees");
  const empSnap = await getDocs(empRef);
  for (const d of empSnap.docs) {
    const data = d.data();
    if (data.name === "이성진" || data.storeCode === "쌍송리" || data.name?.includes("이성진")) {
      console.log("Deleting employee:", d.id, data.name, data.storeCode);
      await deleteDoc(doc(db, "employees", d.id));
    }
  }

  console.log("Cleanup complete!");
  process.exit(0);
}

clean().catch(console.error);
