const express = require('express');
const path = require('path');
const fs = require('fs');
const neo4j = require('neo4j-driver');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SAMPLE_GRAPH_PATH = path.join(__dirname, 'data', 'sample-graph.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const neo4jConfig = {
  uri: process.env.NEO4J_URI,
  username: process.env.NEO4J_USERNAME,
  password: process.env.NEO4J_PASSWORD,
};

function loadSampleGraph() {
  const raw = fs.readFileSync(SAMPLE_GRAPH_PATH, 'utf-8');
  return JSON.parse(raw);
}

function hasNeo4jConfig() {
  return Boolean(neo4jConfig.uri && neo4jConfig.username && neo4jConfig.password);
}

async function withDriver(run) {
  const driver = neo4j.driver(
    neo4jConfig.uri,
    neo4j.auth.basic(neo4jConfig.username, neo4jConfig.password)
  );
  try {
    return await run(driver);
  } finally {
    await driver.close();
  }
}

function applyDecay(nodes) {
  const now = new Date();
  return nodes.map((node) => {
    if (!node.createdAt) return node;
    const ageDays = (now - new Date(node.createdAt)) / (1000 * 60 * 60 * 24);
    const decay = Math.exp(-ageDays / 45);
    return { ...node, weight: node.weight ? node.weight * decay : node.weight, decay };
  });
}

function filterForVisibility(graph, isAdmin) {
  if (isAdmin) return graph;
  const hiddenLabels = new Set(['Signal']);
  const nodes = graph.nodes.filter((node) => !hiddenLabels.has(node.label));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = graph.links.filter(
    (link) => nodeIds.has(link.source) && nodeIds.has(link.target)
  );
  return { nodes, links };
}

function computeInsightScores(nodes, links) {
  const knowledgeWeights = new Map();
  links
    .filter((link) => link.label === 'HAS_KNOWLEDGE')
    .forEach((link) => {
      const weight = link.weight || 0.5;
      knowledgeWeights.set(link.source, (knowledgeWeights.get(link.source) || 0) + weight * 100);
    });
  return nodes.map((node) => {
    if (node.label !== 'Person') return node;
    const base = node.insightScore || 50;
    const contribution = knowledgeWeights.get(node.id) || 0;
    return { ...node, insightScore: Math.round(base * 0.6 + contribution * 0.4) };
  });
}

function textToCypher(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes('knowledgeable') || normalized.includes('expert')) {
    const topicMatch = normalized.match(/for (.+)$/i);
    const topic = topicMatch ? topicMatch[1].trim() : null;
    if (topic) {
      return {
        cypher: `MATCH (p:Person)-[:HAS_KNOWLEDGE]->(k:Knowledge) WHERE toLower(k.topic) CONTAINS $topic RETURN p, k ORDER BY p.insightScore DESC LIMIT 5`,
        params: { topic },
        intent: `Top experts for ${topic}`,
      };
    }
  }
  if (normalized.includes('signals')) {
    return {
      cypher: `MATCH (s:Signal) RETURN s ORDER BY s.createdAt DESC LIMIT 10`,
      params: {},
      intent: 'Recent signals',
    };
  }
  return {
    cypher: `MATCH (p:Person)-[:HAS_KNOWLEDGE]->(k:Knowledge) RETURN p, k LIMIT 12`,
    params: {},
    intent: 'Default knowledge map',
  };
}

