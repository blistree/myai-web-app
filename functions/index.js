const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions");
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const {GoogleAuth} = require("google-auth-library");

admin.initializeApp();
let firestoreDb = null;
function getDb() {
  if (!firestoreDb) {
    firestoreDb = admin.firestore();
  }
  return firestoreDb;
}

setGlobalOptions({maxInstances: 10, region: "us-central1"});

const app = express();
app.use(cors({origin: true}));
app.use(express.json());

const PROJECT_ID = process.env.GCLOUD_PROJECT || "ai-projects-ca4cf";
const LOCATION = process.env.VERTEX_LOCATION || "global";

// Private Self-Hosted Model Server (Google Compute Engine VM)
const MODEL_SERVER_URL = process.env.MODEL_SERVER_URL || "http://34.93.230.99:11434";
const PRIVATE_MODEL = process.env.MODEL_NAME || "gemma2:2b";

const {getActiveEthics} = require("./ethics");

let authClient = null;
function getAuth() {
  if (!authClient) {
    authClient = new GoogleAuth({
      scopes: "https://www.googleapis.com/auth/cloud-platform",
    });
  }
  return authClient;
}

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
  const client = await getAuth().getClient();
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

  const activeEthics = getActiveEthics();
  res.json({
    status: "online",
    name: "MYAi Sovereign AI Server",
    activeModel: PRIVATE_MODEL,
    ethics: {
      step: activeEthics.step,
      name: activeEthics.name,
      badge: activeEthics.badge,
      lawBasis: activeEthics.lawBasis,
    },
    selfHostedVm: {
      ip: "34.93.230.99",
      zone: "asia-south1-c (Mumbai, India)",
      status: privateVmOnline ? "CONNECTED_AND_ACTIVE" : "STANDBY",
    },
    fallback: "Vertex AI Global Endpoint",
  });
});

// Dynamic Firebase Web Configuration (served from environment without committing secrets to git)
router.get("/config", (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_WEB_API_KEY || "",
    authDomain: "ai-projects-ca4cf.firebaseapp.com",
    projectId: "ai-projects-ca4cf",
    storageBucket: "ai-projects-ca4cf.firebasestorage.app",
    messagingSenderId: "1004548547081",
    appId: "1:1004548547081:web:0bacde3c41f471ddd38ed8",
  });
});

const AUTHORIZED_ADMIN_UID = process.env.ADMIN_UID || "IXrVomHdvNXRTavKRq6XYghkF0i2";

// Admin Authentication Middleware (Restricts access exclusively to authorized admin UID)
async function requireAuthorizedAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Authentication required. Please sign in with administrator credentials.",
    });
  }

  const token = authHeader.split("Bearer ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.uid !== AUTHORIZED_ADMIN_UID) {
      console.warn(`Unauthorized access attempt by UID: ${decoded.uid} (${decoded.email || "no email"})`);
      return res.status(403).json({
        error: "Forbidden: Access restricted to authorized administrator (UID mismatch).",
      });
    }
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.status(401).json({
      error: "Invalid or expired session. Please sign in again.",
    });
  }
}

// List all chats
router.get("/chats", requireAuthorizedAdmin, async (req, res) => {
  try {
    const snapshot = await getDb().collection("chats")
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
router.get("/chats/:chatId", requireAuthorizedAdmin, async (req, res) => {
  try {
    const {chatId} = req.params;
    const doc = await getDb().collection("chats").doc(chatId).get();
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
router.delete("/chats/:chatId", requireAuthorizedAdmin, async (req, res) => {
  try {
    const {chatId} = req.params;
    await getDb().collection("chats").doc(chatId).delete();
    res.json({success: true, deleted: chatId});
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({error: "Failed to delete conversation"});
  }
});

// Chat completion endpoint
router.post("/chat", requireAuthorizedAdmin, async (req, res) => {
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
    const activeEthics = getActiveEthics();

    try {
      // 1. Primary: 100% Private Self-Hosted Gemma 2 on Google Cloud VM
      replyText = await callPrivateModelServer(messages, activeEthics.prompt, PRIVATE_MODEL);
    } catch (privateVmError) {
      console.warn("Private VM unavailable, using standby fallback:", privateVmError.message);
      provider = "vertex-ai-standby";
      replyText = await callVertexAIFallback(messages, activeEthics.prompt);
    }

    // Persist to Firestore
    const activeChatId = chatId || getDb().collection("chats").doc().id;
    const chatRef = getDb().collection("chats").doc(activeChatId);
    const chatDoc = await chatRef.get();

    const newMessages = [
      ...(chatDoc.exists ? chatDoc.data().messages || [] : []),
      {role: "user", content: message, timestamp: new Date().toISOString()},
      {role: "assistant", content: replyText, timestamp: new Date().toISOString(), provider, ethicsStep: activeEthics.step},
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
      ethics: {
        step: activeEthics.step,
        name: activeEthics.name,
        badge: activeEthics.badge,
      },
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
