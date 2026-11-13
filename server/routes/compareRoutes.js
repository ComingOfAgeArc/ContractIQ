import { Router } from 'express';
import * as ctrl from '../controllers/compareController.js';

const router = Router();

router.post('/vendors', ctrl.vendors);
router.post('/versions', ctrl.versions);

export default router;
