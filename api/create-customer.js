// api/create-customer.js
import Stripe from "stripe";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// Inicializa Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId, email } =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!userId || !email) {
      return res.status(400).json({ error: "userId e email são obrigatórios" });
    }

    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();

    let customerId;

    if (userDoc.exists && userDoc.data().customerId) {
      // Se já existe, usa o mesmo
      customerId = userDoc.data().customerId;
    } else {
      // Se não existe, cria no Stripe
      const customer = await stripe.customers.create({
        email,
        metadata: { userId },
      });

      customerId = customer.id;

      // Salva no Firestore
      await userRef.set({ customerId }, { merge: true });
    }

    return res.status(200).json({ customerId });
  } catch (err) {
    console.error("❌ Erro ao criar customer:", err);
    return res.status(500).json({ error: err.message });
  }
}
