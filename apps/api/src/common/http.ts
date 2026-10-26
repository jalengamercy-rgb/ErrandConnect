import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Every request gets an ID (or keeps the one the proxy sent), echoed in X-Request-Id and error responses. */
export function requestId(request: Request, response: Response, next: NextFunction) {
  const incoming = request.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  (request as Request & { id: string }).id = id;
  response.setHeader('X-Request-Id', id);
  next();
}

/** Safe defaults for an API that only returns JSON and files. */
export function securityHeaders(production: boolean) {
  return (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (production) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

const httpLogger = new Logger('HTTP');

/** One line per request: method, path, status, duration, request ID. Health checks are skipped. */
export function requestLogger(request: Request, response: Response, next: NextFunction) {
  if (request.path === '/health') return next();
  const start = process.hrtime.bigint();
  response.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    // Callback URLs contain a secret, so never log full paths for them.
    const path = request.path.startsWith('/payments/mpesa/') ? request.path.replace(/[^/]+$/, '***') : request.path;
    const line = `${request.method} ${path} ${response.statusCode} ${ms.toFixed(0)}ms id=${(request as Request & { id?: string }).id}`;
    if (response.statusCode >= 500) httpLogger.error(line);
    else if (process.env.LOG_REQUESTS !== 'false') httpLogger.log(line);
  });
  next();
}

/**
 * Unexpected errors are logged with the request ID, and the client gets a
 * plain message plus that ID (so support can find the log), never a stack trace.
 */
@Catch()
export class ErrorFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return super.catch(exception, host);
    const request = host.switchToHttp().getRequest<Request & { id?: string }>();
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body;
      response.status(exception.getStatus()).json({ ...payload, requestId: request.id });
      return;
    }
    this.logger.error(
      `Unhandled error on ${request.method} ${request.path} id=${request.id}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      message: 'Something went wrong on our side. Please try again; if it keeps happening, contact support with this reference.',
      requestId: request.id,
    });
  }
}
