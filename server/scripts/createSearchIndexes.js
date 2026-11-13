// Creates both Atlas indexes on the chunks collection. Run once:
//   npm run create:index
// Safe to run again: existing indexes are left alone.
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Chunk from '../models/Chunk.js';
import { SEARCH_INDEXES } from '../config/searchIndexes.js';

await connectDB();
await Chunk.createCollection().catch(() => {}); // indexes need the collection to exist
const collection = Chunk.collection;

for (const index of SEARCH_INDEXES) {
  const [existing] = await collection.listSearchIndexes(index.name).toArray();
  if (existing) {
    console.log(`✓ "${index.name}" already exists (status: ${existing.status})`);
    continue;
  }
  await collection.createSearchIndex(index);
  console.log(`… creating "${index.name}" (${index.type})`);
}

// Atlas builds indexes in the background; wait until all can be queried.
for (let i = 0; i < 60; i++) {
  const all = await collection.listSearchIndexes().toArray();
  const pending = SEARCH_INDEXES.filter((idx) => !all.find((a) => a.name === idx.name)?.queryable);
  if (!pending.length) {
    console.log('All indexes are READY.');
    break;
  }
  process.stdout.write(`  waiting for: ${pending.map((p) => p.name).join(', ')}\r`);
  await new Promise((r) => setTimeout(r, 5000));
}

console.log('\nTo change a definition, delete the index in Atlas UI (Search & Vector Search) and rerun.');
for (const index of SEARCH_INDEXES) {
  console.log(`\n${index.name} (${index.type}):\n${JSON.stringify(index.definition, null, 2)}`);
}
await mongoose.disconnect();
