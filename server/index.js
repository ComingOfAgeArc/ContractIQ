import app from './app.js';
import { connectDB } from './config/db.js';
import { recoverInterruptedJobs } from './services/processingService.js';

const PORT = process.env.PORT || 5000;

try {
  await connectDB();
  // Jobs that were queued/running when the server last stopped will never finish: mark them retryable
  await recoverInterruptedJobs();
  app.listen(PORT, () => console.log(`ContractIQ API on http://localhost:${PORT}`));
} catch (err) {
  console.error('Startup failed:', err.message);
  process.exit(1);
}
