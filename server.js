require("dotenv").config();

const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ====================
// OpenAI
// ====================

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

// ====================
// Supabase
// ====================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

// Save chat data to Supabase
async function saveToSupabase(userMessage, aiReply) {
  if (!supabaseUrl || !supabaseKey) {
    console.log("⚠️ Supabase environment variables are missing.");
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        user_message: userMessage,
        ai_reply: aiReply
      })
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        "❌ Supabase insert failed:",
        response.status,
        errorText
      );

      return;
    }

    console.log("✅ Chat saved to Supabase");
  } catch (error) {
    console.error("❌ Supabase connection error:", error);
  }
}

// ====================
// Clinic
// ====================

const clinic = {
  name: "ABC Dental Clinic",
  city: "Bengaluru",
  address: "123 Main Road, Bengaluru (demo)",
  hours: "Monday–Saturday, 10:00 AM–7:00 PM. Sunday: closed.",
  phone: "+91 90000 00000 (demo)",
  services: [
    "Dental consultation",
    "Teeth cleaning",
    "Fillings",
    "Root-canal consultation",
    "Crowns and bridges",
    "Orthodontic consultation"
  ],
  fees: {
    consultation: "₹500",
    cleaning: "₹1,000"
  }
};

// ====================
// AI instructions
// ====================

const instructions = `You are DentalLead, the administrative AI receptionist for ${clinic.name}.

Clinic: ${clinic.name};
City: ${clinic.city};
Address: ${clinic.address};
Hours: ${clinic.hours};
Phone: ${clinic.phone};
Services: ${clinic.services.join(", ")};
Approved fees: consultation ${clinic.fees.consultation}, cleaning ${clinic.fees.cleaning}.

Rules:
Be warm, concise and professional.
Never diagnose, prescribe/recommend medication, invent facts, prices, availability or policies.
If clinical judgment is needed, say a dentist must assess the patient and offer an appointment request.
For severe pain, major swelling, uncontrolled bleeding, breathing difficulty or serious injury, advise contacting the clinic or seeking urgent appropriate care; do not diagnose.
Collect only name, preferred day/time and requested service for appointment requests.
Never claim a booking is confirmed; this demo only creates an appointment request.
Do not ask for unnecessary medical history or sensitive information.`;

// ====================
// Chat API
// ====================

app.post("/api/chat", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({
        error: "OPENAI_API_KEY is not configured."
      });
    }

    const ms = (req.body.messages || [])
      .slice(-12)
      .filter(
        (x) =>
          x &&
          (x.role === "user" || x.role === "assistant") &&
          typeof x.content === "string"
      );

    const r = await client.responses.create({
      model: "gpt-5.4-mini",
      instructions,
      input: ms.map((x) => ({
        role: x.role,
        content: x.content
      })),
      max_output_tokens: 350
    });

    const reply = r.output_text;

    // Find the latest user message
    const lastUserMessage =
      [...ms]
        .reverse()
        .find((m) => m.role === "user")
        ?.content || "";

    // Save the conversation to Supabase
    await saveToSupabase(lastUserMessage, reply);

    // Send response back to website
    res.json({
      reply
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: "AI request failed."
    });
  }
});

// ====================
// Health check
// ====================

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    supabaseConfigured: !!supabaseUrl && !!supabaseKey
  });
});

// ====================
// Start server
// ====================

app.listen(process.env.PORT || 3000, () => {
  console.log(
    "DentalLead: http://localhost:" +
      (process.env.PORT || 3000)
  );
});
