import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { telegram_id } = req.body;

  if (!telegram_id) {
    return res.status(400).json({ error: "Missing telegram_id" });
  }

  const response = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/createInvoiceLink`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "ImagifHub Premium",
        description: "Premium access for 30 days",
        payload: `premium_${telegram_id}`,
        currency: "XTR", // Telegram Stars
        prices: [{ label: "30 Days Premium", amount: 149 }],
      }),
    }
  );

  const data = await response.json();

  if (!data.ok) {
    return res.status(500).json(data);
  }

  res.status(200).json({ invoice_url: data.result });
}
