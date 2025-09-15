// api/cancel-subscription.js
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ error: "Subscription ID is required" });
    }

    const deleted = await stripe.subscriptions.del(subscriptionId);

    return res.status(200).json({ canceled: true, subscription: deleted });
  } catch (err) {
    console.error("❌ Erro ao cancelar assinatura:", err);
    return res.status(500).json({ error: err.message });
  }
}
