import mongoose from 'mongoose';

// A chunk is one clause (or part of a long clause) of a contract.
// Chunks are what we embed and search. Defined now, filled in Phase 2.
const chunkSchema = new mongoose.Schema(
  {
    contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },

    // Copied from the contract so vector search can filter without a join
    vendor: { type: String, required: true },
    version: { type: String },

    chunkIndex: { type: Number, required: true },     // order inside the contract
    text: { type: String, required: true },

    // Citation info
    sectionNumber: String,                            // "12.3"
    sectionTitle: String,                             // "Limitation of Liability"
    pageStart: Number,
    pageEnd: Number,

    // Vector from the embedding model (Phase 2). Atlas Vector Search indexes this field.
    embedding: { type: [Number], default: undefined },
  },
  { timestamps: true }
);

export default mongoose.model('Chunk', chunkSchema);
