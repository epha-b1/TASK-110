import { Router } from 'express';
import * as ctrl from '../controllers/itineraries.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { userLimiter } from '../middleware/rate-limit.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  createItinerarySchema,
  updateItinerarySchema,
  createCheckpointSchema,
  updateCheckpointSchema,
} from '../utils/validation';

const router = Router({ mergeParams: true });
router.use(authMiddleware);
router.use(userLimiter);

router.get('/', ctrl.listItems);
router.post('/', validate(createItinerarySchema), ctrl.createItem);
router.get('/:itemId', ctrl.getItem);
router.patch('/:itemId', validate(updateItinerarySchema), ctrl.updateItem);
router.delete('/:itemId', ctrl.deleteItem);

router.get('/:itemId/checkpoints', ctrl.listCheckpoints);
router.post('/:itemId/checkpoints', validate(createCheckpointSchema), ctrl.addCheckpoint);
router.patch('/:itemId/checkpoints/:checkpointId', validate(updateCheckpointSchema), ctrl.updateCheckpoint);
router.delete('/:itemId/checkpoints/:checkpointId', ctrl.deleteCheckpoint);

router.post('/:itemId/checkin', ctrl.checkin);

export default router;
