// /api/cancel-subscription-end.js

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
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { userId, subscriptionId } =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!userId || !subscriptionId) {
      return res
        .status(400)
        .json({ error: "userId e subscriptionId são obrigatórios" });
    }

    // Verifica se a assinatura pertence ao usuário
    const userRef = admin.firestore().collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists || userDoc.data().subscriptionId !== subscriptionId) {
      return res
        .status(403)
        .json({ error: "Assinatura não pertence a este usuário" });
    }

    // Marca para cancelar no final do período atual
    const updatedSubscription = await stripe.subscriptions.update(
      subscriptionId,
      { cancel_at_period_end: true }
    );

    // Atualiza Firestore para refletir que o cancelamento está programado
    await userRef.set(
      {
        subscriptionStatus: "canceling",
        premium: true, // usuário ainda tem acesso até o final do período
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        cancelAt: updatedSubscription.current_period_end * 1000, // timestamp em ms
      },
      { merge: true } // evita apagar outros dados do user
    );

    return res.status(200).json({
      canceled: true,
      subscription: updatedSubscription,
      message: "Assinatura será cancelada no final do período atual",
    });
  } catch (err) {
    console.error("Erro ao cancelar assinatura:", err.message);
    return res
      .status(500)
      .json({ error: "Não foi possível cancelar a assinatura" });
  }
}
