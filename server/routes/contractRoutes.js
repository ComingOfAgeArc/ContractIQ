import { Router } from 'express';
import { uploadPdfs } from '../middleware/upload.js';
import { aiLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/contractController.js';

const router = Router();

router.post('/upload', uploadLimiter, uploadPdfs, ctrl.uploadContracts);
router.get('/', ctrl.listContracts);
router.get('/status', ctrl.getStatuses); // before '/:id', or "status" would be read as an id
router.get('/:id', ctrl.getContract);
router.get('/:id/status', ctrl.getStatus);
router.get('/:id/chunks', ctrl.getChunks);
router.post('/:id/process', aiLimiter, ctrl.processContract);
router.post('/:id/retry', aiLimiter, ctrl.retryContract);
router.post('/:id/analyze', aiLimiter, ctrl.analyzeContract);
router.post('/:id/summary', aiLimiter, ctrl.summarizeContract);
router.delete('/:id', ctrl.deleteContract);

export default router;
