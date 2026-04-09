# AI Data Analyst Dashboard

A powerful, AI-powered data cleaning, analysis, and visualization dashboard built with Next.js, TypeScript, Tailwind CSS, and Groq API.

## Features

- **AI-Powered Data Cleaning** - Automatic detection and correction of data quality issues
- **Smart Column Classification** - Intelligent column type detection and merging suggestions
- **Interactive Data Visualization** - Real-time charts and dashboards
- **SQL Query Builder** - Generate and execute SQL queries with AI assistance
- **Pivot Table Analysis** - Create and analyze pivot tables dynamically
- **Geographic Normalization** - Standardize location data globally
- **Salary Parsing** - Extract and validate salary information
- **Anomaly Detection** - Identify unusual patterns in your data
- **Export & Download** - Multiple export formats for processed data
- **Real-time Chat Interface** - AI assistant for data analysis questions

## Quick Start

### Prerequisites

- Node.js 18+ 
- pnpm, npm, yarn, or bun
- A free Groq API key (https://console.groq.com/keys)

### Installation

1. **Clone and install dependencies**
```bash
git clone <repository-url>
cd project-my
pnpm install  # or npm install / yarn install
```

2. **Set up environment variables**

Create a `.env.local` file in the root directory:

```env
AI_PROVIDER=groq
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=llama-3.3-70b-versatile
```

Get your free Groq API key: https://console.groq.com/keys

3. **Run the development server**

```bash
pnpm dev
```

Open http://localhost:3000 in your browser.

## Architecture

### Directory Structure

```
src/
├── app/
│   ├── api/              # 19 AI-powered API endpoints
│   ├── page.tsx          # Main dashboard page
│   ├── layout.tsx        # Root layout
│   └── globals.css       # Global styles
├── components/
│   ├── dashboard/        # Dashboard components
│   └── ui/              # Reusable shadcn/ui components
├── lib/
│   ├── ai-provider.ts   # AI provider abstraction
│   ├── groq.ts          # Groq API client
│   ├── cleaning-engine.ts
│   ├── memory-engine.ts
│   ├── sql-executor.ts
│   └── [other utilities]
└── hooks/               # Custom React hooks
```

### Core API Endpoints (19 routes)

| Endpoint | Purpose |
|----------|---------|
| `/api/clean` | Deterministic data cleaning |
| `/api/analyze` | Deep data analysis |
| `/api/classify-columns` | Column type detection |
| `/api/classify-columns-merge` | Smart column merging |
| `/api/validate-contact` | Contact information validation |
| `/api/format-phones` | Phone number standardization |
| `/api/ai-salary-parse` | Salary extraction |
| `/api/ai-salary-verify` | Salary validation |
| `/api/standardize-locations` | Address normalization |
| `/api/standardize-geographic` | Geographic data standardization |
| `/api/resolve-country-codes` | Country code mapping |
| `/api/normalize-text-response` | Text normalization |
| `/api/normalize-values` | Value standardization |
| `/api/anomaly-detect` | Anomaly detection |
| `/api/pivot` | Pivot table generation |
| `/api/pivot-suggestions` | Pivot analysis suggestions |
| `/api/sql-query` | SQL query execution |
| `/api/sql-suggestions` | SQL query generation |
| `/api/chat-edit` | AI-powered data editing |

## AI Provider Configuration

### Using Groq (Default)

The application is configured to use Groq's API by default for maximum performance and cost efficiency.

**Models available:**
- `llama-3.3-70b-versatile` (default) - Fastest and most capable
- `mixtral-8x7b-32768` - Balanced performance
- `llama-2-70b-chat` - Alternative

**Environment:**
```env
AI_PROVIDER=groq
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=llama-3.3-70b-versatile  # optional
```

### Using Z.ai SDK

To use the Z.ai SDK instead:

```env
AI_PROVIDER=zai
ANTHROPIC_AUTH_TOKEN=your_z_ai_token
```

The provider selection happens automatically at server startup via the `ai-provider.ts` module.

## Key Libraries & Technologies

- **Framework:** Next.js 16 with App Router
- **Language:** TypeScript 5
- **UI Components:** shadcn/ui (60+ pre-built components)
- **Styling:** Tailwind CSS v4
- **Visualization:** Recharts
- **Data Parsing:** PapaParse
- **Icons:** Lucide React
- **Notifications:** Sonner
- **Date Handling:** date-fns
- **Form Handling:** React Hook Form
- **AI Provider:** Groq API or Z.ai SDK

## Development

### Running Tests

```bash
pnpm type-check  # TypeScript type checking
pnpm lint        # Run ESLint
```

### Building for Production

```bash
pnpm build
pnpm start
```

## Data Processing Pipeline

1. **Upload** - CSV/JSON upload with automatic schema detection
2. **Analyze** - Column profiling and anomaly detection
3. **Clean** - Apply deterministic cleaning rules
4. **Classify** - Intelligent column classification
5. **Transform** - Apply transformations and normalizations
6. **Validate** - Post-process validation
7. **Visualize** - Create dashboards and charts
8. **Export** - Download processed data

## Security

- All API routes validate input parameters
- Environment variables are properly isolated
- No sensitive data is logged
- Type-safe operations throughout
- CORS headers configured appropriately

## Performance Optimizations

- Server-side data processing for large datasets
- Streaming responses for real-time feedback
- Client-side caching with memory management
- Efficient data structures and algorithms
- Lazy-loaded components

## Deployment

### Deploy to Vercel

1. Push your code to GitHub
2. Import project in Vercel Dashboard
3. Add environment variables in Vercel settings:
   - `AI_PROVIDER=groq`
   - `GROQ_API_KEY=gsk_...`
4. Deploy!

### Deploy Elsewhere

The application is framework-agnostic and can be deployed to any Node.js 18+ compatible platform:
- AWS (EC2, App Runner, Lambda)
- Railway
- Render
- Heroku
- Docker containers

## Troubleshooting

### "GROQ_API_KEY is not set"
- Add `GROQ_API_KEY` to `.env.local`
- Get a free key at https://console.groq.com/keys
- Restart the dev server after adding the key

### API requests timing out
- Check your internet connection
- Verify the Groq API is accessible
- Check your API key is valid
- Try a different Groq model if one is slow

### Large dataset performance
- The system is optimized for datasets up to 1M rows
- For larger datasets, consider chunking or sampling
- Use the memory panel to monitor performance

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - feel free to use this project for any purpose.

## Support

For issues, questions, or suggestions:
1. Check the troubleshooting section above
2. Review the API endpoint documentation
3. Create an issue in the repository

## Authors

Built with ❤️ using modern web technologies
