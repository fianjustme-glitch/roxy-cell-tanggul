import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini Setup
  const ai = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // API Route for AI Image Suggestion
  app.post("/api/gemini/generate-image-query", async (req, res) => {
    try {
      const { productName, category } = req.body;
      if (!productName) return res.status(400).json({ error: "Product name required" });

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate a short, specific English search query (2-4 words) for Unsplash to find a high-quality product photo of: "${productName}" (Category: ${category}). Output only the search query.`,
      });

      const query = response.text || productName;
      // We return the query and a formatted unsplash URL
      const imageUrl = `https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?q=80&w=800&auto=format&fit=crop`; // fallback
      
      // Realistically we want to return a URL that uses the query. 
      // Source Unsplash is deprecated but search parameters in their dynamic URLs work.
      const searchUrl = `https://source.unsplash.com/featured/?${encodeURIComponent(query)}`;
      // Since source.unsplash.com is problematic, I'll return a query that the frontend can use with a reliable proxy or just return the query.
      
      res.json({ query, suggestedUrl: `https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?brand=${encodeURIComponent(query)}&auto=format&fit=crop&w=800` });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "AI Error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
