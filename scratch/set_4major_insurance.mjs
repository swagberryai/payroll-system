import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "demo-payroll-system"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const snapshot = await getDocs(collection(db, "employees"));
  let updatedCount = 0;
  
  for (const d of snapshot.docs) {
    const data = d.data();
    // Set 4대보험 for first two active part-timers
    if (data.employmentType === '아르바이트' && !data.resignDate) {
      if (updatedCount < 2) {
        await updateDoc(doc(db, "employees", d.id), { is4MajorInsurance: true });
        updatedCount++;
        console.log(`Updated ${data.name} to have 4대보험`);
      }
    }
  }
  console.log("Done");
}

run();
