// api/create-subscription.js
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
    const { userId, customerId, priceId } =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!userId || !customerId || !priceId) {
      return res
        .status(400)
        .json({ error: "userId, customerId e priceId são obrigatórios" });
    }

    // Cria subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      metadata: { userId }, // ESSENCIAL para webhook identificar o usuário
      expand: ["latest_invoice.payment_intent"],
    });

    // Salva dados iniciais no Firestore (não marca premium ainda)
    await admin.firestore().collection("users").doc(userId).set(
      {
        subscriptionId: subscription.id,
        subscriptionStatus: subscription.status,
        priceId,
        subscriptionCreatedAt: new Date(),
      },
      { merge: true }
    );

    // Retorna clientSecret da primeira invoice para o frontend
    const clientSecret =
      subscription.latest_invoice?.payment_intent?.client_secret || null;

    res.status(200).json({
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      clientSecret,
    });
  } catch (err) {
    console.error("❌ Erro ao criar assinatura:", err);
    res.status(500).json({ error: err.message });
  }
}
