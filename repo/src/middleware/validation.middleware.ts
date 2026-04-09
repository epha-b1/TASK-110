import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

function formatErrors(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`).join('; ');
}

/**
 * Validate `req.body` against a zod schema. Sends 400 VALIDATION_ERROR
 * with a structured message on failure.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: formatErrors(err),
        });
        return;
      }
      next(err);
    }
  };
}

/**
 * Validate `req.query` against a zod schema. Used for GET endpoints
 * that take filter/range parameters (e.g. /reports/occupancy).
 *
 * Express query strings are always strings, so the schemas should
 * either accept strings directly or use `z.coerce.*` to type-cast.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: formatErrors(err),
        });
        return;
      }
      next(err);
    }
  };
}
