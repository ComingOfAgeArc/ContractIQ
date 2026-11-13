import mongoose from 'mongoose';
import { STAGE_KEYS, PROCESSING_STATES } from '../services/processingStatus.js';

// One page of extracted text. We keep text per page (not one big string)
// so every chunk created later can point back to its page for citations.
const pageSchema = new mongoose.Schema(
  {
    pageNumber: { type: Number, required: true },
    text: { type: String, default: '' },
  },
  { _id: false }
);

const contractSchema = new mongoose.Schema(
  {
    // What the user sees
    title: { type: String, required: true, trim: true },
    vendor: { type: String, required: true, trim: true },   // "Vendor A"  → vendor comparison
    version: { type: String, default: 'v1', trim: true },   // "2025"      → version comparison

    // File info
    originalName: { type: String, required: true },
    fileSize: Number,
    fileHash: { type: String, index: true },                // sha256, used to skip duplicate uploads

    // Extracted content
    pageCount: { type: Number, default: 0 },
    pages: { type: [pageSchema], default: [] },
    charCount: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },

    // What data exists: uploaded → parsed → chunked → embedded → analyzed.
    // "chunked" also means "embedding failed, retry later" (see `error`).
    // Search only uses contracts that are "embedded" or "analyzed".
    // The live stage-by-stage progress is in `processing` below.
    status: {
      type: String,
      enum: ['uploaded', 'parsed', 'chunked', 'embedded', 'analyzed', 'failed'],
      default: 'uploaded',
    },
    error: String,

    // Live progress of the background pipeline (see services/processingStatus.js).
    // `status` above says what DATA exists (search filters on it); `processing`
    // says what the pipeline is DOING right now, so the UI can show each stage.
    processing: {
      type: new mongoose.Schema(
        {
          stage: { type: String, enum: STAGE_KEYS },          // current stage, or the stage that failed
          state: { type: String, enum: PROCESSING_STATES },   // queued | running | completed | failed
          error: String,                                      // readable message when state = failed
          progress: { done: Number, total: Number },          // inside a stage (embedding batches)
          analysisSkipped: Boolean,                           // AUTO_ANALYZE=off
          attempts: { type: Number, default: 0 },
          startedAt: Date,
          updatedAt: Date,
          finishedAt: Date,
        },
        { _id: false }
      ),
      default: undefined, // contracts created before this field existed have none
    },

    // Filled in Phase 3 (clause/term extraction). Mixed = free-form JSON for now.
    analysis: { type: mongoose.Schema.Types.Mixed, default: null },

    // Filled in Phase 5 from the analysis by simple rules (flagService). Informational only.
    flags: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // Short plain-English brief written by Gemini from the analysis + flags (summaryService).
    // Cleared whenever the analysis is redone, so it never describes outdated data.
    executiveSummary: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('Contract', contractSchema);
