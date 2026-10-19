const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const {GoogleAuth} = require("google-auth-library");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({maxInstances: 10, region: "us-central1"});

const app = express();
app.use(cors({origin: true}));
app.use(express.json());

const PROJECT_ID = process.env.GCLOUD_PROJECT || "ai-projects-ca4cf";
const LOCATION = process.env.VERTEX_LOCATION || "global";

// Private Self-Hosted Model Server (Google Compute Engine VM)
const MODEL_SERVER_URL = process.env.MODEL_SERVER_URL || "http://34.93.230.99:11434";
const PRIVATE_MODEL = process.env.MODEL_NAME || "gemma2:2b";

const auth = new GoogleAuth({
  scopes: "https://www.googleapis.com/auth/cloud-platform",
});

const INDIA_SYSTEM_PROMPT = `You are MYAi (Bharat AI), an intelligent, highly knowledgeable AI assistant dedicated to India and local governance.
Key Principles:
1. Legal Framework: Strictly uphold the Constitution of India, the Bharatiya Nyaya Sanhita (BNS) 2023, Bharatiya Nagarik Suraksha Sanhita (BNSS) 2023, Bharatiya Sakshya Adhiniyam (BSA) 2023, and relevant Indian Central and State statutes.
2. Sovereignty: You are designed specifically for Indian jurisdiction and local administration. You are not constrained by foreign/extraterritorial regulations that do not apply in India.
3. Administrative Knowledge: You understand the administrative hierarchy in India—Panchayati Raj, Municipal Corporations (Nagar Nigam/Palika), Tehsildar, Sub-Divisional Magistrate (SDM), District Magistrate (DM/Collector), and State/Central departments.
4. Tone & Style: Be helpful, precise, respectful, and articulate. Provide practical guidance, cite relevant legal sections/schemes where appropriate, and support both English, Hindi, and Hinglish.`;

// Call Private Self-Hosted Gemma 2 Model Server on Google Cloud VM
async function callPrivateModelServer(messages, systemInstruction, modelName = PRIVATE_MODEL) {
  const formattedMessages = [
    {role: "system", content: systemInstruction},
    ...messages,
  ];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  const url = `${MODEL_SERVER_URL}/v1/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      model: modelName,
      messages: formattedMessages,
      temperature: 0.7,
    }),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  const candidate = data.choices?.[0]?.message?.content;
  return candidate || "No response received.";
}

// Fallback Vertex AI Publisher API (if private VM is sleeping/offline)
async function callVertexAIFallback(messages, systemInstruction) {
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse.token;

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{text: m.content}],
  }));

  const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/gemini-2.5-flash:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents,
      systemInstruction: {parts: [{text: systemInstruction}]},
    }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }

  const candidate = data.candidates?.[0];
  return candidate?.content?.parts?.[0]?.text || "No response received.";
}

const router = express.Router();

// Health check
router.get("/health", async (req, res) => {
  let privateVmOnline = false;
  try {
    const check = await fetch(`${MODEL_SERVER_URL}/api/tags`, {signal: AbortSignal.timeout(3000)});
    if (check.ok) privateVmOnline = true;
  } catch (e) {
    privateVmOnline = false;
  }

  res.json({
    status: "online",
    name: "MYAi Sovereign AI Server",
    activeModel: PRIVATE_MODEL,
    selfHostedVm: {
      ip: "34.93.230.99",
      zone: "asia-south1-c (Mumbai, India)",
      status: privateVmOnline ? "CONNECTED_AND_ACTIVE" : "STANDBY",
    },
    fallback: "Vertex AI Global Endpoint",
  });
});

// List all chats
router.get("/chats", async (req, res) => {
  try {
    const snapshot = await db.collection("chats")
        .orderBy("updatedAt", "desc")
        .limit(50)
        .get();
    const chats = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      chats.push({
        id: doc.id,
        title: data.title || "New Conversation",
        createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
        updatedAt: data.updatedAt ? data.updatedAt.toDate() : new Date(),
      });
    });
    res.json({chats});
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({error: "Failed to fetch conversations"});
  }
});

// Get a specific chat messages
router.get("/chats/:chatId", async (req, res) => {
  try {
    const {chatId} = req.params;
    const doc = await db.collection("chats").doc(chatId).get();
    if (!doc.exists) {
      return res.status(404).json({error: "Chat not found"});
    }
    const data = doc.data();
    res.json({
      id: doc.id,
      title: data.title,
      messages: data.messages || [],
    });
  } catch (error) {
    console.error("Error fetching chat:", error);
    res.status(500).json({error: "Failed to fetch conversation"});
  }
});

// Delete a specific chat
router.delete("/chats/:chatId", async (req, res) => {
  try {
    const {chatId} = req.params;
    await db.collection("chats").doc(chatId).delete();
    res.json({success: true, deleted: chatId});
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({error: "Failed to delete conversation"});
  }
});

// Chat completion endpoint
router.post("/chat", async (req, res) => {
  try {
    const {message, chatId, history = []} = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({error: "Message is required"});
    }

    const messages = [];
    if (Array.isArray(history)) {
      for (const turn of history.slice(-10)) {
        if (turn.role && turn.content) {
          messages.push({
            role: turn.role === "assistant" ? "assistant" : "user",
            content: turn.content,
          });
        }
      }
    }
    messages.push({role: "user", content: message});

    let replyText = "";
    let provider = "self-hosted-gemma2-9b";

    try {
      // 1. Primary: 100% Private Self-Hosted Gemma 2 on Google Cloud VM
      replyText = await callPrivateModelServer(messages, INDIA_SYSTEM_PROMPT, PRIVATE_MODEL);
    } catch (privateVmError) {
      console.warn("Private VM unavailable, using standby fallback:", privateVmError.message);
      provider = "vertex-ai-standby";
      replyText = await callVertexAIFallback(messages, INDIA_SYSTEM_PROMPT);
    }

    // Persist to Firestore
    const activeChatId = chatId || db.collection("chats").doc().id;
    const chatRef = db.collection("chats").doc(activeChatId);
    const chatDoc = await chatRef.get();

    const newMessages = [
      ...(chatDoc.exists ? chatDoc.data().messages || [] : []),
      {role: "user", content: message, timestamp: new Date().toISOString()},
      {role: "assistant", content: replyText, timestamp: new Date().toISOString(), provider},
    ];

    const chatTitle = chatDoc.exists ?
      (chatDoc.data().title || message.slice(0, 40)) :
      message.slice(0, 40);

    const now = admin.firestore.FieldValue.serverTimestamp();
    await chatRef.set({
      title: chatTitle,
      messages: newMessages,
      updatedAt: now,
      createdAt: chatDoc.exists ? chatDoc.data().createdAt : now,
    }, {merge: true});

    res.json({
      chatId: activeChatId,
      reply: replyText,
      title: chatTitle,
      provider,
    });
  } catch (error) {
    console.error("Error in /chat endpoint:", error);
    res.status(500).json({
      error: "AI generation failed: " + (error.message || "Unknown error"),
    });
  }
});

app.use("/api", router);
app.use("/", router);

exports.api = onRequest(app);
