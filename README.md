# AI Procurement Optimizer

Clean, minimal UI for AI-powered procurement workflow with 4 key pages.

## Features

1. **BOQ Normalize** - Upload BOQ files and map to normalized catalog with AI confidence scores
2. **Vendor Select** - Compare vendors by price/lead time and select best options (INR pricing)
3. **Substitution** - Review AI-suggested alternatives with cost savings (in INR)
4. **Create PO** - Group items by vendor and confirm purchase orders

## Setup

```bash
# Install dependencies
npm install
cd frontend && npm install
cd ../backend && npm install

# Run development servers
npm run dev
```

Frontend: http://localhost:3000
Backend: http://localhost:5000

## Tech Stack

- Frontend: React + Vite, React Router, Lucide Icons
- Backend: Node.js + Express
- Styling: Clean CSS with soft colors (#4f46e5 primary, minimal tables/cards)
- AI Integration: Supports ChatGPT (OpenAI), Google Gemini, and Anthropic Claude

## AI Fetch Feature

The product management system includes an AI Fetch feature that generates product descriptions and extracts attributes using AI platforms:

- **Supported Platforms**: ChatGPT (OpenAI), Google Gemini, Anthropic Claude
- **Auto-Selection**: Automatically selects the best available AI provider based on configured API keys
- **Manual Selection**: Users can manually select which AI provider to use
- **API Keys Required**: Configure at least one of the following in your `.env` file:
  - `OPENAI_API_KEY` - For ChatGPT
  - `GEMINI_API_KEY` - For Google Gemini
  - `ANTHROPIC_API_KEY` - For Claude

See `DEPLOYMENT.md` for detailed configuration instructions.