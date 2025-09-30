#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

async function main() {
  const E = await import('ethers').catch(() => null);
  const ethers = E && E.default ? E.default : E;

  const topics = process.argv.slice(2);
  if (topics.length === 0) {
    console.error('Usage: node scripts/findEventByTopic.js <topic0> [topic1 ...]');
    process.exit(1);
  }

  const artifactsDir = path.join(process.cwd(), 'artifacts', 'contracts');
  if (!fs.existsSync(artifactsDir)) {
    console.error('Artifacts folder not found:', artifactsDir);
    process.exit(1);
  }

  function walk(dir) {
    const files = [];
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) files.push(...walk(full));
      else files.push(full);
    }
    return files;
  }

  const files = walk(artifactsDir).filter(f => f.endsWith('.json'));
  const topicSet = new Set(topics.map(t => t.toLowerCase()));
  const matches = [];

  for (const file of files) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!j.abi || !ethers) continue;
      const iface = new ethers.Interface(j.abi);
      for (const fragment of iface.fragments) {
        if (fragment.type !== 'event') continue;
        const topic = iface.getEventTopic(fragment);
        if (topicSet.has(topic.toLowerCase())) {
          matches.push({ file: path.relative(process.cwd(), file), event: fragment.name, topic });
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  if (matches.length === 0) {
    console.log('No matches found for topics');
    process.exit(0);
  }

  for (const m of matches) console.log(`${m.topic} => ${m.file} :: ${m.event}`);
}

main().catch(e => { console.error(e); process.exit(1); });
