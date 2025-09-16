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
    const { userId, email } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ error: "userId e email são obrigatórios" });
    }

    // Verifica se já existe customerId no Firestore
    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (userDoc.exists && userDoc.data().customerId) {
      return res.status(200).json({ customerId: userDoc.data().customerId });
    }

    // Cria um novo customer no Stripe
    const customer = await stripe.customers.create({
      email,
      metadata: { userId },
    });

    // Salva o customerId no Firestore
    await userRef.set({ customerId: customer.id }, { merge: true });

    return res.status(200).json({ customerId: customer.id });
  } catch (err) {
    console.error("❌ Erro ao criar customer:", err);
    return res.status(500).json({ error: err.message });
  }
}
