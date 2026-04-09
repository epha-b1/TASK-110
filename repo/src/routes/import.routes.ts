import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/import.controller';
import { authMiddleware, requireRole } from '../middleware/auth.middleware';
import { userLimiter } from '../middleware/rate-limit.middleware';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

// All /import endpoints — including the dataset templates — require an
// authenticated session and either hotel_admin or manager role. The
// templates endpoint was previously public, which was an unnecessary
// information disclosure (it leaked the column schema before any auth
// step). Locking it down behind the same role guard as the rest of
// the import flow is the least-privilege fix.
router.use(authMiddleware);
router.use(userLimiter);
router.use(requireRole('hotel_admin', 'manager'));

router.get('/templates/:datasetType', ctrl.downloadTemplate);

router.post('/upload', upload.single('file'), ctrl.upload);
router.post('/:batchId/commit', ctrl.commit);
router.get('/:batchId', ctrl.getBatch);

export default router;
