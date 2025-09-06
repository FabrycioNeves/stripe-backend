const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method === "POST") {
    try {
      // Confere se a chave do Stripe está presente
      if (!process.env.STRIPE_SECRET_KEY) {
        console.error("❌ STRIPE_SECRET_KEY não encontrada");
        return res.status(500).json({ error: "Stripe key missing" });
      }

      // Garante que o body está em JSON
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      console.log("📩 Body recebido:", body);

      const { amount } = body;

      if (!amount) {
        return res.status(400).json({ error: "Amount is required" });
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd", // ou "brl"
      });

      res.status(200).json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
      console.error("❌ Erro no endpoint:", err);
      res.status(500).json({ error: err.message });
    }
  } else {
    res.setHeader("Allow", "POST");
    res.status(405).end("Method Not Allowed");
  }
};
