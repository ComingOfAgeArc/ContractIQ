import { Router } from 'express';
import { ask } from '../controllers/askController.js';

const router = Router();

router.post('/', ask);

export default router;
