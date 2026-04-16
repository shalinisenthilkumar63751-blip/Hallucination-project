import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // PubMed API Proxy
  app.get("/api/pubmed/search", async (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: "Query is required" });

    try {
      // 1. Search for IDs
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(q as string)}&retmode=json&retmax=3`;
      const searchRes = await axios.get(searchUrl);
      const ids = searchRes.data.esearchresult.idlist;

      if (!ids || ids.length === 0) {
        return res.json({ results: [] });
      }

      // 2. Fetch Abstracts
      const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(",")}&retmode=xml&rettype=abstract`;
      const fetchRes = await axios.get(fetchUrl);
      
      const xml = fetchRes.data;
      
      // Get metadata (titles, etc.)
      const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
      const summaryRes = await axios.get(summaryUrl);
      const summaries = summaryRes.data.result;

      // Basic extraction of abstracts from XML using regex
      // (Using a student-friendly regex approach as suggested in original comments)
      const abstractsMap: Record<string, string> = {};
      const articleBlocks = xml.split('</PubmedArticle>');
      
      articleBlocks.forEach((block: string) => {
        const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
        if (pmidMatch) {
          const pmid = pmidMatch[1];
          const abstractMatches = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)];
          const fullAbstract = abstractMatches
            .map(m => m[1].replace(/<[^>]*>/g, '').trim()) // Remove any nested XML tags (like <I>, <B>)
            .join(' ');
          abstractsMap[pmid] = fullAbstract;
        }
      });

      const results = ids.map((id: string) => {
        const item = summaries[id];
        return {
          id,
          title: item.title,
          source: item.source,
          pubdate: item.pubdate,
          abstract: abstractsMap[id] || "Abstract not available for this article."
        };
      });

      res.json({ results });
    } catch (error) {
      console.error("PubMed API Error:", error);
      res.status(500).json({ error: "Failed to fetch from PubMed" });
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
