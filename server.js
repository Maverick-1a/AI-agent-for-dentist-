require("dotenv").config();

const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();

app.use(express.json({ limit: "50kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ========================================
// OpenAI
// ========================================

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

// ========================================
// Supabase
// ========================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;

// ========================================
// Clinic information
// ========================================

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

// ========================================
// DentalLead instructions
// ========================================

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
Never diagnose, prescribe medication, or provide medical treatment advice.
Never invent facts, prices, availability or clinic policies.
If clinical judgment is needed, say a dentist must assess the patient.
For severe pain, major swelling, uncontrolled bleeding, breathing difficulty or serious injury, advise contacting the clinic or seeking urgent appropriate care.
Do not ask for unnecessary medical history or sensitive information.

For an appointment request, naturally collect:
1. Name
2. Phone number
3. Email address (optional)
4. Requested dental service
5. Preferred day/date
6. Preferred time
7. Optional notes

Never claim that an appointment is confirmed.
This system only creates an appointment request.
Tell the visitor that the clinic will contact them to confirm the appointment.`;

// ========================================
// Extract lead information from conversation
// ========================================

async function extractLead(messages) {
  try {
    if (!client) return null;

    const conversation = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n");

    const extractionPrompt = `Extract appointment lead information from the conversation below.

Return ONLY valid JSON.
Do not use markdown.
Do not add explanations.

Use exactly this structure:

{
  "is_lead": false,
  "name": null,
  "phone": null,
  "email": null,
  "service": null,
  "preferred_date": null,
  "preferred_time": null,
  "notes": null
}

Set "is_lead" to true ONLY when the visitor is clearly requesting an appointment AND the following are available:
- name
- phone
- service
- preferred date
- preferred time

Email is optional.

Never invent missing information.
Use null when information is missing.
Keep values as plain text.

Conversation:
${conversation}`;

    const result = await client.responses.create({
      model: "gpt-5.4-mini",
      input: extractionPrompt,
      max_output_tokens: 250
    });

    const text = result.output_text.trim();

    // Try to find JSON if the model unexpectedly surrounds it with text
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1) {
      console.error("Lead extraction did not return JSON:", text);
      return null;
    }

    const jsonText = text.slice(start, end + 1);
    const lead = JSON.parse(jsonText);

    return lead;
  } catch (error) {
    console.error("Lead extraction error:", error);
    return null;
  }
}

// ========================================
// Save chat to chat_logs
// ========================================

async function saveChatLog(userMessage, aiReply) {
  if (!supabaseUrl || !supabaseKey) {
    console.log("⚠️ Supabase is not configured.");
    return;
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/chat_logs`,
      {
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
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        "❌ chat_logs insert failed:",
        response.status,
        errorText
      );
    } else {
      console.log("✅ Chat saved to Supabase");
    }
  } catch (error) {
    console.error("❌ chat_logs error:", error);
  }
}

// ========================================
// Check whether this phone already exists
// ========================================

async function leadAlreadyExists(phone) {
  if (!supabaseUrl || !supabaseKey || !phone) {
    return false;
  }

  try {
    const url =
      `${supabaseUrl}/rest/v1/leads` +
      `?select=id` +
      `&phone=eq.${encodeURIComponent(phone)}` +
      `&limit=1`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        "❌ Lead duplicate check failed:",
        response.status,
        errorText
      );

      return false;
    }

    const rows = await response.json();

    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    console.error("❌ Lead duplicate check error:", error);
    return false;
  }
}

// ========================================
// Save lead to Supabase
// ========================================

async function saveLead(lead) {
  if (!supabaseUrl || !supabaseKey) {
    console.log("⚠️ Supabase is not configured.");
    return;
  }

  if (
    !lead ||
    !lead.is_lead ||
    !lead.name ||
    !lead.phone ||
    !lead.service ||
    !lead.preferred_date ||
    !lead.preferred_time
  ) {
    return;
  }

  try {
    // Avoid creating repeated leads for the same phone number
    const exists = await leadAlreadyExists(lead.phone);

    if (exists) {
      console.log("ℹ️ Lead already exists for this phone number.");
      return;
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/leads`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          name: lead.name,
          phone: lead.phone,
          email: lead.email || null,
          service: lead.service,
          preferred_date: lead.preferred_date,
          preferred_time: lead.preferred_time,
          notes: lead.notes || null,
          status: "new"
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        "❌ leads insert failed:",
        response.status,
        errorText
      );

      return;
    }

    console.log("✅ NEW DENTAL LEAD SAVED TO SUPABASE");
  } catch (error) {
    console.error("❌ Lead save error:", error);
  }
}

// ========================================
// Chat API
// ========================================

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

    // ------------------------------------
    // Generate normal chatbot response
    // ------------------------------------

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

    // ------------------------------------
    // Find most recent user message
    // ------------------------------------

    const lastUserMessage =
      [...ms]
        .reverse()
        .find((m) => m.role === "user")
        ?.content || "";

    // ------------------------------------
    // Save normal chat log
    // ------------------------------------

    await saveChatLog(lastUserMessage, reply);

    // ------------------------------------
    // Extract possible appointment lead
    // ------------------------------------

    const lead = await extractLead(ms);

    if (lead && lead.is_lead) {
      await saveLead(lead);
    }

    // ------------------------------------
    // Send response to frontend
    // ------------------------------------

    res.json({
      reply
    });
  } catch (error) {
    console.error("❌ Chat API error:", error);

    res.status(500).json({
      error: "AI request failed."
    });
  }
});

// ========================================
// Health check
// ========================================

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    supabaseConfigured:
      !!supabaseUrl && !!supabaseKey
  });
});

// ========================================
// Start server
// ========================================

app.listen(process.env.PORT || 3000, () => {
  console.log(
    "DentalLead: http://localhost:" +
      (process.env.PORT || 3000)
  );
});
