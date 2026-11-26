import type { Request, Response, NextFunction } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';

interface TenantJwtPayload extends JwtPayload {
  tenant_id: string;
}

export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authorization = req.headers.authorization;

  if (!authorization) {
    res.status(401).json({
      error: 'Authentication required.',
    });
    return;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    res.status(401).json({
      error: 'Invalid authorization format. Use Bearer token.',
    });
    return;
  }

  const token = match[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    });

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.tenant_id !== 'string' ||
      decoded.tenant_id.trim().length === 0 ||
      typeof decoded.exp !== 'number'
    ) {
      res.status(401).json({
        error: 'Invalid authentication token.',
      });
      return;
    }

    const payload = decoded as TenantJwtPayload;

    // Tenant identity comes only from the verified JWT.
    req.tenantId = payload.tenant_id;

    next();
  } catch {
    res.status(401).json({
      error: 'Invalid or expired authentication token.',
    });
  }
}