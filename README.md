# AI Chief of Staff Graph MVP

A hackathon-ready prototype of the AI Chief of Staff (CoS) graph. This app renders a cyber-grid 3D force graph, provides a conversational query panel, and includes lightweight insight scoring + decay logic.

## Features
- **3D force graph** with directional particles, pulsing nodes, and a dark neon palette.
- **Conversational interface** that translates natural language into Cypher queries (rule-based MVP).
- **Autonomous signal ingestion** to create Knowledge nodes.
- **Insight scoring + temporal decay** to keep knowledge fresh.
- **Visibility toggle** for admin-only Signal visibility.

## Getting Started

### 1) Install dependencies
```bash
npm install
```

### 2) Configure Neo4j (optional)
Copy the `.env.example` file and provide credentials.
```bash
cp .env.example .env
```

If you don't configure Neo4j, the app will use sample data from `data/sample-graph.json`.

### 3) Run the server
```bash
npm start
```

Visit [http://localhost:3000](http://localhost:3000).

## API Endpoints
- `GET /api/graph?admin=0|1` — returns the current graph with optional Signal visibility.
- `POST /api/query` — accepts `{ query }` and returns a Cypher translation + data.
- `POST /api/signals` — accepts `{ type, source, content, knowledgeTopic }` to create a Signal.

## Notes
- The Text-to-Cypher translation is a rule-based MVP. Swap in an LLM for richer coverage.
- Insight scores are computed from knowledge relationships and can be replaced with your preferred weighting strategy.
