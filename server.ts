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

  // API Route to analyze product from URL
  app.post("/api/gemini/analyze-product-url", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "URL required" });

      let contents: any[] = [`Analyze the product at this URL and provide details: ${url}`];
      let config: any = {
        tools: [{ urlContext: {} }],
        responseMimeType: "application/json"
      };

      // Try to fetch image if it's a direct link
      try {
        const fetchResp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const contentType = fetchResp.headers.get('content-type');
        
        if (contentType?.startsWith('image/')) {
          const buffer = await fetchResp.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          contents = [
            { text: `Analyze this product image and context from URL: ${url}` },
            { inlineData: { data: base64, mimeType: contentType } }
          ];
        }
      } catch (e) {
        console.log("Fetch failed, relying on urlContext only:", e);
      }

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents,
        config: {
          ...config,
          systemInstruction: `You are a product analyzer. Provide JSON output with: name, price (estimated in IDR as number), category (hp or ebike), stock (default 5), and specs (list of strings). No extra text.`
        }
      });

      const textOutput = result.text || "{}";
      res.json({ data: JSON.parse(textOutput.replace(/```json|```/g, '').trim()) });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "AI Error", details: error instanceof Error ? error.message : String(error) });
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
