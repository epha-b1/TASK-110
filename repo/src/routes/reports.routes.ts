import { Router } from 'express';
import * as ctrl from '../controllers/reports.controller';
import * as importCtrl from '../controllers/import.controller';
import { authMiddleware, requireRole } from '../middleware/auth.middleware';
import { userLimiter } from '../middleware/rate-limit.middleware';
import { validate, validateQuery } from '../middleware/validation.middleware';
import {
  reportQuerySchema,
  revenueMixQuerySchema,
  reportExportSchema,
} from '../utils/validation';

const router = Router();
router.use(authMiddleware);
router.use(userLimiter);
router.use(requireRole('hotel_admin', 'manager', 'analyst'));

// Each KPI endpoint validates from/to/groupBy/propertyId/roomType.
// reportQuerySchema enforces date format and from <= to.
router.get('/occupancy',   validateQuery(reportQuerySchema),       ctrl.occupancy);
router.get('/adr',         validateQuery(reportQuerySchema),       ctrl.adr);
router.get('/revpar',      validateQuery(reportQuerySchema),       ctrl.revpar);
router.get('/revenue-mix', validateQuery(revenueMixQuerySchema),   ctrl.revenueMix);

router.post('/export', validate(reportExportSchema), ctrl.exportReport);

router.get('/staffing', importCtrl.staffingReport);
router.get('/evaluations', importCtrl.evaluationReport);

export default router;
