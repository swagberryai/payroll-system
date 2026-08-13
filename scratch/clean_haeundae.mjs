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
  console.log("Cleaning up '해운로630' and related data from Firestore...");

  // 1. Delete store '해운로630' / 'STR-001'
  const storesRef = collection(db, "stores");
  const storeSnap = await getDocs(storesRef);
  for (const d of storeSnap.docs) {
    const data = d.data();
    if (data.name === "해운로630" || data.code === "STR-001" || data.name?.includes("해운로")) {
      console.log("Deleting store:", d.id, data.name);
      await deleteDoc(doc(db, "stores", d.id));
    }
  }

  // 2. Delete employees linked to '해운로630' or 'STR-001' (e.g. 김태오)
  const empRef = collection(db, "employees");
  const empSnap = await getDocs(empRef);
  for (const d of empSnap.docs) {
    const data = d.data();
    if (data.storeCode === "해운로630" || data.storeCode === "STR-001" || data.name === "김태오") {
      console.log("Deleting employee:", d.id, data.name, data.storeCode);
      await deleteDoc(doc(db, "employees", d.id));
    }
  }

  // 3. Delete attendance linked to '해운로630' / 'STR-001'
  const attRef = collection(db, "attendance");
  const attSnap = await getDocs(attRef);
  for (const d of attSnap.docs) {
    const data = d.data();
    if (data.storeCode === "해운로630" || data.storeCode === "STR-001") {
      console.log("Deleting attendance:", d.id, data.date);
      await deleteDoc(doc(db, "attendance", d.id));
    }
  }

  console.log("Haeundae cleanup complete!");
  process.exit(0);
}

clean().catch(console.error);