async function fetchGraph({ admin }) {
  if (!hasNeo4jConfig()) {
    const sample = loadSampleGraph();
    const decayedNodes = applyDecay(sample.nodes);
    const scoredNodes = computeInsightScores(decayedNodes, sample.links);
    return filterForVisibility({ nodes: scoredNodes, links: sample.links }, admin);
  }

  return withDriver(async (driver) => {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (n)
         OPTIONAL MATCH (n)-[r]->(m)
         RETURN n, r, m`
      );
      const nodes = new Map();
      const links = [];

      result.records.forEach((record) => {
        const n = record.get('n');
        const m = record.get('m');
        const r = record.get('r');

        if (n && !nodes.has(n.identity.toString())) {
          nodes.set(n.identity.toString(), mapNode(n));
        }
        if (m && !nodes.has(m.identity.toString())) {
          nodes.set(m.identity.toString(), mapNode(m));
        }
        if (r) {
          links.push({
            source: r.start.toString(),
            target: r.end.toString(),
            label: r.type,
            weight: r.properties?.weight?.toNumber?.() || r.properties?.weight || 0.5,
          });
        }
      });

      const nodeArray = Array.from(nodes.values());
      const decayedNodes = applyDecay(nodeArray);
      const scoredNodes = computeInsightScores(decayedNodes, links);
      return filterForVisibility({ nodes: scoredNodes, links }, admin);
    } finally {
      await session.close();
    }
  });
}

function mapNode(node) {
  const props = node.properties || {};
  const label = node.labels[0] || 'Node';
  const base = {
    id: node.identity.toString(),
    label,
  };

  const mapped = {
    ...base,
    ...mapProperties(props),
  };

  if (label === 'Person') {
    mapped.name = mapped.name || props.Name || 'Unknown';
    mapped.role = mapped.role || 'Team Member';
    mapped.insightScore = Number(mapped.insightScore) || 50;
  }

  if (label === 'Knowledge') {
    mapped.topic = mapped.topic || 'Untitled Topic';
    mapped.description = mapped.description || '';
    mapped.weight = Number(mapped.weight) || 0.6;
  }

  if (label === 'Signal') {
    mapped.type = mapped.type || 'Summary';
    mapped.source = mapped.source || 'Unknown';
    mapped.content = mapped.content || '';
  }

  return mapped;
}

function mapProperties(props) {
  return Object.entries(props).reduce((acc, [key, value]) => {
    if (neo4j.isInt(value)) {
      acc[key] = value.toNumber();
    } else if (value instanceof Date) {
      acc[key] = value.toISOString();
    } else {
      acc[key] = value;
    }
    return acc;
  }, {});
}

app.get('/api/graph', async (req, res) => {
  try {
    const admin = req.query.admin === '1';
    const graph = await fetchGraph({ admin });
    res.json({ ...graph, meta: { admin, source: hasNeo4jConfig() ? 'neo4j' : 'sample' } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/query', async (req, res) => {
  const { query } = req.body;
  const spec = textToCypher(query || '');

  if (!hasNeo4jConfig()) {
    const sample = loadSampleGraph();
    res.json({
      intent: spec.intent,
      cypher: spec.cypher,
      params: spec.params,
      data: sample,
      note: 'Neo4j credentials missing; returning sample data.',
    });
    return;
  }

  try {
    const data = await withDriver(async (driver) => {
      const session = driver.session();
      try {
        const result = await session.run(spec.cypher, spec.params);
        return result.records.map((record) => record.toObject());
      } finally {
        await session.close();
      }
    });

    res.json({ intent: spec.intent, cypher: spec.cypher, params: spec.params, data });
  } catch (error) {
    res.status(500).json({ error: error.message, cypher: spec.cypher });
  }
});

app.post('/api/signals', async (req, res) => {
  const { type, source, content, knowledgeTopic } = req.body || {};

  if (!hasNeo4jConfig()) {
    res.json({
      status: 'queued',
      message: 'Signal captured for MVP. Connect Neo4j to persist.',
      signal: { type, source, content, knowledgeTopic },
    });
    return;
  }

  try {
    const result = await withDriver(async (driver) => {
      const session = driver.session();
      try {
        return await session.run(
          `CREATE (s:Signal {type: $type, source: $source, content: $content, createdAt: date()})
           WITH s
           MERGE (k:Knowledge {topic: $knowledgeTopic})
           ON CREATE SET k.description = $content, k.weight = 0.6, k.createdAt = date()
           MERGE (s)-[:CONTRIBUTES_TO {weight: 0.6}]->(k)
           RETURN s, k`,
          { type, source, content, knowledgeTopic }
        );
      } finally {
        await session.close();
      }
    });
    res.json({ status: 'created', records: result.records.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`AI CoS Graph running on http://localhost:${PORT}`);
});
