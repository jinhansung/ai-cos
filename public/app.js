const graphContainer = document.getElementById('graph');
const adminToggle = document.getElementById('admin-toggle');
const dataSource = document.getElementById('data-source');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatLog = document.getElementById('chat-log');
const insightList = document.getElementById('insight-list');
const signalForm = document.getElementById('signal-form');

let graphInstance = null;
let graphData = { nodes: [], links: [] };

const colorMap = {
  Person: '#00e5ff',
  Knowledge: '#7b5bff',
  Signal: '#ff6b9a',
  Node: '#8ee3ff',
};

function initGraph() {
  graphInstance = ForceGraph3D()(graphContainer)
    .backgroundColor('#05070d')
    .nodeAutoColorBy('label')
    .nodeColor((node) => colorMap[node.label] || colorMap.Node)
    .nodeOpacity(0.9)
    .nodeLabel((node) => {
      if (node.label === 'Person') {
        return `${node.name}\n${node.role}\nInsight: ${node.insightScore}`;
      }
      if (node.label === 'Knowledge') {
        return `${node.topic}\n${node.description}`;
      }
      if (node.label === 'Signal') {
        return `${node.type} · ${node.source}`;
      }
      return node.id;
    })
    .nodeVal((node) => {
      if (node.label === 'Person') return 8 + (node.activity || 0.3) * 10;
      if (node.label === 'Knowledge') return 6 + (node.weight || 0.5) * 8;
      return 4;
    })
    .linkDirectionalParticles(2)
    .linkDirectionalParticleWidth(1.5)
    .linkDirectionalParticleSpeed(0.01)
    .linkOpacity(0.35)
    .linkWidth((link) => 1 + (link.weight || 0.4) * 2)
    .linkColor(() => 'rgba(0, 229, 255, 0.5)')
    .onNodeClick((node) => focusOnNode(node));
}

function focusOnNode(node) {
  if (!graphInstance) return;
  const distance = 120;
  const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
  graphInstance.cameraPosition(
    { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
    node,
    2000
  );
}

function updateInsights(nodes) {
  const persons = nodes
    .filter((node) => node.label === 'Person')
    .sort((a, b) => (b.insightScore || 0) - (a.insightScore || 0))
    .slice(0, 4);

  insightList.innerHTML = '';
  persons.forEach((person) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${person.name} · ${person.role}</span>
      <span class="insight-score">${person.insightScore}</span>
    `;
    insightList.appendChild(li);
  });
}

function renderGraph(data) {
  graphData = data;
  if (!graphInstance) {
    initGraph();
  }
  graphInstance.graphData(data);
  updateInsights(data.nodes);
}

async function fetchGraph() {
  const admin = adminToggle.checked ? 1 : 0;
  const response = await fetch(`/api/graph?admin=${admin}`);
  const data = await response.json();
  dataSource.textContent = `Source: ${data.meta.source}`;
  renderGraph(data);
}

function appendChatMessage(text, isUser = false) {
  const message = document.createElement('div');
  message.className = `chat__message ${isUser ? 'chat__message--user' : 'chat__message--bot'}`;
  message.textContent = text;
  chatLog.appendChild(message);
  chatLog.scrollTop = chatLog.scrollHeight;
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;
  appendChatMessage(question, true);
  chatInput.value = '';

  const response = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: question }),
  });
  const data = await response.json();

  appendChatMessage(`${data.intent}. Cypher: ${data.cypher}`);
  if (data.data?.nodes && data.data?.links) {
    renderGraph(data.data);
  }
});

signalForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(signalForm);
  const payload = Object.fromEntries(formData.entries());
  const response = await fetch('/api/signals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  appendChatMessage(`Signal captured: ${data.status || 'queued'}.`);
  signalForm.reset();
  fetchGraph();
});

adminToggle.addEventListener('change', () => {
  fetchGraph();
});

fetchGraph();
