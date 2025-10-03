import Stripe from "stripe";
import admin from "firebase-admin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

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
    const { userId, email, name, phone, address } =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!userId || !email) {
      return res.status(400).json({ error: "userId e email são obrigatórios" });
    }

    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();

    let customerId;

    if (userDoc.exists && userDoc.data().customerId) {
      // Atualiza dados do Customer já existente
      customerId = userDoc.data().customerId;
      await stripe.customers.update(customerId, {
        email,
        name,
        phone,
        address,
        metadata: { userId },
      });
    } else {
      // Cria Customer novo com todos os dados
      const customer = await stripe.customers.create({
        email,
        name,
        phone,
        address,
        metadata: { userId },
      });

      customerId = customer.id;

      // Salva no Firestore
      await userRef.set({ customerId }, { merge: true });
    }

    return res.status(200).json({ customerId });
  } catch (err) {
    console.error("❌ Erro ao criar/atualizar customer:", err);
    return res.status(500).json({ error: err.message });
  }
}
