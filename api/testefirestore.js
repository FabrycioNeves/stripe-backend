import admin from "firebase-admin";

// Pega a service account do env
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Inicializa o Firebase Admin se ainda não tiver inicializado
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default async function handler(req, res) {
  try {
    // Teste simples: cria/atualiza um doc "testeDoc" na coleção "teste"
    await admin
      .firestore()
      .collection("teste")
      .doc("testeDoc")
      .set({ ok: true });

    res.status(200).json({ message: "✅ Firestore OK" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
