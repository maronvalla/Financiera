import { initializeApp } from "firebase/app";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";

function parseArgs() {
  const args = process.argv.slice(2);
  const payload = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    const value = args[i + 1];
    if (key === "--email") payload.email = value;
    if (key === "--password") payload.password = value;
    if (key === "--name") payload.name = value;
  }
  return payload;
}

const input = parseArgs();
if (!input.email || !input.password || !input.name) {
  console.error("Uso: node scripts/bootstrap-admin.mjs --email <email> --password <pass> --name <nombre>");
  process.exit(1);
}

const firebaseConfig = {
  apiKey: "demo-key",
  authDomain: "demo-financiera.firebaseapp.com",
  projectId: "demo-financiera",
  storageBucket: "demo-financiera.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:demo"
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);
connectFunctionsEmulator(functions, "localhost", 5001);

const bootstrapAdmin = httpsCallable(functions, "bootstrapAdmin");

bootstrapAdmin(input)
  .then((result) => {
    console.log("Admin creado:", result.data);
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
