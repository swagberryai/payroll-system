import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, collection, getDocs, deleteDoc } from "firebase/firestore";

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

async function seed() {
  console.log("Seeding stores in Firestore...");
  
  // Clear old stores
  const snap = await getDocs(collection(db, "stores"));
  for (const d of snap.docs) {
    await deleteDoc(doc(db, "stores", d.id));
  }

  const stores = [
    {
      name: "해운로630",
      code: "STR-001",
      address: "부산 해운대구 해운로630번길 12",
      phone: "051-000-1111",
      businessNumber: "123-45-67890",
      businessCert: true,
      createdAt: new Date().toISOString(),
      updatedBy: "accounting_user"
    },
    {
      name: "고메스퀘어 부천점",
      code: "STR-002",
      address: "경기 부천시 원미구 길주로 180",
      phone: "032-320-1000",
      businessNumber: "234-56-78901",
      businessCert: true,
      createdAt: new Date().toISOString(),
      updatedBy: "accounting_user"
    },
    {
      name: "고메스퀘어 신대방점",
      code: "STR-003",
      address: "서울 동작구 신대방길 12",
      phone: "02-888-9999",
      businessNumber: "345-67-89012",
      businessCert: true,
      createdAt: new Date().toISOString(),
      updatedBy: "accounting_user"
    }
  ];

  for (const st of stores) {
    console.log("Writing store:", st.name);
    await setDoc(doc(db, "stores", st.code), st);
  }

  console.log("Stores seeded successfully!");
  process.exit(0);
}

seed().catch(console.error);
