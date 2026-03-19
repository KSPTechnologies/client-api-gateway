/**
 * Standardized API error responses.
 */

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
  }

  toResponse(): Response {
    return Response.json(
      {
        error: {
          message: this.message,
          code: this.code || this.statusCode.toString(),
        },
      },
      { status: this.statusCode }
    );
  }
}

export function badRequest(message: string, code?: string): ApiError {
  return new ApiError(400, message, code || 'BAD_REQUEST');
}

export function unauthorized(message = 'Invalid or missing API key'): ApiError {
  return new ApiError(401, message, 'UNAUTHORIZED');
}

export function notFound(message = 'Resource not found'): ApiError {
  return new ApiError(404, message, 'NOT_FOUND');
}

export function methodNotAllowed(): ApiError {
  return new ApiError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
}

export function rateLimited(): ApiError {
  return new ApiError(429, 'Rate limit exceeded', 'RATE_LIMITED');
}

export function internal(message = 'Internal server error'): ApiError {
  return new ApiError(500, message, 'INTERNAL_ERROR');
}
