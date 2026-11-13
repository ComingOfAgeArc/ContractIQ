// Recompute flags for every analysed contract (no AI calls, takes a second).
// Run after upgrading to Phase 5 or after changing THRESHOLDS in flagService.js:
//   npm run flags
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import Contract from '../models/Contract.js';
import Chunk from '../models/Chunk.js';
import { computeFlags } from '../services/flagService.js';

await connectDB();
const contracts = await Contract.find({ analysis: { $ne: null } });
for (const contract of contracts) {
  const chunks = await Chunk.find({ contractId: contract._id }).select('-embedding').lean();
  contract.flags = computeFlags(contract.analysis, chunks);
  contract.markModified('flags');
  await contract.save();
  console.log(`${contract.title.padEnd(30)} ${contract.flags.map((f) => f.code).join(', ') || '(no flags)'}`);
}
console.log(`\nUpdated ${contracts.length} contract(s). Contracts without analysis are skipped: analyse them first.`);
await mongoose.disconnect();
